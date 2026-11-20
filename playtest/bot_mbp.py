#!/usr/bin/env python3
"""Skybreak real-GPU playtest bot for the MBP (headed system Chrome, no SwiftShader).

Plays full runs through the opt-in ?hook effect stream, records per-frame timing
via an injected rAF wrapper, and writes a JSON summary per group.

Playwright is NOT a project dependency; install it in a throwaway venv outside the repo:
    python3 -m venv /tmp/pwenv && /tmp/pwenv/bin/pip install playwright
    /tmp/pwenv/bin/python playtest/bot_mbp.py --group all --out /tmp/skybreak-run
(needs `npm run preview` on :5201; channel="chrome" uses the installed Google Chrome).

Groups:
  1080p   1920x1080 @ DPR 1, 3 runs (the performance budget is set for 1080p)
  retina  1920x1080 @ DPR 2, 1 run
  soak    1920x1080 @ DPR 1, 10 back-to-back runs, idling out of RESULTS each time

--headless runs with no window (still the real Metal GPU on macOS), but rAF is then paced
by Chrome's fixed 60 Hz timer, not the display: use it for soak / memory / error / JS-cost
checks only, never for refresh-rate or dropped-frame numbers. Headed runs need the window
left alone: dragging it to another display changes the refresh rate, and real mouse input
over the page resets the RESULTS idle timer.
"""
import argparse
import asyncio
import json
import math
import random
import statistics
import time
from pathlib import Path

from playwright.async_api import async_playwright

# Frame timing, merged per frame when several rAF callbacks share a timestamp.
# Fields: [ts, frame interval ms, JS+submit ms, phase, effective render ratio]
PERF_INIT = r"""
(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const log = (window.__perf = []);
  window.requestAnimationFrame = cb => raf(ts => {
    const t0 = performance.now(); cb(ts); const work = performance.now() - t0;
    const prev = log[log.length - 1];
    if (prev && prev[0] === ts) { prev[2] += work; return; }
    log.push([ts, prev ? ts - prev[0] : 0, work, document.body?.dataset.phase ?? '',
      document.querySelector('#playfield')?.width / (document.querySelector('#playfield')?.clientWidth || 1)]);
    if (log.length > 30000) log.splice(0, 15000);
  });
})();
"""

# Side queue for the bot: tags each hook event as the game pushes it, so polling never
# misses or double-reads an event (the game's own array is trimmed past 4000 entries).
BOT_INIT = r"""
(() => {
  let fx;
  window.__botQ = [];
  Object.defineProperty(window, '__skybreakFx', {
    configurable: true,
    get: () => fx,
    set: value => {
      fx = value;
      const push = value.push.bind(value);
      value.push = (...items) => { for (const item of items) window.__botQ.push(item); return push(...items); };
    },
  });
  window.__botPoll = () => {
    const events = window.__botQ;
    window.__botQ = [];
    return { phase: document.body?.dataset.phase ?? '', now: performance.now(), events };
  };
  // The bot sends no input after RESULTS, so anything counted here came from a real
  // mouse/keyboard on the window (which also resets the 25 s idle timer).
  window.__extInput = { pointermove: 0, pointerdown: 0, click: 0, keydown: 0, wheel: 0 };
  for (const type of Object.keys(window.__extInput)) {
    addEventListener(type, () => {
      const phase = document.body?.dataset.phase;
      if (phase === 'RESULTS' || phase === 'INITIALS') window.__extInput[type]++;
    }, { capture: true, passive: true });
  }
  window.__perfDrain = () => {
    const log = window.__perf || [];
    const out = log.slice();
    log.length = 0;
    return out;
  };
})();
"""

GPU_JS = r"""
() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return { error: 'no webgl' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const out = {
    version: gl.getParameter(gl.VERSION),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
    maskedRenderer: gl.getParameter(gl.RENDERER),
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}
"""

RESULTS_JS = r"""
() => {
  const panel = document.querySelector('#panel');
  const q = s => panel.querySelector(s)?.textContent?.trim() ?? null;
  return {
    text: panel.innerText,
    altitude: q('.card-altitude'),
    title: q('.badge-title'),
    tier: q('.badge-tier'),
    bars: [...panel.querySelectorAll('.bar')].map(b => ({
      label: b.querySelector('.bar-label')?.textContent,
      raw: b.querySelector('.bar-raw')?.textContent,
      score: Number(b.querySelector('.bar-score')?.textContent),
    })),
    detail: q('.card-detail')?.replace(/\s+/g, ' '),
    beat: q('#beat-line'),
  };
}
"""

# Real window position/visibility: tells a moved window (other display) or an occluded one
# apart from the game itself when the frame interval changes.
WINDOW_JS = "() => ({ x: screenX, y: screenY, focus: document.hasFocus(), vis: document.visibilityState })"

STAGES = ('STAGE_LIGHTNING', 'STAGE_DRONES', 'STAGE_COMET')
PHASE_ORDER = ('ATTRACT', 'COUNTDOWN', *STAGES, 'RESULTS', 'INITIALS')


def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    return s[max(0, math.ceil(len(s) * p) - 1)]


def frame_stats(frames):
    """Per-phase stats over [ts, interval, work, phase, ratio] rows."""
    by_phase = {}
    for ts, interval, work, phase, ratio in frames:
        by_phase.setdefault(phase, []).append((interval, work, ratio))
    out = {}
    for phase in sorted(by_phase, key=lambda p: PHASE_ORDER.index(p) if p in PHASE_ORDER else 99):
        rows = by_phase[phase]
        iv = [r[0] for r in rows if r[0] > 0]
        work = [r[1] for r in rows]
        ratios = [r[2] for r in rows if r[2] is not None and r[2] == r[2]]
        out[phase] = {
            'frames': len(rows),
            'interval_p50': pct(iv, 0.5), 'interval_p95': pct(iv, 0.95), 'interval_max': max(iv) if iv else None,
            'work_p50': pct(work, 0.5), 'work_p95': pct(work, 0.95), 'work_max': max(work) if work else None,
            'over25': sum(1 for v in iv if v > 25),
            'over_1_5_refresh': None,  # filled by caller once the refresh period is known
            'ratio_min': min(ratios) if ratios else None,
            '_iv': iv,
        }
    return out


def long_frames(frames, events, limit=25.0):
    """Frames over `limit` ms with time-in-phase and the nearest game event before them."""
    out, start, prev = [], {}, None
    for ts, interval, work, phase, ratio in frames:
        if phase != prev:
            start[phase], prev = ts, phase
        if interval > limit:
            gap_start = ts - interval
            before = [e for e in events if e[1] <= ts]
            near = before[-1] if before else None
            out.append({'phase': phase, 'in_phase_s': round((ts - start[phase]) / 1000, 2),
                        'interval': round(interval, 1), 'work': round(work, 2),
                        'nearest_event': near[0] if near else None,
                        'event_to_gap_ms': round(gap_start - near[1], 1) if near else None})
    return out


class Bot:
    def __init__(self, page, width, height, rng, log):
        self.page, self.W, self.H, self.rng, self.log = page, width, height, rng, log
        self.mouse = (width / 2, height * 0.7)

    async def poll(self):
        return await self.page.evaluate('() => window.__botPoll()')

    async def wait_phase(self, wanted, timeout_s):
        end = time.monotonic() + timeout_s
        while time.monotonic() < end:
            phase = await self.page.evaluate('() => document.body.dataset.phase')
            if phase in wanted:
                return phase
            await asyncio.sleep(0.05)
        raise TimeoutError(f'phase {wanted} not reached in {timeout_s}s')

    async def wait_idle_return(self, log, name, run, since):
        """Waits (without any input) for RESULTS to idle back to ATTRACT; returns seconds since RESULTS."""
        t0 = time.monotonic()
        while time.monotonic() - t0 < 240:
            phase = await self.page.evaluate('() => document.body.dataset.phase')
            if phase == 'ATTRACT':
                return round(time.monotonic() - since, 1)
            waited = time.monotonic() - t0
            if int(waited) % 30 == 0 and waited > 29 and (waited - int(waited)) < 0.06:
                ext = await self.page.evaluate('() => window.__extInput')
                log(f'[{name}] run {run}: still {phase} after {waited:.0f}s, external input {ext}')
            await asyncio.sleep(0.05)
        raise TimeoutError(f'run {run}: no return to ATTRACT within 240 s')

    async def move(self, x, y):
        await self.page.mouse.move(x, y)
        self.mouse = (x, y)

    async def play(self):
        """Plays one run from ATTRACT to RESULTS; returns bot-side counters."""
        page = self.page
        await self.poll()  # drop stale events
        for attempt in range(5):
            # The CTA pulses forever, so Playwright's "stable" check never passes: click its box.
            box = await page.locator('#panel .cta').bounding_box()
            cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            await page.mouse.click(cx, cy)
            self.mouse = (cx, cy)
            try:
                await self.wait_phase({'COUNTDOWN', 'STAGE_LIGHTNING'}, 2)
                break
            except TimeoutError:
                self.log(f'  start click #{attempt + 1} ignored (pending save?), retrying')
        else:
            raise RuntimeError('could not start a run')
        await self.wait_phase({'STAGE_LIGHTNING'}, 6)
        stats = {'flashes': 0, 'clicks_lightning': 0, 'spawns': 0, 'drone_clicks': 0, 'hits': 0, 'misses': 0,
                 'escapes': 0, 'false_starts': 0, 'reactions': [], 'comet_frames': 0, 'comet_locked': 0,
                 'comet_bonus': 0, 'comet_polls': 0, 'max_lock': 0.0, 'events': [], 'window': []}
        click_at = None
        next_comet = 0.0
        last_comet = None
        lx, ly = self.W * 0.5, self.H * 0.66
        await self.move(lx, ly)
        while True:
            st = await self.poll()
            phase = st['phase']
            spawn = None
            for e in st['events']:
                t = e['type']
                if t != 'comet':
                    stats['events'].append([t, e['at']])
                if t == 'flash':
                    stats['flashes'] += 1
                    click_at = time.monotonic() + self.rng.uniform(0.200, 0.300)
                elif t == 'reaction':
                    stats['reactions'].append(e['ms'])
                elif t == 'false-start':
                    stats['false_starts'] += 1
                elif t == 'drone-spawn':
                    stats['spawns'] += 1
                    spawn = e
                elif t == 'drone-hit':
                    stats['hits'] += 1
                elif t == 'drone-miss':
                    stats['misses'] += 1
                elif t == 'drone-escape':
                    stats['escapes'] += 1
                elif t == 'comet':
                    stats['comet_frames'] += 1
                    stats['comet_locked'] += 1 if e['locked'] else 0
                    stats['max_lock'] = max(stats['max_lock'], e['lock'])
                    last_comet = e
                elif t == 'comet-bonus':
                    stats['comet_bonus'] += 1
            if phase not in STAGES:
                return stats
            if not stats['window'] or stats['window'][-1][0] != phase:
                stats['window'].append([phase, await page.evaluate(WINDOW_JS)])
            now = time.monotonic()
            if phase == 'STAGE_LIGHTNING':
                if click_at is not None and now >= click_at:
                    click_at = None
                    stats['clicks_lightning'] += 1
                    await page.mouse.down()
                    await page.mouse.up()
                await asyncio.sleep(0.004)
            elif phase == 'STAGE_DRONES':
                click_at = None
                if spawn is not None:
                    tx, ty = spawn['point']['x'] * self.W, spawn['point']['y'] * self.H
                    sx, sy = self.mouse or (lx, ly)
                    for i in range(1, 7):
                        f = i / 6
                        await self.move(sx + (tx - sx) * f, sy + (ty - sy) * f)
                        await asyncio.sleep(0.035)
                    stats['drone_clicks'] += 1
                    await page.mouse.down()
                    await page.mouse.up()
                else:
                    await asyncio.sleep(0.004)
            elif phase == 'STAGE_COMET':
                if now >= next_comet:
                    next_comet = now + 0.015
                    if last_comet is not None:
                        stats['comet_polls'] += 1
                        await self.move(last_comet['point']['x'] * self.W, last_comet['point']['y'] * self.H)
                await asyncio.sleep(max(0.0, next_comet - time.monotonic()))


async def heap_snapshot(page, cdp):
    raw = await page.evaluate('() => performance.memory ? performance.memory.usedJSHeapSize : null')
    await cdp.send('HeapProfiler.collectGarbage')
    await asyncio.sleep(0.3)
    after = await page.evaluate('() => performance.memory ? performance.memory.usedJSHeapSize : null')
    metrics = {m['name']: m['value'] for m in (await cdp.send('Performance.getMetrics'))['metrics']}
    keep = ('JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'JSEventListeners', 'Documents', 'Frames')
    return {'usedJSHeapSize': raw, 'usedJSHeapSize_afterGC': after, **{k: metrics.get(k) for k in keep}}


async def run_group(pw, name, runs, dpr, url, outdir, log, soak, headless=False):
    W, H = 1920, 1080
    browser = await pw.chromium.launch(channel='chrome', headless=headless,
                                       # precise memory: otherwise usedJSHeapSize is bucketed and cached for
                                       # ~20 min, which would make any soak trend look flat.
                                       # mute: the synth still runs, only the speaker output is muted.
                                       # window-position 0,0: start on the main (built-in ProMotion) display.
                                       args=['--enable-precise-memory-info', '--mute-audio', '--window-position=0,0'])
    context = await browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=dpr)
    await context.add_init_script(PERF_INIT)
    await context.add_init_script(BOT_INIT)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append({'kind': 'pageerror', 'text': str(e), 'at': time.time()}))
    page.on('console', lambda m: m.type == 'error' and errors.append({'kind': 'console', 'text': m.text, 'at': time.time()}))
    page.on('response', lambda r: r.status >= 400 and errors.append({'kind': 'http', 'text': f'{r.status} {r.url}', 'at': time.time()}))
    cdp = await context.new_cdp_session(page)
    await cdp.send('Performance.enable')
    await page.goto(url)
    await page.bring_to_front()
    bot = Bot(page, W, H, random.Random(), log)
    await bot.wait_phase({'ATTRACT'}, 10)
    await asyncio.sleep(2)

    env = {
        'browserVersion': browser.version,
        'userAgent': await page.evaluate('() => navigator.userAgent'),
        'devicePixelRatio': await page.evaluate('() => devicePixelRatio'),
        'viewport': [W, H],
        'gpu': await page.evaluate(GPU_JS),
        'reducedMotion': await page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches"),
    }
    log(f'[{name}] Chrome {env["browserVersion"]} DPR={env["devicePixelRatio"]} GPU={env["gpu"].get("renderer")}')

    all_frames, run_results, heap = [], [], []
    attract_frames = await page.evaluate('() => window.__perfDrain()')
    all_frames += attract_frames
    if soak:
        heap.append({'run': 0, 'at': time.time(), **(await heap_snapshot(page, cdp))})
    for i in range(1, runs + 1):
        t0 = time.time()
        stats = await bot.play()
        t_results = time.monotonic()  # play() returns on the first poll that sees RESULTS
        await asyncio.sleep(1.2)  # card fill + beat line
        result = await page.evaluate(RESULTS_JS)
        # Idle out of RESULTS (no input at all) back to ATTRACT, then let the save settle.
        idle_return_s = await bot.wait_idle_return(log, name, i, t_results)
        idle_s = time.time() - t0
        ext = await page.evaluate('() => { const e = { ...window.__extInput }; for (const k in window.__extInput) window.__extInput[k] = 0; return e; }')
        await asyncio.sleep(1.5)
        frames = await page.evaluate('() => window.__perfDrain()')
        all_frames += frames
        fs = frame_stats(frames)
        run = {'run': i, 'bot': stats, 'result': result, 'wall_s': round(idle_s, 1),
               'results_to_attract_s': idle_return_s, 'external_input_after_results': ext,
               'long_frames': long_frames(frames, stats['events']),
               'phase_stats': {p: {k: v for k, v in s.items() if k != '_iv'} for p, s in fs.items()}}
        run_results.append(run)
        trk = stats['comet_locked'] / stats['comet_frames'] if stats['comet_frames'] else 0
        (outdir / f'{name}-partial.json').write_text(json.dumps(
            {'group': name, 'env': env, 'run_results': run_results, 'heap': heap, 'errors': errors}, indent=1, ensure_ascii=False))
        log(f'[{name}] run {i}/{runs}: {result["altitude"]} | ' +
            ', '.join(f'{b["label"]} {b["raw"]}={b["score"]}' for b in result['bars']) +
            f' | comet lockedFrames {trk:.1%} bonus {stats["comet_bonus"]} | RESULTS->ATTRACT {idle_return_s}s'
            f' | external input {sum(ext.values())} | errors so far {len(errors)}')
        if soak:
            snap = await heap_snapshot(page, cdp)
            heap.append({'run': i, 'at': time.time(), **snap,
                         'work_p95_stages': pct([w for _, _, w, ph, _ in frames if ph in STAGES], 0.95)})
            log(f'[{name}]   heap {snap["usedJSHeapSize"]/1e6:.2f} MB raw / {snap["usedJSHeapSize_afterGC"]/1e6:.2f} MB after GC, '
                f'nodes {snap["Nodes"]}, listeners {snap["JSEventListeners"]}')
    all_frames += await page.evaluate('() => window.__perfDrain()')
    await browser.close()

    fs = frame_stats(all_frames)
    stage_iv = [iv for p in STAGES if p in fs for iv in fs[p]['_iv']]
    refresh = statistics.median(stage_iv) if stage_iv else None
    for s in fs.values():
        s['over_1_5_refresh'] = sum(1 for v in s['_iv'] if refresh and v > 1.5 * refresh)
        s.pop('_iv')
    summary = {'group': name, 'runs': runs, 'dpr': dpr, 'env': env, 'refresh_period_ms': refresh,
               'phase_stats': fs, 'run_results': run_results, 'heap': heap, 'errors': errors,
               'ratio_min_all': min((s['ratio_min'] for s in fs.values() if s['ratio_min'] is not None), default=None)}
    (outdir / f'{name}.json').write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    (outdir / f'{name}-frames.json').write_text(json.dumps(all_frames))
    log(f'[{name}] done: refresh {refresh:.2f} ms, render ratio min {summary["ratio_min_all"]}, errors {len(errors)}')
    return summary


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--group', default='all', choices=['1080p', 'retina', 'soak', 'all', 'smoke'])
    ap.add_argument('--url', default='http://localhost:5201/?hook')
    ap.add_argument('--out', default='playtest-out')
    ap.add_argument('--headless', action='store_true', help='no window; frame pacing is synthetic 60 Hz')
    a = ap.parse_args()
    outdir = Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    logf = (outdir / 'bot.log').open('a')

    def log(msg):
        line = f'{time.strftime("%m-%d %H:%M:%S", time.gmtime(time.time() + 8 * 3600))} {msg}'  # Beijing time
        print(line, flush=True)
        logf.write(line + '\n')
        logf.flush()

    plan = {'smoke': [('smoke', 1, 1, False)],
            '1080p': [('1080p', 3, 1, False)],
            'retina': [('retina', 1, 2, False)],
            'soak': [('soak', 10, 1, True)]}
    groups = plan['1080p'] + plan['retina'] + plan['soak'] if a.group == 'all' else plan[a.group]
    async with async_playwright() as pw:
        for name, runs, dpr, soak in groups:
            await run_group(pw, name + ('-headless' if a.headless else ''), runs, dpr, a.url, outdir, log, soak, a.headless)


if __name__ == '__main__':
    asyncio.run(main())

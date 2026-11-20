#!/usr/bin/env python3
"""Records raw footage for the Skybreak demo video (real GPU, headless, no window).

Plays the production build (npm run preview on :5201) with a scripted player and
records two pages of one browser context: the game and the ?view=board leaderboard
screen, so the BroadcastChannel/IndexedDB sync between them is real. A visible
cursor overlay is injected for the recording only (headless video has no OS
cursor); it is not part of the game.

Usage (Playwright installed outside the repo, see bot_mbp.py):
    /tmp/pwenv/bin/python playtest/record_demo.py --out /tmp/skybreak-demo
Outputs game.webm, board.webm and markers.json (seconds from each video's start).
"""
import argparse
import asyncio
import json
import random
import time
from pathlib import Path

from playwright.async_api import async_playwright

from bot_mbp import BOT_INIT

CURSOR_INIT = r"""
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.setAttribute('aria-hidden', 'true');
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', width: '30px', height: '30px', pointerEvents: 'none',
    zIndex: '2147483647', transform: 'translate(-200px,-200px)', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.6))' });
  c.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#fff" stroke="#0b1a3a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  const move = e => { c.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`; };
  addEventListener('pointermove', move, { capture: true, passive: true });
  addEventListener('pointerdown', move, { capture: true, passive: true });
});
"""

W, H = 1920, 1080
STAGES = ('STAGE_LIGHTNING', 'STAGE_DRONES', 'STAGE_COMET')


class Player:
    """Scripted player. skill=1 plays sharply (for the recorded run); lower is sloppier (warm-up runs)."""

    def __init__(self, page, skill, rng, mark):
        self.page, self.skill, self.rng, self.mark = page, skill, rng, mark
        self.pos = (W * 0.5, H * 0.7)

    async def move(self, x, y):
        await self.page.mouse.move(x, y)
        self.pos = (x, y)

    async def glide(self, x, y, steps, step_s):
        sx, sy = self.pos
        for i in range(1, steps + 1):
            f = i / steps
            f = f * f * (3 - 2 * f)  # ease in/out, looks like a hand
            await self.move(sx + (x - sx) * f, sy + (y - sy) * f)
            await asyncio.sleep(step_s)

    async def phase(self):
        return await self.page.evaluate('() => document.body.dataset.phase')

    async def wait_phase(self, wanted, timeout=60):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if await self.phase() in wanted:
                return
            await asyncio.sleep(0.05)
        raise TimeoutError(wanted)

    async def start(self):
        box = await self.page.locator('#panel .cta').bounding_box()
        await self.glide(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, 14, 0.03)
        await asyncio.sleep(0.4)
        await self.page.mouse.click(*self.pos)
        await self.wait_phase({'COUNTDOWN'}, 5)
        self.mark('countdown')

    async def play(self):
        s = self.skill
        react = (0.20, 0.30) if s >= 1 else (0.32, 0.48)
        glide_steps, glide_step = (8, 0.03) if s >= 1 else (12, 0.045)
        comet_poll = 0.015 if s >= 1 else 0.07
        await self.page.evaluate('() => window.__botPoll()')
        await self.wait_phase({'STAGE_LIGHTNING'}, 6)
        await self.glide(W * 0.5, H * 0.62, 10, 0.03)
        click_at, last_comet, seen = None, None, set()
        while True:
            st = await self.page.evaluate('() => window.__botPoll()')
            phase = st['phase']
            if phase not in seen:
                seen.add(phase)
                self.mark(phase)
            spawn = None
            for e in st['events']:
                if e['type'] == 'flash':
                    click_at = time.monotonic() + self.rng.uniform(*react)
                elif e['type'] == 'drone-spawn':
                    spawn = e
                elif e['type'] == 'comet':
                    last_comet = e
            if phase not in STAGES:
                return
            if phase == 'STAGE_LIGHTNING':
                if click_at and time.monotonic() >= click_at:
                    click_at = None
                    await self.page.mouse.down()
                    await self.page.mouse.up()
                await asyncio.sleep(0.004)
            elif phase == 'STAGE_DRONES':
                if spawn:
                    jitter = 0 if s >= 1 else self.rng.uniform(-30, 30)
                    await self.glide(spawn['point']['x'] * W + jitter, spawn['point']['y'] * H + jitter, glide_steps, glide_step)
                    await self.page.mouse.down()
                    await self.page.mouse.up()
                else:
                    await asyncio.sleep(0.004)
            elif phase == 'STAGE_COMET':
                if last_comet:
                    await self.move(last_comet['point']['x'] * W, last_comet['point']['y'] * H)
                await asyncio.sleep(comet_poll)

    async def initials(self, letters):
        await asyncio.sleep(3.5)  # let the skill card animate in
        btn = await self.page.locator('#enter-initials').bounding_box()
        await self.glide(btn['x'] + btn['width'] / 2, btn['y'] + btn['height'] / 2, 14, 0.03)
        await asyncio.sleep(0.3)
        await self.page.mouse.click(*self.pos)
        await self.wait_phase({'INITIALS'}, 5)
        self.mark('INITIALS')
        await asyncio.sleep(0.8)
        for ch in letters:
            await self.page.keyboard.press(ch)
            await asyncio.sleep(0.35)
        done = await self.page.locator('#initials-done').bounding_box()
        await self.glide(done['x'] + done['width'] / 2, done['y'] + done['height'] / 2, 12, 0.03)
        await asyncio.sleep(0.3)
        await self.page.mouse.click(*self.pos)
        await self.wait_phase({'ATTRACT'}, 10)
        self.mark('saved')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5201/')
    ap.add_argument('--out', default='demo-footage')
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(9)
    async with async_playwright() as pw:
        # One persistent context so the game page and the board page share IndexedDB and BroadcastChannel.
        ctx = await pw.chromium.launch_persistent_context(
            str(out / 'profile'), channel='chrome', headless=True, args=['--mute-audio'],
            viewport={'width': W, 'height': H}, record_video_dir=str(out / 'raw'), record_video_size={'width': W, 'height': H})
        await ctx.add_init_script(BOT_INIT)
        await ctx.add_init_script(CURSOR_INIT)
        t0 = {}
        markers = {'game': [], 'board': []}

        def marker(which):
            return lambda name: markers[which].append([name, round(time.monotonic() - t0[which], 2)])

        # Headless screencast crops the bottom of every page except the newest one (a grey band),
        # so the board opens first and the game page is created last; neither is brought to front.
        initial = list(ctx.pages)
        board = await ctx.new_page()
        t0['board'] = time.monotonic()
        await board.goto(a.url + '?view=board')
        game = await ctx.new_page()
        for page in initial:
            await page.close()
        t0['game'] = time.monotonic()
        await game.goto(a.url + '?hook')
        mark = marker('game')
        p = Player(game, 0.5, rng, mark)
        await p.wait_phase({'ATTRACT'}, 15)
        # Two sloppier warm-up runs so the boards show a real spread of scores.
        for letters in ('JET', 'ACE'):
            mark(f'warmup-{letters}')
            await asyncio.sleep(1.0)
            await p.start()
            await p.play()
            await p.initials(letters)
            await asyncio.sleep(1.5)
        bmark = marker('board')
        bmark('board-open')
        mark('board-open')
        await asyncio.sleep(9)  # attract mode with today's top 3
        mark('attract')
        await asyncio.sleep(7)
        p.skill = 1
        mark('main-run')
        bmark('main-run')
        await p.start()
        await p.play()
        mark('results')
        bmark('results')
        await p.initials('SKY')
        bmark('saved')
        await asyncio.sleep(6)
        # Operator panel: PIN-protected, with live diagnostics.
        mark('operator')
        await game.keyboard.press('Control+Shift+O')
        await asyncio.sleep(1.2)
        for ch in '0909':
            await game.keyboard.press(ch)
            await asyncio.sleep(0.25)
        await game.keyboard.press('Enter')
        await asyncio.sleep(5)
        mark('operator-close')
        close = await game.locator('#close-operator').bounding_box()
        if close:
            await p.glide(close['x'] + close['width'] / 2, close['y'] + close['height'] / 2, 10, 0.03)
            await game.mouse.click(*p.pos)
        await asyncio.sleep(2)
        mark('end')
        markers['board_starts_before_game_s'] = round(t0['game'] - t0['board'], 2)
        (out / 'markers.json').write_text(json.dumps(markers, indent=1))
        # A persistent context closes its browser too, so take the paths first;
        # the files are complete once the context has closed.
        game_path, board_path = await game.video.path(), await board.video.path()
        await ctx.close()
        Path(game_path).replace(out / 'game.webm')
        Path(board_path).replace(out / 'board.webm')
        print(json.dumps(markers))


if __name__ == '__main__':
    asyncio.run(main())

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Shared harness for the browser tests and the soak run. It drives the real
 * production build through the opt-in `?hook` effect stream (see
 * src/game/mount.ts) and never reaches into game internals beyond that.
 */

export type Phase = 'ATTRACT' | 'COUNTDOWN' | 'STAGE_LIGHTNING' | 'STAGE_DRONES' | 'STAGE_COMET'
  | 'RESULTS' | 'INITIALS';
export const STAGES = ['STAGE_LIGHTNING', 'STAGE_DRONES', 'STAGE_COMET'] as const;

export interface Fx {
  type: string;
  at: number;
  point?: { x: number; y: number };
  radiusPx?: number;
  ms?: number;
  gain?: number;
  multiplier?: number;
  locked?: boolean;
  lock?: number;
}

/**
 * One animation frame: rAF timestamp, interval since the previous frame, JS time
 * in rAF callbacks, phase, and the `#playfield` drawing-buffer width after the frame.
 */
export type Frame = [number, number, number, string, number];

interface Tap {
  fx: Fx[];
  frames: Frame[];
  flashes: number;
  /** When set, flash number `flash` (1-based) is answered by a synthetic pointerdown `delayMs` later. */
  anticipate: { flash: number; delayMs: number } | null;
}

declare global {
  interface Window { __e2e: Tap }
}

/**
 * Runs in the page before any game code. Copies every effect the game pushes to
 * its hook array into our own queue (the game trims its array, the queue is
 * drained by the test), and times every animation frame.
 */
function installTap() {
  const tap: Tap = { fx: [], frames: [], flashes: 0, anticipate: null };
  window.__e2e = tap;
  let stream: unknown[] | undefined;
  Object.defineProperty(window, '__skybreakFx', {
    configurable: true,
    get: () => stream,
    set(value: unknown[]) {
      stream = value;
      value.push = (...items: unknown[]) => {
        for (const item of items as Fx[]) {
          tap.fx.push(item);
          if (item.type === 'flash' && ++tap.flashes === tap.anticipate?.flash) {
            const delay = tap.anticipate.delayMs;
            window.setTimeout(() => {
              const canvas = document.querySelector('#playfield')!;
              const box = canvas.getBoundingClientRect();
              canvas.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, button: 0, clientX: box.width / 2, clientY: box.height / 2,
              }));
            }, delay);
          }
        }
        return Array.prototype.push.apply(value, items);
      };
    },
  });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => raf(timestamp => {
    const started = performance.now();
    callback(timestamp);
    const work = performance.now() - started;
    const width = document.querySelector<HTMLCanvasElement>('#playfield')?.width ?? 0;
    const previous = tap.frames[tap.frames.length - 1];
    if (previous && previous[0] === timestamp) {
      previous[2] += work;
      previous[4] = width;
    } else {
      tap.frames.push([timestamp, previous ? timestamp - previous[0] : 0, work, document.body?.dataset.phase ?? '', width]);
    }
  });
}

/** Collects page errors and console errors; tests assert the list stays empty. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const { url } = message.location();
    problems.push(`console error: ${message.text()} (${url})`);
  });
  return problems;
}

export async function openGame(page: Page, query = '?hook') {
  await page.addInitScript(installTap);
  await page.goto(`/${query}`);
  await waitPhase(page, 'ATTRACT');
  await expect(page.locator('#panel .cta')).toBeVisible();
}

export const phaseOf = (page: Page) => page.evaluate(() => document.body.dataset.phase as Phase);

export async function waitPhase(page: Page, phase: Phase, timeout = 10_000) {
  await page.waitForFunction(expected => document.body.dataset.phase === expected, phase, { timeout });
}

export const drainFx = (page: Page) => page.evaluate(() => window.__e2e.fx.splice(0));
export const drainFrames = (page: Page) => page.evaluate(() => window.__e2e.frames.splice(0));

/** Any click on ATTRACT starts a run; the CTA pulses forever, so skip the stability wait. */
export async function startRun(page: Page) {
  await page.locator('#panel .cta').click({ force: true });
  await waitPhase(page, 'COUNTDOWN');
}

export interface Style {
  /** Lightning: answer each flash after this many ms, or never. */
  reactionMs: [number, number] | null;
  /** Lightning: clicks made before the first flash (each one is a false start). */
  earlyClicks?: number;
  /** Lightning: leave flash number N (1-based) alone, for a test that answers it itself. */
  ignoreFlash?: number;
  /** Drones: hit each one (moving there in `steps` × `stepMs`), or ignore them all. */
  drones: { steps: number; stepMs: number; missRate?: number } | null;
  /** Comet: follow it with the cursor, or leave the cursor still. */
  track: boolean;
}

export const skilled: Style = { reactionMs: [200, 260], drones: { steps: 5, stepMs: 30 }, track: true };
export const sloppy: Style = {
  reactionMs: [320, 480], earlyClicks: 2, drones: { steps: 8, stepMs: 45, missRate: 0.3 }, track: false,
};
export const idle: Style = { reactionMs: null, drones: null, track: false };

/** One answered flash: how long after it the bot noticed and waited, and what the game reported. */
export interface Reaction { flashAt: number; waitedMs: number; noticedMs: number; reportedMs: number | null; verdict: string }

export interface RunLog {
  fx: Fx[];
  frames: Frame[];
  reactions: Reaction[];
  /** Phases in the order the bot saw them. */
  phases: Phase[];
}

const between = ([low, high]: [number, number], random: () => number) => low + (high - low) * random();

export interface PlayOptions {
  random?: () => number;
  /** Called once when the bot first sees each phase, with the batch of effects that came with it. */
  onPhase?: (phase: Phase, batch: readonly Fx[]) => Promise<void>;
  /** Stop as soon as this phase is reached (default: RESULTS). */
  until?: Phase;
}

/**
 * Plays one run from ATTRACT to RESULTS (or `until`). Deterministic for a given
 * `random` apart from browser timing. Reads target positions from the effect
 * stream, exactly like a player reads them off the screen.
 */
export async function playRun(page: Page, style: Style,
  { random = Math.random, onPhase, until = 'RESULTS' }: PlayOptions = {}): Promise<RunLog> {
  const log: RunLog = { fx: [], frames: [], reactions: [], phases: [] };
  const size = () => page.viewportSize()!;
  let mouse = { x: size().width / 2, y: size().height / 2 };
  await page.mouse.move(mouse.x, mouse.y);
  await drainFx(page);
  await drainFrames(page);
  await startRun(page);
  log.phases.push('COUNTDOWN');
  let earlyLeft = style.earlyClicks ?? 0;
  let flashes = 0;
  let lastEarlyClick = 0;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const { fx, phase } = await page.evaluate(() => ({
      fx: window.__e2e.fx.splice(0), phase: document.body.dataset.phase as Phase,
    }));
    log.fx.push(...fx);
    if (phase !== log.phases[log.phases.length - 1]) {
      log.phases.push(phase);
      await onPhase?.(phase, fx);
    }
    if (phase === until || phase === 'RESULTS' || phase === 'INITIALS' || phase === 'ATTRACT') break;

    if (phase === 'STAGE_LIGHTNING' && earlyLeft > 0 && Date.now() - lastEarlyClick > 300
      && !fx.some(event => event.type === 'flash')) {
      earlyLeft--;
      lastEarlyClick = Date.now();
      await page.mouse.click(mouse.x, mouse.y);
    }

    for (const [index, event] of fx.entries()) {
      if (event.type === 'flash' && ++flashes === style.ignoreFlash) continue;
      if (event.type === 'flash' && style.reactionMs) {
        const noticedMs = await page.evaluate(at => performance.now() - at, event.at);
        const waitedMs = between(style.reactionMs, random);
        await page.waitForTimeout(waitedMs);
        await page.mouse.click(mouse.x, mouse.y);
        log.reactions.push({ flashAt: event.at, waitedMs, noticedMs, reportedMs: null, verdict: '' });
      }
      // A drone whose escape is already in this batch is gone: chasing it would be a deliberate miss.
      const gone = fx.slice(index + 1).some(later => later.type === 'drone-escape'
        && later.point?.x === event.point?.x && later.point?.y === event.point?.y);
      if (event.type === 'drone-spawn' && style.drones && event.point && !gone) {
        const { width, height } = size();
        const target = { x: event.point.x * width, y: event.point.y * height };
        if (style.drones.missRate && random() < style.drones.missRate) {
          // Click well clear of the drone first: a miss resets the streak.
          await page.mouse.click(target.x > width / 2 ? target.x - 160 : target.x + 160, target.y);
        }
        const { steps, stepMs } = style.drones;
        for (let step = 1; step <= steps; step++) {
          await page.mouse.move(mouse.x + (target.x - mouse.x) * step / steps, mouse.y + (target.y - mouse.y) * step / steps);
          await page.waitForTimeout(stepMs);
        }
        mouse = target;
        await page.mouse.click(mouse.x, mouse.y);
      }
    }

    if (phase === 'STAGE_COMET' && style.track) {
      const latest = [...fx].reverse().find(event => event.type === 'comet' && event.point);
      if (latest?.point) {
        const { width, height } = size();
        mouse = { x: latest.point.x * width, y: latest.point.y * height };
        await page.mouse.move(mouse.x, mouse.y);
      }
    }
    await page.waitForTimeout(10);
  }

  log.fx.push(...await drainFx(page));
  log.frames = await drainFrames(page);
  // A flash's verdict is the first one after it: the next trial only arms on that click.
  const verdicts = log.fx.filter(event => event.type === 'reaction' || event.type === 'false-start');
  for (const reaction of log.reactions) {
    const verdict = verdicts.find(event => event.at > reaction.flashAt);
    reaction.verdict = verdict?.type ?? 'none';
    reaction.reportedMs = verdict?.ms ?? null;
  }
  return log;
}

export const count = (log: RunLog, type: string) => log.fx.filter(event => event.type === type).length;

/** Every change of the drawing-buffer width, with the phase of the frame that showed it first. */
export function widthChanges(frames: readonly Frame[]): { phase: string; width: number }[] {
  const changes: { phase: string; width: number }[] = [];
  for (const frame of frames) {
    if (changes[changes.length - 1]?.width !== frame[4]) changes.push({ phase: frame[3], width: frame[4] });
  }
  return changes;
}

/** Human-readable event list for assertion messages, relative to the first event shown. */
export function timeline(log: RunLog, types: readonly string[]): string {
  const events = log.fx.filter(event => types.includes(event.type));
  const start = events[0]?.at ?? 0;
  return events.map(event => `+${Math.round(event.at - start)} ${event.type}` +
    (event.point ? ` (${event.point.x.toFixed(3)}, ${event.point.y.toFixed(3)})` : '')).join('\n');
}

/** From RESULTS: enter initials and finish, which saves the run and returns to ATTRACT. */
export async function saveWithInitials(page: Page, initials: string) {
  await page.locator('#enter-initials').click();
  await waitPhase(page, 'INITIALS');
  await page.keyboard.type(initials);
  await expect(page.locator('.wheels output')).toHaveText([...initials]);
  await page.locator('#initials-done').click();
  await waitSaved(page);
}

/**
 * Back on ATTRACT the finished run is saved asynchronously; until it is, a click
 * retries the save instead of starting a run. `.saved-line` only appears once
 * the save has completed.
 */
export async function waitSaved(page: Page, timeout = 10_000) {
  await waitPhase(page, 'ATTRACT', timeout);
  await expect(page.locator('#saved-card .saved-line')).toBeVisible({ timeout });
}

export function quantile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
}

export interface StageFrames { frames: number; intervalP50: number; intervalP95: number; intervalMax: number;
  workP95: number; workMax: number; over50ms: number }

/** Per-phase frame statistics; the first frame of each phase is kept (it is where stalls show up). */
export function frameSummary(frames: readonly Frame[]): Record<string, StageFrames> {
  const byPhase = new Map<string, Frame[]>();
  for (const frame of frames) {
    if (!frame[1]) continue;
    byPhase.set(frame[3], [...byPhase.get(frame[3]) ?? [], frame]);
  }
  return Object.fromEntries([...byPhase].map(([phase, list]) => {
    const intervals = list.map(frame => frame[1]);
    const work = list.map(frame => frame[2]);
    return [phase, {
      frames: list.length,
      intervalP50: quantile(intervals, 0.5),
      intervalP95: quantile(intervals, 0.95),
      intervalMax: Math.max(...intervals),
      workP95: quantile(work, 0.95),
      workMax: Math.max(...work),
      over50ms: list.filter(frame => frame[1] > 50).length,
    }];
  }));
}

/** Effects emitted from a stage update, i.e. drawn in the frame whose callback emitted them. */
const drawnEffects = ['flash', 'drone-spawn', 'comet', 'comet-bonus'];

/**
 * The frames where a fresh page first uses each material: the first frame of
 * each phase, and the frame that first draws each kind of effect (the first
 * flash comes well after the first Lightning frame). Mid-stage stalls with
 * other causes are not here (the adaptive pixel-ratio drop no longer is one:
 * it waits for the stage to end).
 */
export function firstUseFrames(log: RunLog): Frame[] {
  const picked = new Set<Frame>();
  const seen = new Set<string>();
  for (const frame of log.frames) {
    if (!frame[1] || seen.has(frame[3])) continue;
    seen.add(frame[3]);
    picked.add(frame);
  }
  for (const type of drawnEffects) {
    const first = log.fx.find(event => event.type === type);
    const frame = first && [...log.frames].reverse().find(candidate => candidate[0] <= first.at);
    if (frame) picked.add(frame);
  }
  return log.frames.filter(frame => picked.has(frame));
}

/** Seeded PRNG (mulberry32) so a failing bot run can be replayed. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Brightest "drone cyan" pixel near a point, read from a real screenshot (the
 * WebGL canvas does not preserve its drawing buffer, so readPixels is useless).
 */
export async function cyanNear(page: Page, x: number, y: number, radius: number): Promise<number> {
  const { width, height } = page.viewportSize()!;
  const left = Math.max(0, Math.floor(x - radius));
  const top = Math.max(0, Math.floor(y - radius));
  const clip = { x: left, y: top, width: Math.min(width, Math.ceil(x + radius)) - left,
    height: Math.min(height, Math.ceil(y + radius)) - top };
  if (clip.width <= 0 || clip.height <= 0) return 0; // off screen: nothing can be drawn there
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async source => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let best = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (b > r + 40 && g > r + 20) best = Math.max(best, Math.min(g, b));
    }
    return best;
  }, png);
}

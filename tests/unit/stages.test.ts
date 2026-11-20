import { expect, it, vi } from 'vitest';
import { comet, flightPath } from '../../src/game/stages/comet';
import { dronePosition, drones } from '../../src/game/stages/drones';
import { lightning } from '../../src/game/stages/lightning';
import { summarizeComet } from '../../src/game/scoring';
import type { CometStats } from '../../src/game/scoring';
import { distanceSquared } from '../../src/game/stages/stage';
import type { Point, Stage, StageFx, StageSurface } from '../../src/game/stages/stage';

/** Seeded PRNG (mulberry32), so every randomised test replays exactly. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cometStats(stage: Stage): CometStats {
  const result = stage.result();
  if (result.phase !== 'STAGE_COMET') throw new Error(`not a comet result: ${result.phase}`);
  return result.stats;
}

const cometFrames = (fx: StageFx[]) => fx.filter((event): event is Extract<StageFx, { type: 'comet' }> => event.type === 'comet');

function playfield(width = 800, height = 600) {
  const bounds = { left: 0, top: 0, width, height };
  const target = Object.assign(new EventTarget(), { getBoundingClientRect: () => bounds });
  const fx: StageFx[] = [];
  const surface: StageSurface = {
    canvas: target as unknown as HTMLCanvasElement,
    viewport: () => bounds,
    theme: vi.fn(),
    fx: event => { fx.push(event); },
  };
  const send = (type: string, timeStamp: number, clientX = 400, clientY = 300) => {
    const event = new Event(type);
    Object.defineProperties(event, {
      timeStamp: { value: timeStamp }, clientX: { value: clientX }, clientY: { value: clientY }, button: { value: 0 },
    });
    target.dispatchEvent(event);
  };
  const types = () => fx.map(event => event.type);
  return { surface, send, fx, types };
}

it('rerolls Lightning before a presented frame and measures exactly five valid trials', () => {
  const { surface, send } = playfield();
  const stage = lightning(surface, () => 0);
  stage.start(100);
  send('pointerdown', 1001); // Past the scheduled delay, but no flash frame has run.
  stage.update(1400, 1500);
  send('pointerdown', 1501); // The delay now runs from the first false start.
  for (let i = 0; i < 5; i++) {
    const frame = 2420 + 1120 * i;
    stage.update(1120, frame);
    send('pointerdown', frame + 200);
  }
  expect(stage.update(220, 7320)).toBe(true);
  expect(stage.result().stats).toEqual({ reactionsMs: [200, 200, 200, 200, 200], falseStarts: 2 });
});

it('stops Lightning at 15 seconds and unregisters its input when disposed', () => {
  const { surface, send } = playfield();
  const stage = lightning(surface, () => 0);
  stage.start(100);
  stage.dispose();
  send('pointerdown', 200);
  expect(stage.result().stats).toEqual({ reactionsMs: [], falseStarts: 0 });

  const next = lightning(surface, () => 0);
  next.start(200);
  expect(next.update(14_999, 15_199)).toBe(false);
  send('pointerdown', 15_200);
  expect(next.update(1, 15_200)).toBe(true);
  expect(next.result().stats).toEqual({ reactionsMs: [], falseStarts: 0 });
  next.dispose();
});

it('maintains the drone spawn distance even when random attempts repeat', () => {
  const viewport = { width: 1800, height: 300 };
  const previous = { x: 0.5, y: 0.5 };
  const next = dronePosition(previous, viewport, () => 0.5);
  expect(distanceSquared(previous, next, viewport)).toBeGreaterThanOrEqual((1800 ** 2 + 300 ** 2) / 16);
});

it('measures drone TTK from spawn, expires before a click at 1.4 s, and clears on dispose', () => {
  const { surface, send, types, fx } = playfield();
  const stage = drones(surface, () => 0.5);
  stage.start(100);
  stage.update(20, 120);
  const first = fx[0] as Extract<StageFx, { type: 'drone-spawn' }>;
  send('pointerdown', 350, first.point.x * 800, first.point.y * 600);
  stage.update(240, 360);
  send('pointerdown', 1760);
  stage.update(18_730, 19_090);
  expect(stage.update(1010, 20_100)).toBe(true); // The last drone had less than 1.4 s available.
  stage.dispose();
  send('pointerdown', 5000);
  expect(stage.result().stats).toEqual({ outcomes: [{ kind: 'hit', ttkMs: 230 }, { kind: 'escape' }, { kind: 'miss' }] });
  expect(types()).toEqual(['drone-spawn', 'drone-hit', 'drone-spawn', 'drone-escape', 'drone-miss', 'drone-spawn', 'clear']);
});

it('credits time between cursor events and clips the Comet simulation at 20 seconds', () => {
  const { surface, send, types } = playfield();
  const stage = comet(surface, { x: 0.5, y: 0.5 }, () => 0);
  stage.start(100);
  send('pointerleave', 136);
  send('pointerenter', 162, 440, 330);
  stage.update(90, 190);
  // The 26 ms outside is within the lock grace: one lock, the gap not credited.
  expect(stage.result().stats).toEqual({ elapsedMs: 90, locksMs: [64] });
  send('pointerleave', 190);
  expect(stage.update(25_000, 25_190)).toBe(true);
  expect(stage.result().stats).toEqual({ elapsedMs: 20_000, locksMs: [64] });
  stage.dispose();
  expect(types().at(-1)).toBe('clear');
  expect(types().filter(type => type === 'clear')).toHaveLength(1);
});


it('rerolls a 99 ms anticipation but accepts exactly 100 ms', () => {
  const { surface, send } = playfield();
  const stage = lightning(surface, () => 0);
  stage.start(0);
  stage.update(900, 900);
  send('pointerdown', 999);
  stage.update(999, 1899);
  send('pointerdown', 1999);
  expect(stage.result().stats).toEqual({ reactionsMs: [100], falseStarts: 1 });
  stage.dispose();
});

it.each([[1920, 1080, 28], [600, 400, 18]])('uses the same drone radius for drawing and hits at %sx%s', (width, height, radius) => {
  const { surface, send, fx } = playfield(width, height);
  const stage = drones(surface, () => 0.5);
  stage.start(0);
  stage.update(1, 1);
  const spawn = fx[0] as Extract<StageFx, { type: 'drone-spawn' }>;
  expect(spawn.radiusPx).toBe(radius);
  const [cx, cy] = [spawn.point.x * width, spawn.point.y * height];
  send('pointerdown', 2, cx + radius + 0.1, cy);
  send('pointerdown', 3, cx + radius - 0.1, cy);
  expect(stage.result().stats).toEqual({ outcomes: [{ kind: 'miss' }, { kind: 'hit', ttkMs: 2 }] });
  stage.dispose();
});
it('reports reaction and false-start feedback for Lightning', () => {
  const { surface, send, fx } = playfield();
  const stage = lightning(surface, () => 0);
  stage.start(0);
  send('pointerdown', 500);
  stage.update(1400, 1399);
  stage.update(1, 1400);
  send('pointerdown', 1650);
  expect(fx).toEqual([{ type: 'false-start' }, { type: 'flash' }, { type: 'reaction', ms: 250 }]);
  stage.dispose();
});

it('reports drone hit gain with the streak multiplier used for scoring', () => {
  const { surface, send, fx } = playfield(1000, 1000);
  const stage = drones(surface, () => 0.5);
  stage.start(0);
  stage.update(1, 1);
  const first = fx[0] as Extract<StageFx, { type: 'drone-spawn' }>;
  send('pointerdown', 401, first.point.x * 1000, first.point.y * 1000);
  stage.update(1, 402);
  const second = fx.at(-1) as Extract<StageFx, { type: 'drone-spawn' }>;
  send('pointerdown', 802, second.point.x * 1000, second.point.y * 1000);
  const hits = fx.filter((event): event is Extract<StageFx, { type: 'drone-hit' }> => event.type === 'drone-hit');
  expect(hits.map(hit => hit.multiplier)).toEqual([1, 1.1]);
  expect(hits[0].gain).toBeCloseTo(400);
  expect(hits[1].gain).toBeCloseTo(440);
  stage.dispose();
});

it('announces each 3 s Comet lock bonus once and reports lock progress', () => {
  const { surface, fx } = playfield();
  const stage = comet(surface, null, () => 0);
  stage.start(0);
  stage.update(0, 0);
  const first = fx.at(-1) as Extract<StageFx, { type: 'comet' }>;
  stage.syncPointer!(0, first.point);
  // A pointer that never moves leaves the comet within a few frames, so follow it exactly.
  for (let t = 10; t <= 6500; t += 10) {
    const last = [...fx].reverse().find(event => event.type === 'comet') as Extract<StageFx, { type: 'comet' }>;
    stage.syncPointer!(t - 10, last.point);
    stage.update(10, t);
  }
  expect(fx.filter(event => event.type === 'comet-bonus')).toHaveLength(2);
  const last = fx.at(-1) as Extract<StageFx, { type: 'comet' }>;
  expect(last.locked).toBe(true);
  expect(last.lock).toBeCloseTo(0.1667, 2);
  stage.dispose();
});

it.each([[1920, 1080, 64], [800, 600, 60]])('uses the same Comet radius for drawing and locking at %sx%s', (width, height, radius) => {
  const { surface, fx } = playfield(width, height);
  const stage = comet(surface, null, seeded(1));
  stage.start(0);
  stage.update(0, 0);
  const start = cometFrames(fx)[0];
  expect(start.radiusPx).toBe(radius);
  stage.syncPointer!(0, { x: start.point.x + (radius - 0.1) / width, y: start.point.y });
  stage.update(10, 10);
  expect(cometFrames(fx).at(-1)!.locked).toBe(true);

  const outside = playfield(width, height);
  const missed = comet(outside.surface, { x: start.point.x + (radius + 0.1) / width, y: start.point.y }, seeded(1));
  missed.start(0);
  missed.update(10, 10);
  expect(cometStats(missed).locksMs).toEqual([]);
  stage.dispose();
  missed.dispose();
});

it('turns the Comet smoothly: velocity never jumps by more than 120 px/s between 10 ms steps', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const { surface, fx } = playfield(1920, 1080);
    const stage = comet(surface, null, seeded(seed));
    stage.start(0);
    for (let t = 10; t <= 20_000; t += 10) stage.update(10, t);
    const points = cometFrames(fx).map(event => event.point);
    expect(points).toHaveLength(2000);
    let worst = 0;
    let previous: Point | null = null;
    for (let i = 1; i < points.length; i++) {
      const velocity = { x: (points[i].x - points[i - 1].x) * 1920 / 0.01, y: (points[i].y - points[i - 1].y) * 1080 / 0.01 };
      if (previous) worst = Math.max(worst, Math.hypot(velocity.x - previous.x, velocity.y - previous.y));
      previous = velocity;
    }
    expect(worst, `seed ${seed}`).toBeLessThanOrEqual(120);
    stage.dispose();
  }
});

it('keeps Comet speed at 1920x1080 within a followable range over 300 seeds', () => {
  const speeds: number[] = [];
  for (let seed = 1; seed <= 300; seed++) {
    const path = flightPath(seeded(seed));
    let previous = path(0);
    for (let t = 10; t <= 20_000; t += 10) {
      const point = path(t);
      speeds.push(Math.hypot((point.x - previous.x) * 1920, (point.y - previous.y) * 1080) / 0.01);
      previous = point;
    }
  }
  speeds.sort((a, b) => a - b);
  const at = (q: number) => speeds[Math.ceil(speeds.length * q) - 1];
  expect(at(0.5)).toBeLessThanOrEqual(360);
  expect(at(0.95)).toBeLessThanOrEqual(800);
  expect(speeds.at(-1)).toBeLessThanOrEqual(1250);
});

it('gives the Comet path as a pure function of stage time', () => {
  const path = flightPath(seeded(9));
  const forward = [0, 3210, 7777, 15_000, 19_990].map(path);
  const again = flightPath(seeded(9));
  expect([19_990, 15_000, 7777, 3210, 0].map(again).reverse()).toEqual(forward);
});

/** Follows the comet exactly at 1920x1080, except with the cursor gone during [away[0], away[1]). */
function followComet(away: [number, number], untilMs: number) {
  const { surface, fx } = playfield(1920, 1080);
  const stage = comet(surface, null, seeded(7));
  stage.start(0);
  stage.update(0, 0);
  const frames = new Map<number, { locked: boolean; lock: number; bonuses: number }>();
  for (let t = 10; t <= untilMs; t += 10) {
    const at = t - 10;
    stage.syncPointer!(at, at >= away[0] && at < away[1] ? null : cometFrames(fx).at(-1)!.point);
    stage.update(10, t);
    const { locked, lock } = cometFrames(fx).at(-1)!;
    frames.set(t, { locked, lock, bonuses: fx.filter(event => event.type === 'comet-bonus').length });
  }
  return { stage, frames };
}

it('keeps a Comet lock through a 100 ms exit without crediting the time outside', () => {
  const { stage, frames } = followComet([2000, 2100], 3500);
  expect(frames.get(2090)).toEqual({ locked: true, lock: 2000 / 3000, bonuses: 0 });
  // The bonus needs 3 s on target, so it arrives 100 ms late.
  expect(frames.get(3090)!.bonuses).toBe(0);
  expect(frames.get(3100)!.bonuses).toBe(1);
  const stats = cometStats(stage);
  expect(stats).toEqual({ elapsedMs: 3500, locksMs: [3400] });
  expect(summarizeComet(stats)).toMatchObject({ onTargetMs: 3400, longestLockMs: 3400, altitude: 3.4 * 120 + 300 });
  stage.dispose();
});

it('ends a Comet lock at the exit time once the cursor is out for over 150 ms', () => {
  const { stage, frames } = followComet([2000, 2200], 3500);
  expect(frames.get(2150)!.locked).toBe(true);
  expect(frames.get(2170)!.locked).toBe(false);
  expect(frames.get(3500)!.bonuses).toBe(0);
  const stats = cometStats(stage);
  expect(stats).toEqual({ elapsedMs: 3500, locksMs: [2000, 1300] });
  expect(summarizeComet(stats)).toMatchObject({ onTargetMs: 3300, longestLockMs: 2000 });
  stage.dispose();
});

it('waits 0.9 to 2.2 s before each Lightning flash', () => {
  const delays: number[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const { surface, send, fx } = playfield();
    const stage = lightning(surface, seeded(seed));
    stage.start(0);
    let armedAt = 0;
    for (let t = 1; t <= 15_000; t++) {
      if (stage.update(1, t)) break;
      if (fx.at(-1)?.type !== 'flash') continue;
      delays.push(t - armedAt);
      armedAt = t + 200;
      send('pointerdown', armedAt);
    }
    stage.dispose();
  }
  expect(delays.length).toBeGreaterThanOrEqual(150);
  expect(Math.min(...delays)).toBeGreaterThanOrEqual(900);
  expect(Math.max(...delays)).toBeLessThanOrEqual(2200);
  // The whole range is used, not just part of it.
  expect(Math.min(...delays)).toBeLessThan(1000);
  expect(Math.max(...delays)).toBeGreaterThan(2100);
});

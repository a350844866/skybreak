import { expect, it, vi } from 'vitest';
import { comet } from '../../src/game/stages/comet';
import { dronePosition, drones } from '../../src/game/stages/drones';
import { lightning } from '../../src/game/stages/lightning';
import { distanceSquared } from '../../src/game/stages/stage';
import type { StageFx, StageSurface } from '../../src/game/stages/stage';

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
  send('pointerdown', 1301); // Past the scheduled delay, but no flash frame has run.
  stage.update(1400, 1500);
  send('pointerdown', 1501); // The delay now runs from the first false start.
  for (let i = 0; i < 5; i++) {
    const frame = 2720 + 1420 * i;
    stage.update(1420, frame);
    send('pointerdown', frame + 200);
  }
  expect(stage.update(220, 8620)).toBe(true);
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
  expect(stage.result().stats).toEqual({ elapsedMs: 90, locksMs: [36, 28] });
  send('pointerleave', 190);
  expect(stage.update(25_000, 25_190)).toBe(true);
  expect(stage.result().stats).toEqual({ elapsedMs: 20_000, locksMs: [36, 28] });
  stage.dispose();
  expect(types().at(-1)).toBe('clear');
  expect(types().filter(type => type === 'clear')).toHaveLength(1);
});


it('rerolls a 99 ms anticipation but accepts exactly 100 ms', () => {
  const { surface, send } = playfield();
  const stage = lightning(surface, () => 0);
  stage.start(0);
  stage.update(1200, 1200);
  send('pointerdown', 1299);
  stage.update(1299, 2499);
  send('pointerdown', 2599);
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
  stage.update(1700, 1700);
  send('pointerdown', 1950);
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

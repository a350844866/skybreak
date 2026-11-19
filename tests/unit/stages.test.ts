import { expect, it, vi } from 'vitest';
import { comet } from '../../src/game/stages/comet';
import { dronePosition, drones } from '../../src/game/stages/drones';
import { lightning } from '../../src/game/stages/lightning';
import { distanceSquared } from '../../src/game/stages/stage';
import type { StageSurface } from '../../src/game/stages/stage';

function playfield() {
  const bounds = { left: 0, top: 0, width: 800, height: 600 };
  const target = Object.assign(new EventTarget(), { getBoundingClientRect: () => bounds });
  const discs = [] as ReturnType<typeof makeDisc>[];
  const makeDisc = () => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() });
  const surface: StageSurface = {
    canvas: target as unknown as HTMLCanvasElement,
    viewport: () => bounds,
    color: vi.fn(),
    disc() {
      const disc = makeDisc();
      discs.push(disc);
      return disc;
    },
  };
  const send = (type: string, timeStamp: number, clientX = 400, clientY = 300) => {
    const event = new Event(type);
    Object.defineProperties(event, {
      timeStamp: { value: timeStamp }, clientX: { value: clientX }, clientY: { value: clientY }, button: { value: 0 },
    });
    target.dispatchEvent(event);
  };
  return { surface, send, discs };
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

it('measures drone TTK from spawn, expires before a click at 1.4 s, and disposes its mesh', () => {
  const { surface, send, discs } = playfield();
  const stage = drones(surface, () => 0.5);
  stage.start(100);
  stage.update(20, 120);
  send('pointerdown', 350);
  stage.update(240, 360);
  send('pointerdown', 1760);
  stage.update(18_730, 19_090);
  expect(stage.update(1010, 20_100)).toBe(true); // The last drone had less than 1.4 s available.
  stage.dispose();
  send('pointerdown', 5000);
  expect(stage.result().stats).toEqual({ outcomes: [{ kind: 'hit', ttkMs: 230 }, { kind: 'escape' }, { kind: 'miss' }] });
  expect(discs).toHaveLength(1);
  expect(discs[0].dispose).toHaveBeenCalledOnce();
});

it('credits time between cursor events and clips the Comet simulation at 20 seconds', () => {
  const { surface, send, discs } = playfield();
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
  expect(discs).toHaveLength(2);
  for (const disc of discs) expect(disc.dispose).toHaveBeenCalledOnce();
});

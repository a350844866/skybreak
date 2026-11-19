import { between, distanceSquared, DRONES_MS, pointerPoint } from './stage';
import type { Point, Stage, StageSurface, Viewport } from './stage';
import type { DroneOutcome } from '../scoring';

const lifetimeMs = 1400;
const radiusFor = ({ width, height }: Viewport) => Math.min(28, Math.min(width, height) * 0.045);

export function dronePosition(previous: Point | null, viewport: Viewport, random: () => number): Point {
  const { width, height } = viewport;
  const radius = radiusFor(viewport);
  const mx = radius / width;
  const my = radius / height;
  const minimumSquared = (width ** 2 + height ** 2) / 16;
  for (let attempt = 0; attempt < 24; attempt++) {
    const point = { x: between(mx, 1 - mx, random), y: between(my, 1 - my, random) };
    if (!previous || distanceSquared(point, previous, viewport) >= minimumSquared) return point;
  }
  // The opposite corner is far enough even on very wide or tall viewports.
  return { x: previous && previous.x >= 0.5 ? mx : 1 - mx, y: previous && previous.y >= 0.5 ? my : 1 - my };
}

export function drones(surface: StageSurface, random = Math.random): Stage {
  const listeners = new AbortController();
  const outcomes: DroneOutcome[] = [];
  const disc = surface.disc(0x63f2ff);
  let previous: Point | null = null;
  let target: { point: Point; spawnedAt: number } | null = null;
  let startedAt = 0;
  let endAt = 0;

  function clearTarget() {
    target = null;
    disc.hide();
  }

  function expire(now: number) {
    if (target && target.spawnedAt + lifetimeMs <= Math.min(now, endAt)) {
      outcomes.push({ kind: 'escape' });
      clearTarget();
    }
  }

  function click(event: PointerEvent) {
    const now = surface.inputTime ? surface.inputTime(event.timeStamp) : event.timeStamp;
    if (now === null) return;
    if (event.button !== 0 || now < startedAt || now >= endAt) return;
    expire(now);
    const viewport = surface.viewport();
    if (target && now >= target.spawnedAt && distanceSquared(
      target.point, pointerPoint(surface.canvas, event), viewport,
    ) <= radiusFor(viewport) ** 2) {
      outcomes.push({ kind: 'hit', ttkMs: now - target.spawnedAt });
      clearTarget();
    } else {
      outcomes.push({ kind: 'miss' });
    }
  }

  return {
    durationMs: DRONES_MS,
    start(now) {
      startedAt = now;
      endAt = now + DRONES_MS;
      surface.color(0x162e52);
      surface.canvas.addEventListener('pointerdown', click, { signal: listeners.signal });
    },
    update(_dt, frameTime) {
      expire(frameTime);
      if (frameTime >= endAt) return true;
      const viewport = surface.viewport();
      if (!target) {
        previous = dronePosition(previous, viewport, random);
        target = { point: previous, spawnedAt: frameTime };
      }
      disc.show(target.point, radiusFor(viewport));
      return false;
    },
    result: () => ({ phase: 'STAGE_DRONES', stats: { outcomes: [...outcomes] } }),
    dispose() {
      listeners.abort();
      disc.dispose();
    },
  };
}

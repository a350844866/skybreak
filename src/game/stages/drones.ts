import { between, distanceSquared, DRONES_MS, pointerPoint } from './stage';
import type { Point, Stage, StageSurface, Viewport } from './stage';
import { droneHitAltitude, streakMultiplier } from '../scoring';
import type { DroneOutcome } from '../scoring';

const lifetimeMs = 1400;
export const droneRadius = ({ width, height }: Viewport) => Math.min(28, Math.min(width, height) * 0.045);

export function dronePosition(previous: Point | null, viewport: Viewport, random: () => number): Point {
  const { width, height } = viewport;
  const radius = droneRadius(viewport);
  // Keep a margin so the drone (and its glow) never sits under the HUD bar, the
  // instruction banner below it, or off screen.
  const mx = (radius * 2) / width;
  const my = (Math.min(200, height * 0.2) + radius * 1.5) / height;
  const minimumSquared = (width ** 2 + height ** 2) / 16;
  for (let attempt = 0; attempt < 24; attempt++) {
    const point = { x: between(mx, 1 - mx, random), y: between(my, 1 - radius * 2 / height, random) };
    if (!previous || distanceSquared(point, previous, viewport) >= minimumSquared) return point;
  }
  // The opposite corner is far enough even on very wide or tall viewports.
  return {
    x: previous && previous.x >= 0.5 ? mx : 1 - mx,
    y: previous && previous.y >= 0.5 ? my : 1 - radius * 2 / height,
  };
}

export function drones(surface: StageSurface, random = Math.random): Stage {
  const listeners = new AbortController();
  const outcomes: DroneOutcome[] = [];
  let previous: Point | null = null;
  let target: { point: Point; spawnedAt: number } | null = null;
  let startedAt = 0;
  let endAt = 0;
  let streak = 0;

  function expire(now: number) {
    if (target && target.spawnedAt + lifetimeMs <= Math.min(now, endAt)) {
      const { point } = target;
      outcomes.push({ kind: 'escape' });
      target = null;
      streak = 0;
      surface.fx({ type: 'drone-escape', point });
    }
  }

  function click(event: PointerEvent) {
    const now = surface.inputTime ? surface.inputTime(event.timeStamp) : event.timeStamp;
    if (now === null) return;
    if (event.button !== 0 || now < startedAt || now >= endAt) return;
    expire(now);
    const viewport = surface.viewport();
    const point = pointerPoint(surface.canvas, event);
    if (target && now >= target.spawnedAt
      && distanceSquared(target.point, point, viewport) <= droneRadius(viewport) ** 2) {
      const ttkMs = now - target.spawnedAt;
      const hit = target.point;
      const applied = streak;
      outcomes.push({ kind: 'hit', ttkMs });
      target = null;
      streak++;
      surface.fx({ type: 'drone-hit', point: hit, gain: droneHitAltitude(ttkMs, applied), multiplier: streakMultiplier(applied) });
    } else {
      outcomes.push({ kind: 'miss' });
      streak = 0;
      surface.fx({ type: 'drone-miss', point });
    }
  }

  return {
    durationMs: DRONES_MS,
    start(now) {
      startedAt = now;
      endAt = now + DRONES_MS;
      surface.theme('dusk');
      surface.canvas.addEventListener('pointerdown', click, { signal: listeners.signal });
    },
    update(_dt, frameTime) {
      expire(frameTime);
      if (frameTime >= endAt) return true;
      if (!target) {
        const viewport = surface.viewport();
        previous = dronePosition(previous, viewport, random);
        target = { point: previous, spawnedAt: frameTime };
        surface.fx({ type: 'drone-spawn', point: previous, radiusPx: droneRadius(viewport) });
      }
      return false;
    },
    result: () => ({ phase: 'STAGE_DRONES', stats: { outcomes: [...outcomes] } }),
    dispose() {
      listeners.abort();
      surface.fx({ type: 'clear' });
    },
  };
}

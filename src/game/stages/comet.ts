import { between, COMET_MS, distanceSquared, pointerPoint } from './stage';
import type { Point, Stage, StageSurface, Viewport } from './stage';

const stepMs = 10;
const BONUS_LOCK_MS = 3000;
export const cometRadius = ({ width, height }: Viewport) => Math.min(46, Math.min(width, height) * 0.075);
const waves = [
  { amplitude: 0.21, xSpeed: 1.35, ySpeed: 1.63 },
  { amplitude: 0.10, xSpeed: 2.49, ySpeed: 2.17 },
  { amplitude: 0.06, xSpeed: 4.01, ySpeed: 3.57 },
];

function flightPath(random: () => number) {
  const phases = waves.map(() => ({ x: random() * 2 * Math.PI, y: random() * 2 * Math.PI }));
  let direction = 1;
  let pathTime = 0;
  let elapsed = 0;
  let nextFlip = between(1500, 3000, random);

  return (at: number): Point => {
    while (at >= nextFlip) {
      pathTime += direction * (nextFlip - elapsed);
      elapsed = nextFlip;
      direction *= -1;
      nextFlip += between(1500, 3000, random);
    }
    pathTime += direction * (at - elapsed);
    elapsed = at;
    const seconds = pathTime / 1000;
    let x = 0.5;
    let y = 0.5;
    waves.forEach(({ amplitude, xSpeed, ySpeed }, i) => {
      x += amplitude * Math.sin(seconds * xSpeed + phases[i].x);
      y += amplitude * Math.sin(seconds * ySpeed + phases[i].y);
    });
    return { x, y };
  };
}

export function comet(surface: StageSurface, initialPointer: Point | null, random = Math.random): Stage {
  const listeners = new AbortController();
  const path = flightPath(random);
  const locksMs: number[] = [];
  const moves: { at: number; point: Point | null }[] = [];
  let pointer = initialPointer;
  let lockStart: number | null = null;
  let lockBonuses = 0;
  let startedAt = 0;
  let elapsedMs = 0;
  let simulatedMs = 0;
  let position = path(0);

  function syncPointer(now: number, point: Point | null) {
    const at = now - startedAt;
    if (at >= 0 && at < COMET_MS) moves.push({ at, point });
  }

  function queue(event: PointerEvent, point: Point | null) {
    const now = surface.inputTime ? surface.inputTime(event.timeStamp) : event.timeStamp;
    if (now !== null) syncPointer(now, point);
  }

  return {
    durationMs: COMET_MS,
    syncPointer,
    start(now) {
      startedAt = now;
      surface.theme('night');
      const options = { signal: listeners.signal };
      surface.canvas.addEventListener('pointermove', e => queue(e, pointerPoint(surface.canvas, e)), options);
      surface.canvas.addEventListener('pointerenter', e => queue(e, pointerPoint(surface.canvas, e)), options);
      surface.canvas.addEventListener('pointerleave', e => queue(e, null), options);
    },
    update(dt, frameTime) {
      elapsedMs = frameTime >= startedAt + COMET_MS ? COMET_MS : Math.min(COMET_MS, elapsedMs + dt);
      const viewport = surface.viewport();
      const radius = cometRadius(viewport);
      let index = 0;

      // Reports each 3 s lock bonus as it is earned (scoring itself is in summarizeComet).
      function settleBonuses(at: number) {
        if (lockStart === null) return;
        for (const earned = Math.floor((at - lockStart) / BONUS_LOCK_MS); lockBonuses < earned; lockBonuses++) {
          surface.fx({ type: 'comet-bonus', point: position });
        }
      }

      function sample(at: number) {
        const inside = pointer !== null && distanceSquared(pointer, position, viewport) <= radius ** 2;
        if (inside && lockStart === null) {
          lockStart = at;
          lockBonuses = 0;
        } else if (!inside && lockStart !== null) {
          settleBonuses(at);
          locksMs.push(at - lockStart);
          lockStart = null;
        }
      }

      // Pointer changes split a simulation step so time between input samples is credited once.
      while (simulatedMs + stepMs <= elapsedMs) {
        const end = simulatedMs + stepMs;
        while (index < moves.length && moves[index].at <= simulatedMs) pointer = moves[index++].point;
        sample(simulatedMs);
        while (index < moves.length && moves[index].at < end) {
          const move = moves[index++];
          pointer = move.point;
          sample(move.at);
        }
        simulatedMs = end;
        position = path(end);
      }
      if (index) moves.splice(0, index);
      settleBonuses(simulatedMs);
      const held = lockStart === null ? 0 : simulatedMs - lockStart;
      surface.fx({
        type: 'comet', point: position, radiusPx: radius,
        locked: lockStart !== null, lock: (held % BONUS_LOCK_MS) / BONUS_LOCK_MS,
      });
      return elapsedMs === COMET_MS;
    },
    result: () => ({
      phase: 'STAGE_COMET',
      stats: {
        elapsedMs: simulatedMs,
        locksMs: lockStart === null ? [...locksMs] : [...locksMs, simulatedMs - lockStart],
      },
    }),
    dispose() {
      listeners.abort();
      surface.fx({ type: 'clear' });
    },
  };
}

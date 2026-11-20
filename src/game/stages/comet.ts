import { between, COMET_MS, distanceSquared, pointerPoint } from './stage';
import type { Point, Stage, StageSurface, Viewport } from './stage';

const stepMs = 10;
const BONUS_LOCK_MS = 3000;
/** A lock survives the cursor slipping out of the halo for up to this long. */
export const LOCK_GRACE_MS = 150;
export const cometRadius = ({ width, height }: Viewport) => Math.min(64, Math.min(width, height) * 0.1);

// Path time runs slower than stage time and speeds up over the stage, so a
// first-time player can pick the comet up before it gets demanding.
const START_RATE = 0.45;
const END_RATE = 0.75;
const RAMP_MS = 20_000;
const RAMP_SLOPE = (END_RATE - START_RATE) / RAMP_MS;
const FLIP_MIN_MS = 3000;
const FLIP_MAX_MS = 5000;
/** A reversal eases the direction from ±1 to ∓1 on a cosine, so the comet slows, turns and accelerates. */
const REVERSAL_MS = 400;
const TURN = Math.PI / REVERSAL_MS;
const waves = [
  { amplitude: 0.21, xSpeed: 1.35, ySpeed: 1.63 },
  { amplitude: 0.10, xSpeed: 2.49, ySpeed: 2.17 },
  { amplitude: 0.06, xSpeed: 4.01, ySpeed: 3.57 },
];

/** ∫₀^at rate(s) ds: the path time a steady direction covers by stage time `at`. */
function rampIntegral(at: number): number {
  const ramped = Math.min(at, RAMP_MS);
  return START_RATE * ramped + RAMP_SLOPE * ramped ** 2 / 2 + END_RATE * Math.max(0, at - RAMP_MS);
}

/** ∫ rate(s)·cos(TURN·(s − flip)) ds over [from, to], where rate is linear (one side of the ramp knee). */
function turnPiece(from: number, to: number, flip: number): number {
  const slope = from < RAMP_MS ? RAMP_SLOPE : 0;
  const rate = (s: number) => START_RATE + RAMP_SLOPE * Math.min(s, RAMP_MS);
  const antiderivative = (s: number) => {
    const angle = TURN * (s - flip);
    return rate(s) * Math.sin(angle) / TURN + slope * Math.cos(angle) / TURN ** 2;
  };
  return antiderivative(to) - antiderivative(from);
}

function turnIntegral(from: number, to: number, flip: number): number {
  if (from >= RAMP_MS || to <= RAMP_MS) return turnPiece(from, to, flip);
  return turnPiece(from, RAMP_MS, flip) + turnPiece(RAMP_MS, to, flip);
}

/**
 * The comet's position at stage time `at` (ms). A pure function of `at` once
 * created: the reversal schedule is drawn up front and path time is integrated
 * in closed form, so the same `random` always gives the same flight.
 */
export function flightPath(random: () => number) {
  const phases = waves.map(() => ({ x: random() * 2 * Math.PI, y: random() * 2 * Math.PI }));
  const flips: number[] = [];
  for (let at = between(FLIP_MIN_MS, FLIP_MAX_MS, random); at < COMET_MS;) {
    flips.push(at);
    at += between(FLIP_MIN_MS, FLIP_MAX_MS, random);
  }

  function pathTime(at: number): number {
    let total = 0;
    let from = 0;
    let sign = 1;
    for (const flip of flips) {
      if (at <= flip) break;
      total += sign * (rampIntegral(flip) - rampIntegral(from));
      const end = Math.min(at, flip + REVERSAL_MS);
      total += sign * turnIntegral(flip, end, flip);
      if (end === at) return total;
      from = end;
      sign = -sign;
    }
    return total + sign * (rampIntegral(at) - rampIntegral(from));
  }

  return (at: number): Point => {
    const seconds = pathTime(Math.max(0, at)) / 1000;
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
  // A lock is measured in on-target time only: `lockHeldMs` stops growing while
  // the cursor is outside, and `outsideSince` marks where a grace period began.
  let locked = false;
  let lockHeldMs = 0;
  let insideSince: number | null = null;
  let outsideSince: number | null = null;
  let lockBonuses = 0;
  let startedAt = 0;
  let elapsedMs = 0;
  let simulatedMs = 0;
  let position = path(0);

  /** On-target time of the current lock up to `at`; time in a grace period is not credited. */
  const heldAt = (at: number) => lockHeldMs + (insideSince === null ? 0 : at - insideSince);

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
        if (!locked) return;
        for (const earned = Math.floor(heldAt(at) / BONUS_LOCK_MS); lockBonuses < earned; lockBonuses++) {
          surface.fx({ type: 'comet-bonus', point: position });
        }
      }

      // The grace ran out: the lock ended where the cursor left (`lockHeldMs` stopped growing there).
      function endLock() {
        locksMs.push(lockHeldMs);
        locked = false;
        outsideSince = null;
      }

      function sample(at: number) {
        const inside = pointer !== null && distanceSquared(pointer, position, viewport) <= radius ** 2;
        const graceOver = outsideSince !== null && at - outsideSince > LOCK_GRACE_MS;
        if (inside) {
          // A pointer event can bring the cursor back between steps, before any
          // outside sample noticed the grace ran out, so the return checks it too.
          if (locked && graceOver) endLock();
          if (!locked) {
            locked = true;
            lockHeldMs = 0;
            lockBonuses = 0;
          }
          outsideSince = null;
          insideSince ??= at;
        } else if (locked) {
          if (insideSince !== null) {
            lockHeldMs += at - insideSince;
            insideSince = null;
            outsideSince = at;
            settleBonuses(at);
          } else if (graceOver) {
            endLock();
          }
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
      const held = locked ? heldAt(simulatedMs) : 0;
      surface.fx({
        type: 'comet', point: position, radiusPx: radius,
        locked, lock: (held % BONUS_LOCK_MS) / BONUS_LOCK_MS,
      });
      return elapsedMs === COMET_MS;
    },
    result: () => ({
      phase: 'STAGE_COMET',
      stats: {
        elapsedMs: simulatedMs,
        locksMs: locked ? [...locksMs, heldAt(simulatedMs)] : [...locksMs],
      },
    }),
    dispose() {
      listeners.abort();
      surface.fx({ type: 'clear' });
    },
  };
}

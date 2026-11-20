export interface LightningStats {
  readonly reactionsMs: readonly number[];
  readonly falseStarts: number;
}

export type DroneOutcome = { readonly kind: 'hit'; readonly ttkMs: number }
  | { readonly kind: 'miss' | 'escape' };

export interface DroneStats {
  readonly outcomes: readonly DroneOutcome[];
}

export interface CometStats {
  readonly elapsedMs: number;
  /** On-target time of each lock; a grace-period exit keeps the lock but adds nothing. */
  readonly locksMs: readonly number[];
}

export interface RunStats {
  readonly lightning: LightningStats;
  readonly drones: DroneStats;
  readonly comet: CometStats;
}

export function averageMs(samples: readonly number[]): number | null {
  return samples.length ? samples.reduce((total, ms) => total + ms, 0) / samples.length : null;
}

export function scoreLightning({ reactionsMs, falseStarts }: LightningStats): number {
  return reactionsMs.reduce((score, ms) => score + Math.max(0, 600 - ms) * 2, -150 * falseStarts);
}

/** Streak multiplier for the next hit: 1.0 rising by 0.1 per consecutive hit, capped at 2.0. */
export const streakMultiplier = (streak: number) => (10 + Math.min(streak, 10)) / 10;

export const droneHitAltitude = (ttkMs: number, streak: number) =>
  (150 + Math.max(0, 1400 - ttkMs) / 4) * streakMultiplier(streak);

export function summarizeDrones({ outcomes }: DroneStats) {
  const hitsMs: number[] = [];
  let misses = 0;
  let escapes = 0;
  let streak = 0;
  let altitude = 0;

  for (const outcome of outcomes) {
    if (outcome.kind === 'hit') {
      hitsMs.push(outcome.ttkMs);
      altitude += droneHitAltitude(outcome.ttkMs, streak);
      streak++;
    } else {
      if (outcome.kind === 'miss') misses++;
      else escapes++;
      streak = 0;
    }
  }

  const clicks = hitsMs.length + misses;
  return {
    hits: hitsMs.length,
    misses,
    escapes,
    averageTtkMs: averageMs(hitsMs),
    accuracy: clicks ? hitsMs.length / clicks : 0,
    altitude,
  };
}

export function summarizeComet({ elapsedMs, locksMs }: CometStats) {
  let onTargetMs = 0;
  let longestLockMs = 0;
  let bonuses = 0;
  for (const lockMs of locksMs) {
    onTargetMs += lockMs;
    longestLockMs = Math.max(longestLockMs, lockMs);
    bonuses += Math.floor(lockMs / 3000);
  }
  return {
    onTargetMs,
    longestLockMs,
    onTarget: elapsedMs > 0 ? onTargetMs / elapsedMs : 0,
    altitude: (onTargetMs / 1000) * 120 + bonuses * 300,
  };
}

export function scoreRun(stats: RunStats): number {
  return scoreLightning(stats.lightning) + summarizeDrones(stats.drones).altitude
    + summarizeComet(stats.comet).altitude;
}

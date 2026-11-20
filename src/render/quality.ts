/**
 * Booth safeguard: if a weak GPU cannot hold the frame rate, render fewer pixels
 * rather than drop frames (a late frame would delay the flash a player reacts to).
 *
 * Pure decision logic; the renderer applies the ratio it returns. Applying one
 * means `renderer.setSize`, which stalls the main thread (66–240 ms on
 * SwiftShader), so it never happens during a timed stage: a stall there would
 * show a flash or a drone late while its clock is already running. Frames are
 * still measured in every phase; a drop decided during a stage waits for the
 * next non-stage phase.
 */

export const QUALITY_WINDOW_FRAMES = 180;
export const SLOW_FRAME_SECONDS = 1 / 45;
/** A window with more slow frames than this drops one step. */
export const SLOW_FRAMES_ALLOWED = 30;
export const QUALITY_STEP = 0.25;
export const QUALITY_FLOOR = 0.75;

export interface QualityGovernor {
  /** Records one frame of `dt` seconds. Returns the pixel ratio to apply now, or null. */
  sample(dt: number): number | null;
  /** Returns the pixel ratio to apply now (a drop deferred by the stage that just ended), or null. */
  setStageActive(active: boolean): number | null;
  /** The ratio the renderer should be using. */
  readonly ratio: number;
  /** True while a decided drop waits for the stage to end. */
  readonly pending: boolean;
}

export function qualityGovernor(initialRatio: number): QualityGovernor {
  let applied = initialRatio;
  // Each window moves the target at most one step, so deferring several drops
  // collapses them into one change that is never larger than applying them live.
  let target = initialRatio;
  let stageActive = false;
  let sampled = 0;
  let slow = 0;

  const flush = () => {
    if (stageActive || target === applied) return null;
    applied = target;
    return applied;
  };

  return {
    sample(dt) {
      if (!dt) return null;
      sampled++;
      if (dt > SLOW_FRAME_SECONDS) slow++;
      if (sampled < QUALITY_WINDOW_FRAMES) return null;
      if (slow > SLOW_FRAMES_ALLOWED && target > QUALITY_FLOOR) target = Math.max(QUALITY_FLOOR, target - QUALITY_STEP);
      sampled = slow = 0;
      return flush();
    },
    setStageActive(active) {
      stageActive = active;
      return flush();
    },
    get ratio() { return applied; },
    get pending() { return target !== applied; },
  };
}

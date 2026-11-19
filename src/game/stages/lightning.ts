import { between, LIGHTNING_MS } from './stage';
import type { Stage, StageSurface } from './stage';

const trials = 5;
/** Faster than any human reaction: treated as an anticipation guess (DESIGN.md §2). */
export const ANTICIPATION_MS = 100;

export function lightning(surface: StageSurface, random = Math.random): Stage {
  const listeners = new AbortController();
  const reactionsMs: number[] = [];
  let falseStarts = 0;
  let endAt = 0;
  let armedAt = 0;
  let dueAt = 0;
  let flashAt: number | null = null;

  function arm(now: number) {
    armedAt = now;
    dueAt = now + between(1200, 3000, random);
    flashAt = null;
  }

  function click(event: PointerEvent) {
    const now = surface.inputTime ? surface.inputTime(event.timeStamp) : event.timeStamp;
    if (now === null) return;
    if (event.button !== 0 || now < armedAt || now >= endAt || reactionsMs.length >= trials) return;
    // State first, feedback second: a failing renderer/audio subscriber must not
    // be able to leave the trial armed and score the same flash twice.
    const early = flashAt === null || now - flashAt < ANTICIPATION_MS;
    const reaction = flashAt === null ? 0 : now - flashAt;
    if (early) falseStarts++;
    else reactionsMs.push(reaction);
    if (reactionsMs.length < trials) arm(now);
    else flashAt = null;
    surface.fx(early ? { type: 'false-start' } : { type: 'reaction', ms: reaction });
  }

  return {
    durationMs: LIGHTNING_MS,
    start(now) {
      endAt = now + LIGHTNING_MS;
      surface.theme('storm');
      arm(now);
      surface.canvas.addEventListener('pointerdown', click, { signal: listeners.signal });
    },
    update(_dt, frameTime) {
      if (frameTime >= endAt || reactionsMs.length >= trials) return true;
      if (flashAt === null && frameTime >= dueAt) {
        // The caller renders immediately after update, so this is the first visible frame.
        flashAt = frameTime;
        surface.fx({ type: 'flash' });
      }
      return false;
    },
    result: () => ({ phase: 'STAGE_LIGHTNING', stats: { reactionsMs: [...reactionsMs], falseStarts } }),
    dispose() {
      listeners.abort();
      surface.fx({ type: 'clear' });
    },
  };
}

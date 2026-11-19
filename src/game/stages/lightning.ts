import { between, LIGHTNING_MS } from './stage';
import type { Stage, StageSurface } from './stage';

const storm = 0x222835;
const flash = 0xdbeaff;
const trials = 5;

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
    surface.color(storm);
  }

  function click(event: PointerEvent) {
    const now = event.timeStamp;
    if (event.button !== 0 || now < armedAt || now >= endAt || reactionsMs.length >= trials) return;
    if (flashAt === null || now < flashAt) falseStarts++;
    else reactionsMs.push(now - flashAt);
    if (reactionsMs.length < trials) arm(now);
  }

  return {
    durationMs: LIGHTNING_MS,
    start(now) {
      endAt = now + LIGHTNING_MS;
      arm(now);
      surface.canvas.addEventListener('pointerdown', click, { signal: listeners.signal });
    },
    update(_dt, frameTime) {
      if (frameTime >= endAt || reactionsMs.length >= trials) return true;
      if (flashAt === null && frameTime >= dueAt) {
        // The caller renders immediately after update, so this is the first visible frame.
        flashAt = frameTime;
        surface.color(flash);
      }
      return false;
    },
    result: () => ({ phase: 'STAGE_LIGHTNING', stats: { reactionsMs: [...reactionsMs], falseStarts } }),
    dispose: () => listeners.abort(),
  };
}

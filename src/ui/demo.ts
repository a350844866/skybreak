import { droneRadius } from '../game/stages/drones';
import type { Point } from '../game/stages/stage';
import type { GameView } from '../render/gameView';

/**
 * Attract-mode vignette: a ghost cursor flicks between drones and pops them,
 * so people walking past see the game being played. Visual only, silent, and
 * fed through the same effect pipeline as a real run.
 */
export function attractDemo(view: GameView, ghost: HTMLElement, signal: AbortSignal) {
  let timer: number | undefined;
  let from: Point = { x: 0.5, y: 0.75 };

  function nextTarget(): Point {
    // Left or right third, so the title and scores in the middle stay clear.
    const side = Math.random() < 0.5 ? 0.06 + Math.random() * 0.22 : 0.72 + Math.random() * 0.22;
    return { x: side, y: 0.22 + Math.random() * 0.62 };
  }

  function step() {
    if (signal.aborted) return;
    const viewport = view.viewport();
    const target = nextTarget();
    view.fx({ type: 'drone-spawn', point: target, radiusPx: droneRadius(viewport) });
    ghost.hidden = false;
    const move = ghost.animate([
      { transform: `translate(${from.x * viewport.width}px, ${from.y * viewport.height}px)` },
      { transform: `translate(${target.x * viewport.width}px, ${target.y * viewport.height}px)` },
    ], { duration: 320 + Math.random() * 220, delay: 260, easing: 'cubic-bezier(.3,0,.15,1)', fill: 'forwards' });
    move.onfinish = () => {
      if (signal.aborted) return;
      view.fx({ type: 'drone-hit', point: target, gain: 160 + Math.random() * 240, multiplier: 1 });
      from = target;
      timer = window.setTimeout(step, 650);
    };
  }

  timer = window.setTimeout(step, 700);
  signal.addEventListener('abort', () => {
    window.clearTimeout(timer);
    for (const animation of ghost.getAnimations()) animation.cancel();
    ghost.hidden = true;
    view.clearEffects();
  }, { once: true });
}

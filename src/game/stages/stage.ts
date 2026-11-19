import type { StageResult } from '../stateMachine';

export const LIGHTNING_MS = 15_000;
export const DRONES_MS = 20_000;
export const COMET_MS = 20_000;

export interface Point { x: number; y: number }
export interface Viewport { width: number; height: number }

/** Sky look for each part of the run; the renderer cross-fades between them. */
export type Theme = 'high' | 'storm' | 'dusk' | 'night';

/**
 * Gameplay events a stage reports. Stages own timing and scoring only; the
 * renderer, HUD and audio subscribe to these, so visuals can change without
 * touching anything that is measured. Points are normalised (0..1, y down).
 *
 * Events that change what the player must react to (flash, drone-spawn) are
 * emitted inside update() for the frame that is drawn right after it, so the
 * measured start time is the first frame that shows them.
 */
export type StageFx =
  | { type: 'flash' }
  | { type: 'reaction'; ms: number }
  | { type: 'false-start' }
  | { type: 'drone-spawn'; point: Point; radiusPx: number }
  | { type: 'drone-hit'; point: Point; gain: number; multiplier: number }
  | { type: 'drone-miss'; point: Point }
  | { type: 'drone-escape'; point: Point }
  | { type: 'comet'; point: Point; radiusPx: number; locked: boolean; lock: number }
  | { type: 'comet-bonus'; point: Point }
  | { type: 'clear' };

export interface StageSurface {
  canvas: HTMLCanvasElement;
  inputTime?(timestamp: number): number | null;
  viewport(): Viewport;
  theme(theme: Theme): void;
  fx(event: StageFx): void;
}

export interface Stage {
  readonly durationMs: number;
  start(now: number): void;
  update(dt: number, frameTime: number): boolean;
  syncPointer?(now: number, point: Point | null): void;
  result(): StageResult;
  dispose(): void;
}

export function pointerPoint(canvas: HTMLCanvasElement, event: PointerEvent): Point {
  const { left, top, width, height } = canvas.getBoundingClientRect();
  return { x: (event.clientX - left) / width, y: (event.clientY - top) / height };
}

export function distanceSquared(a: Point, b: Point, { width, height }: Viewport): number {
  return ((a.x - b.x) * width) ** 2 + ((a.y - b.y) * height) ** 2;
}

export const between = (min: number, max: number, random: () => number) => min + (max - min) * random();

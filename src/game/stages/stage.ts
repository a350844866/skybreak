import type { StageResult } from '../stateMachine';

export const LIGHTNING_MS = 15_000;
export const DRONES_MS = 20_000;
export const COMET_MS = 20_000;

export interface Point { x: number; y: number }
export interface Viewport { width: number; height: number }

export interface Disc {
  show(point: Point, radiusPx: number): void;
  hide(): void;
  dispose(): void;
}

export interface StageSurface {
  canvas: HTMLCanvasElement;
  viewport(): Viewport;
  color(value: number): void;
  disc(color: number, opacity?: number, layer?: number): Disc;
}

export interface Stage {
  readonly durationMs: number;
  start(now: number): void;
  update(dt: number, frameTime: number): boolean;
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

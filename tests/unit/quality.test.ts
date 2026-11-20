import { describe, expect, it } from 'vitest';
import {
  QUALITY_FLOOR, QUALITY_STEP, QUALITY_WINDOW_FRAMES, SLOW_FRAME_SECONDS, SLOW_FRAMES_ALLOWED, qualityGovernor,
} from '../../src/render/quality';
import type { QualityGovernor } from '../../src/render/quality';

const fast = 1 / 60;
const slow = 1 / 30;

/** Feeds one full window with `slowFrames` slow frames; returns every ratio the governor asked to apply. */
function feedWindow(quality: QualityGovernor, slowFrames: number): number[] {
  const applied: number[] = [];
  for (let i = 0; i < QUALITY_WINDOW_FRAMES; i++) {
    const ratio = quality.sample(i < slowFrames ? slow : fast);
    if (ratio !== null) applied.push(ratio);
  }
  return applied;
}

describe('adaptive resolution', () => {
  it('keeps the booth thresholds, step and floor', () => {
    expect(QUALITY_WINDOW_FRAMES).toBe(180);
    expect(SLOW_FRAME_SECONDS).toBeCloseTo(1 / 45, 12);
    expect(SLOW_FRAMES_ALLOWED).toBe(30);
    expect(QUALITY_STEP).toBe(0.25);
    expect(QUALITY_FLOOR).toBe(0.75);
  });

  it('drops one step only after a window with more than 30 frames slower than 1/45 s', () => {
    const quality = qualityGovernor(1.5);
    expect(feedWindow(quality, 30), '30 slow frames are tolerated').toEqual([]);
    // A frame of exactly 1/45 s is not slow, and a zero dt (the first frame) is not a sample.
    for (let i = 0; i < 31; i++) expect(quality.sample(1 / 45)).toBeNull();
    for (let i = 0; i < 31; i++) expect(quality.sample(0)).toBeNull();
    for (let i = 31; i < QUALITY_WINDOW_FRAMES; i++) expect(quality.sample(fast)).toBeNull();
    expect(quality.ratio).toBe(1.5);

    for (let i = 0; i < 31; i++) expect(quality.sample(slow)).toBeNull();
    for (let i = 31; i < QUALITY_WINDOW_FRAMES - 1; i++) expect(quality.sample(fast)).toBeNull();
    expect(quality.sample(fast), 'the 180th frame closes the window').toBe(1.25);
    expect(quality.ratio).toBe(1.25);
  });

  it('applies a drop decided outside a stage at once, down to the 0.75 floor', () => {
    const quality = qualityGovernor(1.5);
    expect(feedWindow(quality, 31)).toEqual([1.25]);
    expect(feedWindow(quality, QUALITY_WINDOW_FRAMES)).toEqual([1]);
    expect(feedWindow(quality, QUALITY_WINDOW_FRAMES)).toEqual([0.75]);
    expect(feedWindow(quality, QUALITY_WINDOW_FRAMES), 'never below the floor').toEqual([]);
    expect(quality.ratio).toBe(0.75);
    expect(quality.pending).toBe(false);
    quality.setStageActive(false);
    expect(quality.takeDue()).toBeNull();
  });

  it('never drops a ratio that starts at or below the floor', () => {
    const quality = qualityGovernor(0.75);
    expect(feedWindow(quality, QUALITY_WINDOW_FRAMES)).toEqual([]);
    expect(quality.ratio).toBe(0.75);
  });

  it('defers a drop decided during a stage until the stage becomes inactive', () => {
    const quality = qualityGovernor(1.5);
    quality.setStageActive(true);
    expect(feedWindow(quality, 31), 'nothing is applied mid-stage').toEqual([]);
    expect(quality.takeDue(), 'nothing is due mid-stage').toBeNull();
    expect(quality.ratio).toBe(1.5);
    expect(quality.pending).toBe(true);
    // Moving from one stage to the next is still a stage.
    quality.setStageActive(true);
    expect(quality.takeDue()).toBeNull();
    expect(quality.ratio).toBe(1.5);

    expect(quality.setStageActive(false), 'ending the stage only marks the drop as due').toBeUndefined();
    expect(quality.ratio).toBe(1.5);
    expect(quality.pending).toBe(true);
    expect(quality.takeDue(), 'the next frame applies it').toBe(1.25);
    expect(quality.ratio).toBe(1.25);
    expect(quality.pending).toBe(false);
    expect(quality.takeDue(), 'applied once').toBeNull();
  });

  it('keeps a due drop waiting if the next stage starts before the next frame', () => {
    const quality = qualityGovernor(1.5);
    quality.setStageActive(true);
    feedWindow(quality, 31);
    quality.setStageActive(false);
    quality.setStageActive(true);
    expect(quality.takeDue(), 'never applied while a stage is active').toBeNull();
    expect(quality.ratio).toBe(1.5);
    expect(quality.pending).toBe(true);
    quality.setStageActive(false);
    expect(quality.takeDue()).toBe(1.25);
  });

  it('keeps measuring during a stage: a slow stage window still counts', () => {
    const quality = qualityGovernor(1.5);
    // Half the window outside the stage, half inside: the window spans both.
    for (let i = 0; i < QUALITY_WINDOW_FRAMES / 2; i++) quality.sample(slow);
    quality.setStageActive(true);
    for (let i = 0; i < QUALITY_WINDOW_FRAMES / 2; i++) expect(quality.sample(fast)).toBeNull();
    expect(quality.pending).toBe(true);
    quality.setStageActive(false);
    expect(quality.takeDue()).toBe(1.25);
  });

  it('collapses repeated slow windows in one stage into at most one step per window, never below 0.75', () => {
    const quality = qualityGovernor(1.5);
    quality.setStageActive(true);
    expect(feedWindow(quality, 31)).toEqual([]);
    expect(feedWindow(quality, 31)).toEqual([]);
    expect(quality.ratio).toBe(1.5);
    quality.setStageActive(false);
    expect(quality.takeDue(), 'two windows, two steps, one change').toBe(1);

    quality.setStageActive(true);
    for (let window = 0; window < 6; window++) expect(feedWindow(quality, QUALITY_WINDOW_FRAMES)).toEqual([]);
    quality.setStageActive(false);
    expect(quality.takeDue(), 'six windows stop at the floor').toBe(0.75);
    expect(quality.ratio).toBe(0.75);
  });

  it('does not drop on a stage end without a slow window', () => {
    const quality = qualityGovernor(1.5);
    quality.setStageActive(true);
    expect(feedWindow(quality, 30)).toEqual([]);
    quality.setStageActive(false);
    expect(quality.takeDue()).toBeNull();
    expect(quality.ratio).toBe(1.5);
  });
});

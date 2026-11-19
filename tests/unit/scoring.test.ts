import { describe, expect, it } from 'vitest';
import { scoreLightning, scoreRun, summarizeComet, summarizeDrones } from '../../src/game/scoring';

const hit = (ttkMs: number) => ({ kind: 'hit', ttkMs } as const);

describe('scoring', () => {
  it('counts false starts independently and floors the reaction reward at zero', () => {
    expect(scoreLightning({ reactionsMs: [200, 600, 720], falseStarts: 2 })).toBe(500);
    expect(scoreLightning({ reactionsMs: [], falseStarts: 1 })).toBe(-150);
  });

  it('caps the multiplier at 2 and resets it on both kinds of miss', () => {
    const outcomes = [...Array.from({ length: 12 }, () => hit(200)),
      { kind: 'miss' } as const, hit(400), { kind: 'escape' } as const, hit(600)];
    expect(summarizeDrones({ outcomes })).toMatchObject({
      altitude: 450 * (16.5 + 2) + 400 + 350,
      hits: 14, misses: 1, escapes: 1, accuracy: 14 / 15, averageTtkMs: 3000 / 14 + 400 / 14,
    });
  });

  it('reports zero with no shots or only escapes and no TTK sample', () => {
    expect(summarizeDrones({ outcomes: [] })).toMatchObject({ altitude: 0, accuracy: 0, averageTtkMs: null });
    expect(summarizeDrones({ outcomes: [{ kind: 'escape' }, { kind: 'escape' }] })).toEqual({
      hits: 0, misses: 0, escapes: 2, accuracy: 0, averageTtkMs: null, altitude: 0,
    });
  });

  it('awards the base hit value when there is no speed bonus', () => {
    expect(summarizeDrones({ outcomes: [hit(1400), hit(1500)] }).altitude).toBe(315);
  });

  it('awards lock bonuses only within uninterrupted intervals', () => {
    expect(summarizeComet({ elapsedMs: 20_000, locksMs: [2999, 1, 3000, 6000] })).toEqual({
      onTargetMs: 12_000, onTarget: 0.6, longestLockMs: 6000, altitude: 2340,
    });
    expect(summarizeComet({ elapsedMs: 0, locksMs: [] }).onTarget).toBe(0);
  });

  it('awards six bonuses for twenty seconds of perfect tracking and adds every stage', () => {
    const comet = { elapsedMs: 20_000, locksMs: [20_000] };
    expect(summarizeComet(comet)).toEqual({ onTargetMs: 20_000, onTarget: 1, longestLockMs: 20_000, altitude: 4200 });
    expect(scoreRun({ lightning: { reactionsMs: [], falseStarts: 1 }, drones: { outcomes: [hit(200)] }, comet })).toBe(4500);
  });
});

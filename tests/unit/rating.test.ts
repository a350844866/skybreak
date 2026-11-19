import { expect, it } from 'vitest';
import { rateRun } from '../../src/game/rating';
import { resetRun } from '../../src/game/stateMachine';
import type { RunStats } from '../../src/game/scoring';

const empty = resetRun(0).stats;

it('rates missing samples and zero accuracy as zero with a deterministic title', () => {
  expect(rateRun(empty)).toEqual({
    ratings: { reaction: 0, flick: 0, precision: 0, tracking: 0 }, title: 'Storm Reflexes', tier: 'Cumulus',
  });
});

it('computes the reference curve midpoints from averages and time-weighted fractions', () => {
  const stats: RunStats = {
    lightning: { reactionsMs: [300, 450], falseStarts: 3 },
    drones: { outcomes: [{ kind: 'hit', ttkMs: 800 }, { kind: 'escape' }] },
    comet: { elapsedMs: 20_000, locksMs: [4000, 6000] },
  };
  expect(rateRun(stats)).toEqual({
    ratings: { reaction: 50, flick: 50, precision: 50, tracking: 50 }, title: 'Storm Reflexes', tier: 'Cirrus',
  });
});

it('clamps speeds beyond the curve endpoints and awards the strongest skill', () => {
  const stats: RunStats = {
    lightning: { reactionsMs: [800], falseStarts: 0 },
    drones: { outcomes: [{ kind: 'hit', ttkMs: 190 }, { kind: 'miss' }] },
    comet: { elapsedMs: 20_000, locksMs: [] },
  };
  expect(rateRun(stats)).toEqual({
    ratings: { reaction: 0, flick: 100, precision: 50, tracking: 0 }, title: 'Drone Hunter', tier: 'Stratus',
  });
  expect(rateRun({ ...stats, drones: { outcomes: [{ kind: 'hit', ttkMs: 1399 }] } }).title).toBe('Dead-Eye');
  expect(rateRun({ ...empty, comet: { elapsedMs: 20_000, locksMs: [20_000] } }).title).toBe('Comet Rider');
});

it('reaches the top tier at a mean of 80', () => {
  const strong: RunStats = {
    lightning: { reactionsMs: [150], falseStarts: 0 },
    drones: { outcomes: [{ kind: 'hit', ttkMs: 200 }] },
    comet: { elapsedMs: 20_000, locksMs: [4000] },
  };
  expect(rateRun(strong).tier).toBe("Sky's The Limit");
  expect(rateRun({ ...strong, comet: { elapsedMs: 20_000, locksMs: [3800] } }).tier).toBe('Stratosphere');
});

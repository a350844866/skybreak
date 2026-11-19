import { averageMs, summarizeComet, summarizeDrones } from './scoring';
import type { RunStats } from './scoring';

const titles = {
  reaction: 'Storm Reflexes',
  flick: 'Drone Hunter',
  precision: 'Dead-Eye',
  tracking: 'Comet Rider',
} as const;

const tiers = ['Cumulus', 'Stratus', 'Cirrus', 'Stratosphere', "Sky's The Limit"] as const;
type Skill = keyof typeof titles;

const rating = (value: number) => Math.round(Math.min(100, Math.max(0, value)));
const speedRating = (ms: number | null, excellent: number, slow: number) =>
  ms === null ? 0 : rating(100 * (slow - ms) / (slow - excellent));

/**
 * Reference curves (clamped, linear, rounded to an integer):
 * Reaction: 150 ms = 100, 600 ms = 0. Flick: 200 ms = 100, 1400 ms = 0.
 * Precision and tracking: 0% = 0, 100% = 100. Missing samples rate zero.
 * Title ties favor the first skill in card order. The mean of the four
 * ratings reaches the next tier at 20, 40, 60 and 80 respectively.
 */
export function rateRun(stats: RunStats) {
  const drones = summarizeDrones(stats.drones);
  const ratings: Record<Skill, number> = {
    reaction: speedRating(averageMs(stats.lightning.reactionsMs), 150, 600),
    flick: speedRating(drones.averageTtkMs, 200, 1400),
    precision: rating(drones.accuracy * 100),
    tracking: rating(summarizeComet(stats.comet).onTarget * 100),
  };

  let strongest: Skill = 'reaction';
  let sum = 0;
  for (const skill of Object.keys(titles) as Skill[]) {
    sum += ratings[skill];
    if (ratings[skill] > ratings[strongest]) strongest = skill;
  }
  return { ratings, title: titles[strongest], tier: tiers[Math.min(4, Math.floor(sum / 80))] };
}

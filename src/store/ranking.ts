import type { RunStats } from '../game/scoring';

export interface Run {
  id: string;
  initials: string;
  altitude: number;
  stats: RunStats;
  createdAt: number;
  eventDay: string;
}

export interface Ranks { today: number | null; allTime: number | null }

export function rankRuns(runs: readonly Run[]): Run[] {
  return [...runs].sort((a, b) => b.altitude - a.altitude || a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function runsCsv(runs: readonly Run[]): string {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = rankRuns(runs).map(run => [run.id, run.initials, run.altitude,
    JSON.stringify(run.stats), new Date(run.createdAt).toISOString(), run.eventDay].map(cell).join(','));
  return ['id,initials,altitude,stats,createdAt,eventDay', ...rows].join('\r\n') + '\r\n';
}

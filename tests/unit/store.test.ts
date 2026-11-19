import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { resetRun } from '../../src/game/stateMachine';
import { createStore } from '../../src/store';
import { rankRuns, runsCsv } from '../../src/store/ranking';

const stats = resetRun(0).stats;
const entry = (id: string, altitude: number, createdAt = 0) => ({ id, altitude, createdAt, stats, initials: 'AAA' });

it('ranks by altitude, then timestamp and id without mutating its input', () => {
  const runs = [entry('d', 3), entry('c', 5, 100), entry('b', 5), entry('a', 5)]
    .map(run => ({ ...run, eventDay: '2026-11-19' }));
  expect(rankRuns(runs).map(run => run.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(runs.map(run => run.id)).toEqual(['d', 'c', 'b', 'a']);
});

it('exports headers, escaped cells, raw stats, and ISO timestamps', () => {
  const run = { ...entry('id', 12), initials: 'A,"', eventDay: '2026-11-19' };
  const csv = runsCsv([run]);
  expect(csv).toBe('id,initials,altitude,stats,createdAt,eventDay\r\n' +
    `"id","A,""","12","${JSON.stringify(stats).replaceAll('"', '""')}","1970-01-01T00:00:00.000Z","2026-11-19"\r\n`);
  expect(runsCsv([])).toBe('id,initials,altitude,stats,createdAt,eventDay\r\n');
});

it('saves once across connections, archives runs, and clears only the active day', async () => {
  const factory = new IDBFactory();
  const game = createStore(factory);
  const board = createStore(factory);
  const archived = await game.saveRun(entry('first', 10));
  const retries = await Promise.all([game.saveRun(entry('first', 99)), board.saveRun(entry('first', 55))]);
  expect(retries).toEqual([archived, archived]);
  const date = new Date();
  expect(archived.eventDay).toBe(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  const day = await game.startNewEventDay();
  expect(day).not.toBe(archived.eventDay);
  expect(await board.topToday(10)).toEqual([]);
  const active = await game.saveRun(entry('second', 5, 10));
  expect(active.eventDay).toBe(day);
  expect(await board.latestRun()).toEqual(active);
  expect(await board.topToday(1)).toEqual([active]);
  expect(await board.topAllTime(1)).toEqual([archived]);
  expect(await board.rankOf(active)).toEqual({ today: 1, allTime: 2 });
  expect(await board.rankOf(archived)).toEqual({ today: null, allTime: 1 });
  expect(await game.exportCsv()).toContain('"second"');
  await game.clearDay();
  expect(await board.topToday(10)).toEqual([]);
  expect(await board.topAllTime(5)).toEqual([archived]);
  expect(await board.rankOf(active)).toEqual({ today: null, allTime: null });
});

it('persists operator settings in metadata', async () => {
  const factory = new IDBFactory();
  const game = createStore(factory);
  expect(await game.getSetting('pin')).toBe('0909');
  expect(await game.getSetting('sound')).toBe(true);
  await game.setSetting('pin', '0123');
  await game.setSetting('sound', false);
  const reopened = createStore(factory);
  expect(await reopened.getSetting('pin')).toBe('0123');
  expect(await reopened.getSetting('sound')).toBe(false);
});

it('follows the calendar date and keeps a manual rollover only for the day it was made', async () => {
  const factory = new IDBFactory();
  let now = new Date(2026, 10, 20, 9, 0);
  const store = createStore(factory, () => now);
  const first = await store.saveRun(entry('day1', 10));
  expect(first.eventDay).toBe('2026-11-20');
  const rolled = await store.startNewEventDay();
  expect(rolled).toBe('2026-11-20.2');
  expect((await store.saveRun(entry('day1b', 20))).eventDay).toBe('2026-11-20.2');
  expect((await store.topToday(10)).map(run => run.id)).toEqual(['day1b']);

  now = new Date(2026, 10, 21, 8, 30); // Next morning: nobody touches the operator panel.
  expect(await store.topToday(10)).toEqual([]);
  const next = await store.saveRun(entry('day2', 5));
  expect(next.eventDay).toBe('2026-11-21');
  expect((await store.topAllTime(10)).map(run => run.id)).toEqual(['day1b', 'day1', 'day2']);
});

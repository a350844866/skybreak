import { rankRuns, runsCsv } from './ranking';
import type { Run, Ranks } from './ranking';

export type { Run, Ranks } from './ranking';
type Metadata = { eventDay: string; pin: string; sound: boolean };
const defaults = { pin: '0909', sound: true };

function localDay(date = new Date()): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-');
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

export function createStore(factory: IDBFactory = indexedDB) {
  let connection: Promise<IDBDatabase> | undefined;

  function open() {
    return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open('skybreak', 1);
      opening.onupgradeneeded = () => {
        const runs = opening.result.createObjectStore('runs', { keyPath: 'id' });
        runs.createIndex('eventDay', 'eventDay');
        runs.createIndex('altitude', 'altitude');
        opening.result.createObjectStore('metadata').put(localDay(), 'eventDay');
      };
      opening.onsuccess = () => {
        const db = opening.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        resolve(db);
      };
      opening.onerror = () => { connection = undefined; reject(opening.error); };
    });
  }

  async function transaction<T>(mode: IDBTransactionMode,
    work: (runs: IDBObjectStore, meta: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await open();
    const tx = db.transaction(['runs', 'metadata'], mode);
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
    });
    const [result] = await Promise.all([work(tx.objectStore('runs'), tx.objectStore('metadata')), committed]);
    return result;
  }

  async function activeDay(meta: IDBObjectStore): Promise<string> {
    return await request(meta.get('eventDay')) ?? localDay();
  }

  return {
    saveRun(run: Omit<Run, 'eventDay'>) {
      return transaction('readwrite', async (runs, meta) => {
        const existing: Run | undefined = await request(runs.get(run.id));
        if (existing) return existing;
        const saved: Run = { ...run, eventDay: await activeDay(meta) };
        await request(runs.add(saved));
        return saved;
      });
    },
    topToday(n: number) {
      return transaction('readonly', async (runs, meta) =>
        rankRuns(await request(runs.index('eventDay').getAll(await activeDay(meta)))).slice(0, n));
    },
    topAllTime(n: number) {
      return transaction('readonly', async runs => rankRuns(await request(runs.getAll())).slice(0, n));
    },
    latestRun() {
      return transaction('readonly', async runs => {
        const entries: Run[] = await request(runs.getAll());
        return entries.reduce<Run | undefined>((latest, run) =>
          !latest || run.createdAt > latest.createdAt ? run : latest, undefined);
      });
    },
    rankOf(run: Run): Promise<Ranks> {
      return transaction('readonly', async (runs, meta) => {
        const day = await activeDay(meta);
        const all = rankRuns(await request(runs.getAll()));
        const position = (entries: Run[]) => entries.findIndex(entry => entry.id === run.id) + 1 || null;
        return { today: position(all.filter(entry => entry.eventDay === day)), allTime: position(all) };
      });
    },
    clearDay() {
      return transaction('readwrite', async (runs, meta) => {
        const keys = await request(runs.index('eventDay').getAllKeys(await activeDay(meta)));
        await Promise.all(keys.map(key => request(runs.delete(key))));
      });
    },
    exportCsv() {
      return transaction('readonly', async runs => runsCsv(await request(runs.getAll())));
    },
    startNewEventDay() {
      return transaction('readwrite', async (runs, meta) => {
        const date = localDay();
        const current = await activeDay(meta);
        const index = runs.index('eventDay');
        let day = date;
        for (let suffix = 2; day === current || await request(index.count(day)); suffix++) {
          day = `${date}.${suffix}`;
        }
        await request(meta.put(day, 'eventDay'));
        return day;
      });
    },
    getSetting<K extends 'pin' | 'sound'>(key: K): Promise<Metadata[K]> {
      return transaction('readonly', async (_, meta) => await request(meta.get(key)) ?? defaults[key]);
    },
    setSetting<K extends 'pin' | 'sound'>(key: K, value: Metadata[K]) {
      return transaction('readwrite', async (_, meta) => { await request(meta.put(value, key)); });
    },
  };
}

export const store = createStore();

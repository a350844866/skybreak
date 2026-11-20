import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  count, frameSummary, idle, openGame, playRun, quantile, saveWithInitials, seeded, skilled, sloppy, STAGES,
  waitSaved, watchProblems,
} from '../e2e/support';

/**
 * Booth soak (DESIGN.md §Milestones 4): many runs back to back in ONE page, the
 * way a booth machine runs all day. Every third run is played well, sloppily
 * (misses, false starts) or not at all, so every code path repeats; every tenth
 * run is abandoned on the results screen and saved by the idle timeout.
 *
 *   npm run soak                      # 300 runs, about five hours
 *   SOAK_RUNS=20 npm run soak         # quick check
 *   SOAK_OUT=/some/dir npm run soak   # where soak.json / soak.md go (default test-results/soak)
 */
const runs = Number(process.env.SOAK_RUNS ?? 300);
const sampleEvery = Number(process.env.SOAK_SAMPLE_EVERY ?? 10);
const out = process.env.SOAK_OUT ?? 'test-results/soak';
const names = ['ACE', 'BOB', 'CAT', 'DOT', 'EVE', 'FAY', 'GUS', 'HAL', 'IVY', 'JOY'];
const styles = { skilled, sloppy, idle };

interface Sample { run: number; minutes: number; heapMB: number; nodes: number; listeners: number; documents: number }
interface RunRow {
  run: number; style: string; saved: 'initials' | 'idle'; altitude: number; flashes: number; hits: number;
  stageWorkP95: number; stageWorkMax: number; stageIntervalP95: number; stageFramesOver50ms: number;
}

/** Least-squares slope of y over x. */
function slope(points: readonly [number, number][]): number {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((sum, [x]) => sum + x, 0) / n;
  const my = points.reduce((sum, [, y]) => sum + y, 0) / n;
  const sxx = points.reduce((sum, [x]) => sum + (x - mx) ** 2, 0);
  return sxx ? points.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0) / sxx : 0;
}

test.skip(process.env.npm_lifecycle_event !== 'soak' && !process.env.SOAK_RUNS,
  'Long-running: start it with `npm run soak` (SOAK_RUNS=N for a shorter run).');

test(`booth soak: ${runs} runs back to back keep frame time, heap and DOM flat`, async ({ page, context }) => {
  const problems = watchProblems(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await openGame(page);
  const random = seeded(2026);
  const started = Date.now();
  const samples: Sample[] = [];
  const rows: RunRow[] = [];

  async function sample(run: number) {
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const metric = (name: string) => metrics.find(entry => entry.name === name)?.value ?? Number.NaN;
    samples.push({
      run, minutes: (Date.now() - started) / 60_000, heapMB: usedSize / 2 ** 20,
      nodes: metric('Nodes'), listeners: metric('JSEventListeners'), documents: metric('Documents'),
    });
  }

  async function report(final: boolean) {
    const warm = samples.filter(entry => entry.run >= 10);
    const work = rows.map(row => row.stageWorkP95);
    const tenth = Math.max(1, Math.floor(rows.length / 10));
    const summary = {
      runs: rows.length, final, minutes: (Date.now() - started) / 60_000, problems,
      heapSlopeKBPerRun: slope(warm.map(entry => [entry.run, entry.heapMB * 1024])),
      heapMB: { first: warm[0]?.heapMB, last: warm[warm.length - 1]?.heapMB, max: Math.max(...warm.map(e => e.heapMB)) },
      nodes: { min: Math.min(...warm.map(e => e.nodes)), max: Math.max(...warm.map(e => e.nodes)) },
      listeners: { min: Math.min(...warm.map(e => e.listeners)), max: Math.max(...warm.map(e => e.listeners)) },
      documentsMax: Math.max(...samples.map(e => e.documents)),
      stageWorkP95: { firstTenth: quantile(work.slice(0, tenth), 0.5), lastTenth: quantile(work.slice(-tenth), 0.5) },
    };
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'soak.json'), JSON.stringify({ summary, samples, rows }, null, 2));
    const table = samples.map(e => `| ${e.run} | ${e.minutes.toFixed(1)} | ${e.heapMB.toFixed(2)} | ${e.nodes} | ${e.listeners} | ${e.documents} |`);
    await writeFile(join(out, 'soak.md'), [
      `# Skybreak soak (${final ? 'final' : 'in progress'})`, '',
      '```json', JSON.stringify(summary, null, 2), '```', '',
      '| after run | minutes | heap after GC (MB) | DOM nodes | JS listeners | documents |',
      '|---:|---:|---:|---:|---:|---:|', ...table, '',
    ].join('\n'));
    return summary;
  }

  await sample(0);
  let summary: Awaited<ReturnType<typeof report>>;
  try {
    await soak();
  } finally {
    // Written even when a run fails, so a long soak never loses its data.
    summary = await report(rows.length === runs);
  }
  expect(summary.documentsMax, 'no leaked documents').toBe(1);
  if (samples.filter(entry => entry.run >= 10).length >= 3) {
    // GC'd heap samples are steady to well under 1 KB/run; a leak of one run's
    // state (stage objects, listeners, DOM) is far larger than 15 KB per run.
    expect(summary.heapSlopeKBPerRun, 'heap growth per run after warm-up (KB)').toBeLessThan(15);
    expect(summary.nodes.max - summary.nodes.min, 'DOM nodes stay flat').toBeLessThanOrEqual(30);
    expect(summary.listeners.max - summary.listeners.min, 'listeners stay flat').toBeLessThanOrEqual(10);
  }
  expect(summary.stageWorkP95.lastTenth, 'frame work does not creep up (ms)')
    .toBeLessThan(summary.stageWorkP95.firstTenth * 1.5 + 1);

  async function soak() {
    for (let run = 1; run <= runs; run++) {
      const style = (['skilled', 'sloppy', 'idle'] as const)[run % 3];
      const log = await playRun(page, styles[style], { random });
      expect(log.phases[log.phases.length - 1], `run ${run} reached the results`).toBe('RESULTS');
      const altitude = Number((await page.locator('.card-altitude').innerText()).replace(/[^\d]/g, ''));
      const abandoned = run % 10 === 0;
      if (abandoned) await waitSaved(page, 40_000);
      else await saveWithInitials(page, names[run % names.length]);

      const frames = frameSummary(log.frames);
      const stages = STAGES.map(stage => frames[stage]).filter(Boolean);
      rows.push({
        run, style, saved: abandoned ? 'idle' : 'initials', altitude,
        flashes: count(log, 'flash'), hits: count(log, 'drone-hit'),
        stageWorkP95: Math.max(...stages.map(entry => entry.workP95)),
        stageWorkMax: Math.max(...stages.map(entry => entry.workMax)),
        stageIntervalP95: Math.max(...stages.map(entry => entry.intervalP95)),
        stageFramesOver50ms: stages.reduce((sum, entry) => sum + entry.over50ms, 0),
      });
      // Fail fast: an error in run 12 should not wait five hours to be reported.
      expect(problems, `page errors / console errors by run ${run}`).toEqual([]);
      if (run % sampleEvery === 0 || run === runs) {
        await sample(run);
        await report(false);
      }
    }
  }
});

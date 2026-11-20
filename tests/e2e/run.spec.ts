import { expect, test } from '@playwright/test';
import {
  count, firstUseFrames, frameSummary, idle, openGame, playRun, saveWithInitials, seeded, skilled, STAGES, timeline,
  waitPhase, waitSaved, watchProblems,
} from './support';

test.describe('a full run', () => {
  // SwiftShader on a 2-vCPU CI runner manages ~1.5 fps at 1080p, too slow for
  // the bot to catch drones; GPU frame time at booth resolution is measured on
  // real hardware (playtest/bot_mbp.py). Every mouse move waits for a frame, so
  // the bot also jumps straight onto each drone.
  test.use({ viewport: { width: 960, height: 540 } });
  const fast = { ...skilled, drones: { steps: 1, stepMs: 0 } };

  test('scores every stage, saves initials to both screens and stays within the frame budget',
    async ({ page, context }, testInfo) => {
      const problems = watchProblems(page);
      await openGame(page);
      const board = await context.newPage();
      const boardProblems = watchProblems(board);
      await board.goto('/?view=board');
      await expect(board.locator('.board')).toBeVisible();
      await expect(board.locator('.live')).toBeHidden();
      await page.bringToFront();

      let liveDuringRun = false;
      const log = await playRun(page, fast, {
        random: seeded(1),
        onPhase: async phase => {
          if (phase === 'STAGE_DRONES') liveDuringRun = await board.locator('.live').isVisible();
        },
      });
      expect(log.phases).toEqual(['COUNTDOWN', 'STAGE_LIGHTNING', 'STAGE_DRONES', 'STAGE_COMET', 'RESULTS']);
      expect(liveDuringRun, 'the board shows LIVE while a run is in progress').toBe(true);

      // Lightning: five genuine reactions. The reported time runs from the flash
      // frame's timestamp to the click: never shorter than the real delay, and no
      // extra latency added on top (presentation delay is not visible here).
      expect(count(log, 'flash')).toBe(5);
      expect(count(log, 'false-start')).toBe(0);
      for (const reaction of log.reactions) {
        expect(reaction.verdict).toBe('reaction');
        const actual = reaction.noticedMs + reaction.waitedMs;
        expect(reaction.reportedMs!).toBeGreaterThanOrEqual(actual - 2);
        expect(reaction.reportedMs!).toBeLessThanOrEqual(actual + 100);
      }

      // Drones: the bot hits every one it sees.
      const drones = timeline(log, ['drone-spawn', 'drone-hit', 'drone-miss', 'drone-escape']);
      expect(count(log, 'drone-hit'), drones).toBeGreaterThanOrEqual(10);
      expect(count(log, 'drone-escape'), drones).toBeLessThanOrEqual(2);
      // A click can land just after its drone escaped (a slow frame); a click on a
      // live drone must never be a miss.
      const droneEvents = log.fx.filter(event => event.type.startsWith('drone-'));
      droneEvents.forEach((event, index) => {
        if (event.type !== 'drone-miss') return;
        const before = droneEvents[index - 1];
        expect(before?.type === 'drone-escape' && before.point?.x === event.point?.x, `miss on a live drone\n${drones}`)
          .toBe(true);
      });
      // Streak rule: each hit is paid at 1.0 + 0.1 per previous consecutive hit
      // (capped at 2.0); a miss or an escape resets it.
      let streak = 0;
      for (const event of log.fx) {
        if (event.type === 'drone-hit') {
          expect(event.multiplier!, `multiplier after ${streak} straight hits`).toBeCloseTo((10 + Math.min(streak, 10)) / 10, 5);
          streak++;
        } else if (event.type === 'drone-miss' || event.type === 'drone-escape') streak = 0;
      }

      // Comet ran (locking is checked at a size SwiftShader can keep up with, below).
      expect(count(log, 'comet')).toBeGreaterThan(20);

      // Results: the skill card adds up and shows all four skills.
      const altitude = Number((await page.locator('.card-altitude').innerText()).replace(/[^\d]/g, ''));
      expect(altitude).toBeGreaterThan(10_000);
      await expect(page.locator('.bars .bar')).toHaveCount(4);
      await expect(page.locator('.card-detail')).toContainText('5/5 strikes · 0 too early');
      await expect(page.locator('#beat-line')).toHaveText('First run of the day!');

      // Frame budget. SwiftShader cannot say anything about GPU time; this guards
      // the JavaScript side (stage update + scene submission) and stalls.
      const frames = frameSummary(log.frames);
      const firstUse = frameSummary(firstUseFrames(log));
      await testInfo.attach('frames.json', { body: JSON.stringify({ frames, firstUse }, null, 2), contentType: 'application/json' });
      for (const stage of STAGES) {
        // SwiftShader on CI manages only a few frames per second; "rendered at all" is the check.
        expect(frames[stage]?.frames ?? 0, `${stage} rendered`).toBeGreaterThan(10);
        // Real GPU: ≤ 0.6 ms (playtest-mbp). The margin absorbs CI CPU contention.
        expect(frames[stage].workP95, `${stage} JS p95 (ms)`).toBeLessThan(8);
        // A fresh page: every program was compiled during ATTRACT, so the first
        // frame of a stage and the first frame to draw an effect (e.g. the first
        // flash, whose reaction clock is already running) must not stall.
        expect(firstUse[stage]?.workMax, `${stage} first-use frame JS max (ms) on a fresh page`).toBeLessThan(50);
      }

      await saveWithInitials(page, 'ZED');
      await expect(page.locator('#today-scores')).toContainText('ZED');
      await expect(board.locator('#board-today')).toContainText('ZED');
      await expect(board.locator('.live')).toBeHidden();
      expect(problems).toEqual([]);
      expect(boardProblems).toEqual([]);
    });
});

test.describe('the comet', () => {
  // Small enough for SwiftShader to keep a real frame rate, so a cursor that
  // follows the comet is at most a few pixels behind it.
  test.use({ viewport: { width: 640, height: 360 } });

  test('locks while the cursor follows it', async ({ page }) => {
    const problems = watchProblems(page);
    await openGame(page);
    const tracked = await playRun(page, { reactionMs: [150, 190], drones: null, track: true }, { random: seeded(3) });
    const comet = tracked.fx.filter(event => event.type === 'comet');
    expect(comet.length).toBeGreaterThan(200);
    const locked = comet.filter(event => event.locked).length / comet.length;
    expect(locked, 'share of comet frames locked while following').toBeGreaterThan(0.6);
    const bestLock = Number(/([\d.]+) s best lock/.exec(await page.locator('.card-detail').innerText())?.[1]);
    expect(bestLock, 'longest lock on the results card (s)').toBeGreaterThan(0.5);
    expect(problems).toEqual([]);
  });
});

test('false starts and anticipation are penalised; genuine reactions are not', async ({ page }) => {
  const problems = watchProblems(page);
  await openGame(page);
  // The second flash is answered 10 ms after it appears, faster than any human:
  // it must count as anticipation, not as a 10 ms reaction. Not the first flash:
  // on SwiftShader the first strike's material set-up can hold the main thread
  // for over 100 ms, which would delay the synthetic click itself.
  await page.evaluate(() => { window.__e2e.anticipate = { flash: 2, delayMs: 10 }; });
  const log = await playRun(page, {
    reactionMs: [150, 190], earlyClicks: 2, ignoreFlash: 2, drones: null, track: false,
  }, { random: seeded(2) });

  const verdicts = log.fx.filter(event => event.type === 'reaction' || event.type === 'false-start');
  const [firstFlash, secondFlash] = log.fx.filter(event => event.type === 'flash');
  expect(verdicts.filter(event => event.at < firstFlash.at).map(event => event.type),
    'clicks before any flash').toEqual(['false-start', 'false-start']);
  const anticipated = verdicts.find(event => event.at > secondFlash.at);
  expect(anticipated?.type, `a 10 ms answer (reported ${anticipated?.ms} ms)`).toBe('false-start');
  // Six flashes may not fit in the 15 s stage cap, so the count of genuine
  // reactions varies; four flashes always fit.
  const reactions = log.fx.filter(event => event.type === 'reaction');
  expect(reactions.length).toBeGreaterThanOrEqual(3);
  for (const reaction of reactions) expect(reaction.ms!).toBeGreaterThanOrEqual(100);
  await expect(page.locator('.card-detail')).toContainText(`${reactions.length}/5 strikes · 3 too early`);
  expect(problems).toEqual([]);
});

test('an abandoned run survives stray clicks and is saved after 25 s on the results screen', async ({ page }) => {
  const problems = watchProblems(page);
  await openGame(page);
  const log = await playRun(page, idle);

  expect(count(log, 'flash'), 'an unanswered flash stays up until the stage ends').toBe(1);
  expect(count(log, 'reaction')).toBe(0);
  expect(count(log, 'drone-hit')).toBe(0);
  expect(count(log, 'drone-escape')).toBeGreaterThanOrEqual(10);
  await expect(page.locator('.card-detail')).toContainText('0/5 strikes');

  // A stray click must not throw the result away or skip ahead, and counts as
  // activity: after 10 s on the card, the 25 s idle timeout restarts from it.
  await page.waitForTimeout(10_000);
  await page.mouse.click(40, 40);
  const idleFrom = Date.now();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.body.dataset.phase)).toBe('RESULTS');
  await waitPhase(page, 'ATTRACT', 35_000);
  const idleMs = Date.now() - idleFrom;
  expect(idleMs).toBeGreaterThan(23_000);
  expect(idleMs).toBeLessThan(28_000);
  await waitSaved(page);
  await expect(page.locator('#today-scores')).toContainText('AAA');
  expect(problems).toEqual([]);
});

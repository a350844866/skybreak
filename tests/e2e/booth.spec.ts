import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { cyanNear, drainFx, openGame, playRun, startRun, waitPhase, watchProblems } from './support';
import type { Fx } from './support';

/** Reads the effect stream in order, keeping whatever arrives after the event it was waiting for. */
function fxReader(page: Page) {
  const pending: Fx[] = [];
  return {
    async next(type: string, timeout = 4_000): Promise<Fx> {
      const deadline = Date.now() + timeout;
      for (;;) {
        const index = pending.findIndex(event => event.type === type);
        if (index >= 0) return pending.splice(0, index + 1)[index];
        if (Date.now() > deadline) {
          throw new Error(`no ${type} effect within ${timeout} ms; saw: ${pending.map(event => event.type).join(', ') || 'nothing'}`);
        }
        pending.push(...await drainFx(page));
        await page.waitForTimeout(10);
      }
    },
    /** Drops everything unread and returns it. */
    async skip(): Promise<Fx[]> { return [...pending.splice(0), ...await drainFx(page)]; },
  };
}

test('a resize mid-stage keeps the drone drawn on, and hittable at, its new position', async ({ page }) => {
  const problems = watchProblems(page);
  await openGame(page);
  const log = await playRun(page, { reactionMs: [180, 220], drones: null, track: false }, { until: 'STAGE_DRONES' });
  const fx = fxReader(page);

  // Like a booth operator toggling fullscreen while a drone is up: a drone that
  // was spawned at the old size must be drawn where it is now hit-tested.
  // SwiftShader can be too slow to capture a drone before it leaves, so retry
  // on fresh drones; a broken re-projection fails every attempt.
  const sizes = [{ width: 1280, height: 720 }, { width: 1600, height: 900 }];
  let drawn = 0;
  let stale = 0;
  for (let attempt = 0; attempt < 3 && drawn <= 150; attempt++) {
    if (attempt) await fx.skip();
    const drone = attempt === 0 ? log.fx.find(event => event.type === 'drone-spawn') ?? await fx.next('drone-spawn')
      : await fx.next('drone-spawn');
    const [old, size] = attempt % 2 === 0 ? sizes : [sizes[1], sizes[0]];
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    const x = drone.point!.x * size.width;
    const y = drone.point!.y * size.height;
    drawn = await cyanNear(page, x, y, 14);
    // Where a mesh left at its old pixel position would now be drawn (y is bottom-up in world space).
    const was = { x: drone.point!.x * old.width, y: size.height - (1 - drone.point!.y) * old.height };
    stale = Math.hypot(was.x - x, was.y - y) > 60 ? await cyanNear(page, was.x, was.y, 14) : 0;
  }
  expect(drawn, 'the drone is drawn at its re-projected position').toBeGreaterThan(150);
  expect(stale, 'nothing is drawn where the drone was before the resize').toBeLessThan(100);

  // And hit-tested there. The operator panel pauses the stage, so the slow
  // resize cannot run the drone's clock out before the click.
  await fx.skip();
  const target = await fx.next('drone-spawn');
  await page.keyboard.press('Control+Shift+O');
  await expect(page.locator('dialog.operator')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.locator('#close-operator').click();
  await page.mouse.click(target.point!.x * 1440, target.point!.y * 810);
  const hit = await fx.next('drone-hit', 1_500);
  expect(hit.point).toEqual(target.point);
  expect(problems).toEqual([]);
});

test('opening the operator panel freezes the stage clock', async ({ page }) => {
  const problems = watchProblems(page);
  await openGame(page);
  await startRun(page);
  await waitPhase(page, 'STAGE_LIGHTNING');
  const fx = fxReader(page);
  const remaining = () => page.evaluate(() =>
    Number(/scaleX\(([\d.]+)\)/.exec(document.querySelector<HTMLElement>('#timer-fill')!.style.transform)?.[1]));
  await page.keyboard.press('Control+Shift+O');
  await expect(page.locator('dialog.operator')).toBeVisible();
  expect((await fx.skip()).map(event => event.type), 'paused before the first flash').not.toContain('flash');
  const before = await remaining();
  // Every flash is due within 3 s of the stage starting; none may appear while paused,
  // and the 15 s stage timer must not run down (3.5 s would be 0.23 of the bar).
  await page.waitForTimeout(3_500);
  expect((await fx.skip()).map(event => event.type)).not.toContain('flash');
  expect(await page.evaluate(() => document.body.dataset.phase)).toBe('STAGE_LIGHTNING');
  await page.locator('#close-operator').click();
  await expect(page.locator('dialog.operator')).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(before - await remaining(), 'share of the stage timer used while paused').toBeLessThan(0.1);
  await fx.next('flash', 3_500);
  expect(problems).toEqual([]);
});

/**
 * Puts one run on today's board directly in IndexedDB, in the schema the app
 * created (src/store/index.ts, version 1). The only place the tests go behind the
 * UI; a schema version bump makes this fail loudly.
 */
async function seedRun(page: Page, initials: string, altitude: number) {
  await page.evaluate(({ initials, altitude }) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('skybreak', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const now = new Date();
      const eventDay = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map(part => String(part).padStart(2, '0')).join('-');
      const tx = opening.result.transaction('runs', 'readwrite');
      tx.objectStore('runs').put({
        id: `seeded-${initials}`, initials, altitude, createdAt: now.getTime(), eventDay,
        stats: {
          lightning: { reactionsMs: [250], falseStarts: 0 },
          drones: { outcomes: [{ kind: 'hit', ttkMs: 400 }] },
          comet: { elapsedMs: 20_000, locksMs: [1_500] },
        },
      });
      tx.oncomplete = () => { opening.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { initials, altitude });
}

test('operator tools: PIN gate, diagnostics, CSV export, clearing today and changing the PIN', async ({ page }) => {
  const problems = watchProblems(page);
  await openGame(page, '');
  await expect(page.locator('#today-scores')).toHaveText('No runs yet');
  await seedRun(page, 'OPS', 12_345);
  await page.reload();
  await expect(page.locator('#today-scores')).toContainText('OPS');

  const dialog = page.locator('dialog.operator');
  const unlock = async (pin: string) => {
    await dialog.locator('#operator-login input').fill(pin);
    await dialog.getByRole('button', { name: 'Unlock' }).click();
  };
  await page.keyboard.press('Control+Shift+O');
  await unlock('1234');
  await expect(dialog.locator('#operator-status')).toHaveText('Incorrect PIN.');
  await expect(dialog.locator('#operator-controls')).toBeHidden();
  await unlock('0909');
  await expect(dialog.locator('#operator-controls')).toBeVisible();
  await expect(dialog.locator('#diagnostics')).toHaveText(/^\d+\.\d fps · \d+\.\d ms p95 · 0 runs this session/);

  const download = page.waitForEvent('download');
  await dialog.locator('#export-csv').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('skybreak-runs.csv');
  const csv = await readFile((await file.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toBe('id,initials,altitude,stats,createdAt,eventDay');
  expect(csv).toContain('"OPS","12345"');

  await dialog.locator('#clear-day').click();
  await dialog.locator('#confirm-delete').click();
  await expect(dialog.locator('#operator-status')).toHaveText('Today’s runs cleared.');

  await dialog.locator('#change-pin input').fill('4321');
  await dialog.getByRole('button', { name: 'Change PIN' }).click();
  await expect(dialog.locator('#operator-status')).toHaveText('PIN changed.');
  await dialog.locator('#close-operator').click();
  await expect(page.locator('#today-scores')).toHaveText('No runs yet');

  await page.keyboard.press('Control+Shift+O');
  await unlock('0909');
  await expect(dialog.locator('#operator-status')).toHaveText('Incorrect PIN.');
  await unlock('4321');
  await expect(dialog.locator('#operator-controls')).toBeVisible();
  expect(problems).toEqual([]);
});

test('offline: game and leaderboard screen load and play with the network down', async ({ page, context }) => {
  const problems = watchProblems(page);
  await openGame(page, '');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });

  await context.setOffline(true);
  expect((await page.reload())?.fromServiceWorker(), 'the page came from the offline cache').toBe(true);
  await waitPhase(page, 'ATTRACT');
  await expect(page.locator('.logo')).toBeVisible();
  await expect(page.locator('#panel')).not.toContainText('WebGL is unavailable');
  const board = await context.newPage();
  const boardProblems = watchProblems(board);
  expect((await board.goto('/?view=board'))?.fromServiceWorker()).toBe(true);
  await expect(board.locator('.board')).toBeVisible();
  await page.bringToFront();
  await startRun(page);
  await waitPhase(page, 'STAGE_LIGHTNING');
  expect(problems).toEqual([]);
  expect(boardProblems).toEqual([]);
});

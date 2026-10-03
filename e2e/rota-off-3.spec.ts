import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { BIGYAN, EDDIE, PUKAR, signInEmail } from './support/timesheet';
import { AMARA, RACHEL } from './support/rota';

/* Module 3, D9 and D13: Rota is a module the tenant turns on. On the social
   seed it is on, so its pages are in the nav and the timesheet carries the
   rota; on the qnipay seed it is off, so every rota page is gone from the nav
   and cannot be reached by its address, the server answers nothing about it,
   and the timesheet carries no rota at all. */
const ROTA_PAGES = ['/team/trota', '/team/tcover', '/team/tshifts', '/team/tpat', '/work/shifts', '/setup/mrota'];

test('with Rota on, its pages are in the nav and the timesheet carries the rota', async ({ page, api }) => {
  await api.seed('social'); await api.setClock(FROZEN);
  await signInEmail(page, RACHEL);
  await page.getByTestId(tid.nav.group('team')).click();
  await page.getByTestId(tid.nav.menu('scheduling')).click();
  for (const view of ['trota', 'tcover', 'tshifts', 'tpat']) await expect(page.getByTestId(tid.nav.tab(view)), view).toBeVisible();
  await page.keyboard.press('Escape');

  await signInEmail(page, AMARA);
  await page.getByTestId(tid.nav.group('work')).click();
  await expect(page.getByTestId(tid.nav.tab('shifts'))).toBeVisible();
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).click();
  await expect(page.getByTestId(tid.ts.banner('rota'))).toBeVisible();
});

test('with Rota off (qnipay), the rota pages are gone from the nav and their addresses, the server refuses them, and the timesheet shows no rota', async ({ page, api }) => {
  test.setTimeout(90_000);
  await api.seed('qnipay'); await api.setClock(FROZEN);
  await signInEmail(page, PUKAR);
  await page.getByTestId(tid.nav.group('team')).click();
  await page.getByTestId(tid.nav.menu('scheduling')).click();
  await expect(page.getByTestId(tid.nav.tab('thours'))).toBeVisible();
  for (const view of ['trota', 'tcover', 'tshifts', 'tpat']) await expect(page.getByTestId(tid.nav.tab(view)), view).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const path of ROTA_PAGES.filter(p => p.startsWith('/team'))) {
    await page.goto(path);
    await expect(page, path).not.toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByTestId(tid.page(path.split('/').pop() ?? ''))).toHaveCount(0);
  }
  for (const path of ['/api/v1/rota/home', '/api/v1/rota/weeks/MAN/2026-08-10', '/api/v1/rota/cover', '/api/v1/rota/patterns']) {
    const r = await api.get(path);
    expect(r.status, path).toBeGreaterThanOrEqual(400);
  }

  await signInEmail(page, BIGYAN);
  await expect(page.getByTestId(tid.nav.tab('shifts'))).toHaveCount(0);
  await page.goto('/work/shifts');
  await expect(page).not.toHaveURL(/\/work\/shifts$/);
  expect((await api.get('/api/v1/rota/my-shifts')).status).toBeGreaterThanOrEqual(400);
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).click();
  await page.getByTestId(tid.dayForm.field('start')).waitFor();
  await expect(page.getByTestId(tid.ts.banner('rota'))).toHaveCount(0);
  await expect(page.getByTestId(tid.dayForm.stat('rota'))).toHaveCount(0);
  await expect(page.getByTestId(tid.dayForm.field('start'))).toHaveValue('');
  await page.getByTestId(tid.ts.view('week')).click();
  await page.getByTestId(tid.week.grid).waitFor();
  await expect(page.getByTestId(tid.ts.fillRota)).toHaveCount(0);
  await expect(page.getByTestId(tid.ts.contracted)).not.toContainText('Rota’d');

  await signInEmail(page, EDDIE);
  await page.goto('/setup/mrota');
  await expect(page).not.toHaveURL(/\/setup\/mrota$/);
  await expect(page.getByTestId(tid.page('mrota'))).toHaveCount(0);
  expect((await api.get('/api/v1/rota/config')).status).toBeGreaterThanOrEqual(400);
});

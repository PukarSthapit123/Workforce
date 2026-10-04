import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { BIGYAN, EDDIE, PUKAR, TODAY, dayState, signInEmail } from './support/timesheet';
import { askFor, decide, leaveAudit } from './support/leave';

/* Module 4, the administrator on Leave setup on qnipay (brief D11): leave no
   longer blocks timesheet capture and the approval SLA drops to 3 days, both
   applied only on Save, with one audit row carrying the before and after;
   then their effect, where colleagues meet them. Time on a day of approved
   leave now saves without "called in and worked anyway", the banner still
   shown (D8), and the request form says the manager has 3 days to decide. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });

test('an administrator turns off leave blocking the timesheet and shortens the SLA; time on a leave day then saves, and the request form shows the new SLA', async ({ page, api }) => {
  await signInEmail(page, EDDIE);
  await page.goto('/setup/mleave');
  await page.getByTestId(tid.mleave.card('rota')).waitFor();
  await expect(page.getByTestId(tid.mleave.toggle('blocksTimesheet'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId(tid.mleave.save)).toBeDisabled();
  const cfg = (await api.get('/api/v1/leave/config')).body as { config: { version: number } };

  await page.getByTestId(tid.mleave.toggle('blocksTimesheet')).click();
  await page.getByTestId(tid.mleave.num('slaDays')).fill('3');
  await expect(page.getByTestId(tid.mleave.dirty)).toBeVisible();
  /* nothing is stored until Save */
  expect(((await api.get('/api/v1/leave/config')).body as { config: { version: number } }).config.version).toBe(cfg.config.version);
  await page.getByTestId(tid.mleave.save).click();
  await expect(info(page, 'Leave setup saved. It applies across the tenant straight away.')).toBeVisible();
  await expect(page.getByTestId(tid.mleave.dirty)).toHaveCount(0);
  expect(((await api.get('/api/v1/leave/config')).body as { config: unknown }).config)
    .toMatchObject({ version: cfg.config.version + 1, blocksTimesheet: false, slaDays: 3 });
  const saved = await leaveAudit(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ act: 'Leave setup saved', before: { blocksTimesheet: true, slaDays: 5 }, after: { blocksTimesheet: false, slaDays: 3 } });

  /* today becomes a day of Bigyan's approved leave */
  await signInEmail(page, BIGYAN);
  const asked = await askFor(api, TODAY);
  await signInEmail(page, PUKAR);
  expect((await decide(page, asked, 'approve')).status).toBe(200);

  /* the banner still says so, but the time saves without the tick */
  await signInEmail(page, BIGYAN);
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).click();
  await expect(page.getByTestId(tid.ts.banner('absence'))).toContainText('Annual leave is recorded for this day');
  await page.getByTestId(tid.dayForm.field('start')).fill('09:00');
  await page.getByTestId(tid.dayForm.field('finish')).fill('17:00');
  await page.getByTestId(tid.dayForm.save).click();
  await expect(info(page, 'Draft saved · 08:00 · not submitted yet')).toBeVisible();
  expect(await dayState(api, 'EMP004', TODAY)).toMatchObject({ state: 'draft', minutes: 480 });

  /* the request form names the shorter SLA */
  await page.goto('/work/leave');
  await page.getByTestId(tid.leave.requestOpen).click();
  await expect(page.getByTestId(tid.leave.sla)).toContainText('Manish Nepal has 3 days to decide');
});

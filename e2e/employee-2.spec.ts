import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { auditOf } from './support/read';
import { BIGYAN, EDDIE, TODAY, dayState, signInEmail } from './support/timesheet';

/* Module 2, the employee's journey on My timesheet: save a day as a draft,
   submit it, submit the week in one request with the held-back days listed,
   and a day in a closed pay period that cannot be saved at all. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });

test('an employee saves a day, submits it, submits the rest of the week in one request, and cannot save a day in a closed period', async ({ page, api }) => {
  await signInEmail(page, BIGYAN);
  await page.goto('/work/ts');
  /* a grid type opens on the week */
  await expect(page.getByTestId(tid.ts.view('week'))).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId(tid.ts.view('day')).click();
  await expect(page.getByTestId(tid.ts.dayLabel)).toContainText('Thu 13 Aug');
  await expect(page.getByTestId(tid.ts.dayState)).toContainText('Nothing logged');

  await page.getByTestId(tid.dayForm.field('start')).fill('09:00');
  await page.getByTestId(tid.dayForm.field('finish')).fill('17:00');
  await expect(page.getByTestId(tid.dayForm.stat('net'))).toContainText('08:00');
  await page.getByTestId(tid.dayForm.save).click();
  await expect(page.getByTestId(tid.toast.info).filter({ hasText: 'Draft saved · 08:00 · not submitted yet' })).toBeVisible();
  expect(await dayState(api, 'EMP004', TODAY)).toMatchObject({ state: 'draft', minutes: 480 });

  await page.getByTestId(tid.dayForm.submit).click();
  await expect(page.getByTestId(tid.toast.info).filter({ hasText: 'Day submitted · 08:00 · routed to Manish Nepal for sign-off' })).toBeVisible();
  await expect(page.getByTestId(tid.ts.dayState)).toContainText('Awaiting approval');
  expect((await dayState(api, 'EMP004', TODAY)).state).toBe('pend');

  /* the week: Monday is new, Friday is in the future, Wednesday and today are already with the approver */
  await page.getByTestId(tid.ts.view('week')).click();
  await page.getByTestId(tid.week.grid).waitFor();
  await page.getByTestId(tid.week.cell(0, 0, 'start')).fill('09:00');
  await page.getByTestId(tid.week.cell(0, 0, 'finish')).fill('17:30');
  await page.getByTestId(tid.week.cell(0, 4, 'start')).fill('09:00');
  await page.getByTestId(tid.week.cell(0, 4, 'finish')).fill('17:00');
  const submitted = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/weeks/2026-08-10/submit'));
  await page.getByTestId(tid.ts.submitWeek).click();
  expect((await submitted).status()).toBe(200);
  await expect(page.getByTestId(tid.toast.info).filter({ hasText: 'Week 33 submitted · 1 day · 08:30 · routed to Manish Nepal' })).toBeVisible();
  await expect(page.getByTestId(tid.ts.weekResult)).toContainText('Fri 14 Aug is in the future, so it is held back until it happens.');
  expect(await dayState(api, 'EMP004', '2026-08-10')).toMatchObject({ state: 'pend', minutes: 510 });
  expect((await dayState(api, 'EMP004', '2026-08-14')).state).toBe('none');

  /* a closed pay period: the lock note, who to ask, and no way to save */
  await page.getByTestId(tid.ts.view('day')).click();
  for (let i = 0; i < 6; i++) await page.getByTestId(tid.ts.dayPrev).click();
  await expect(page.getByTestId(tid.ts.dayLabel)).toContainText('Fri 7 Aug');
  await expect(page.getByTestId(tid.ts.banner('locked'))).toContainText('Pay period 03/08/2026 – 09/08/2026 closed at Monday 12:00');
  await expect(page.getByTestId(tid.ts.banner('locked'))).toContainText('Ask Manish Nepal to raise an amendment.');
  await expect(page.getByTestId(tid.dayForm.save)).toBeDisabled();
  await expect(page.getByTestId(tid.dayForm.submit)).toBeDisabled();
  expect((await dayState(api, 'EMP004', '2026-08-07', '2026-08-03')).state).toBe('draft');

  /* one audit row per write: the draft, the day submission and the week submission */
  await signInEmail(page, EDDIE);
  expect((await auditOf(api, 'timesheetDay')).map(a => a.act)).toHaveLength(3);
});

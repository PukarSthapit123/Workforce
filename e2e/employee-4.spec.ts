import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { BIGYAN, PUKAR, TODAY, dayState, sendVersioned, signInEmail } from './support/timesheet';
import { askFor, decide, leaveAudit, myLeave, openRequest } from './support/leave';

/* Module 4, the employee's journeys on qnipay (brief D14): ask for leave and
   see it waiting, a half day across two dates and more than the balance
   refused where the dates are, a waiting request cancelled (D1, D2, Review
   Focus 2 and 3); and My timesheet on a day of approved leave, where saving
   time is refused with ABSENCE_BLOCKED until the day is marked called in and
   worked anyway (D8, Review Focus 5). */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });

test('an employee asks for leave and sees it waiting; a half day across two dates and more than the balance are refused inline; a waiting request is cancelled', async ({ page, api }) => {
  await signInEmail(page, BIGYAN);
  await page.goto('/work/leave');
  await page.getByTestId(tid.leave.cards).waitFor();
  await expect(page.getByTestId(tid.leave.annual)).toContainText('12.5 of 24 days');
  await expect(page.getByTestId(tid.leave.pending)).toContainText('2 days');
  const before = await myLeave(api);

  /* a morning across two dates: the form says why and Send stays off */
  await openRequest(page, '2026-09-14', '2026-09-14');
  await page.getByTestId(tid.leave.part).click();
  await page.getByTestId(`${tid.leave.part}-option-am`).click();
  await expect(page.getByTestId(tid.leave.qty)).toHaveValue('0.5 days · 4.00 hours');
  await page.getByTestId(tid.leave.to).fill('2026-09-15');
  await expect(page.getByTestId(tid.field.root(tid.leave.qty))).toContainText('Morning only applies to a single day. Set both dates the same.');
  await expect(page.getByTestId(tid.leave.send)).toBeDisabled();

  /* more than the 12.5 days left, the waiting request already held back */
  await page.getByTestId(tid.leave.part).click();
  await page.getByTestId(`${tid.leave.part}-option-full`).click();
  await page.getByTestId(tid.leave.to).fill('2026-09-30');
  await expect(page.getByTestId(tid.field.root(tid.leave.qty))).toContainText('That is more than the 12.5 days you have left.');
  await expect(page.getByTestId(tid.leave.send)).toBeDisabled();
  /* the server holds the same line: straight to it, refused on the last day */
  const over = await api.send('POST', '/api/v1/leave/requests', { type: 'AL', from: '2026-09-14', to: '2026-09-30', part: 'full' });
  expect([over.status, over.body]).toEqual([422, expect.objectContaining({ code: 'OVER_BALANCE', field: 'to', message: 'That is more than the 12.5 days you have left.' })]);
  const half = await api.send('POST', '/api/v1/leave/requests', { type: 'AL', from: '2026-09-14', to: '2026-09-15', part: 'am' });
  expect([half.status, (half.body as { code: string }).code]).toEqual([422, 'invalid']);
  expect(await myLeave(api)).toEqual(before);

  /* two days within the balance */
  await page.getByTestId(tid.leave.to).fill('2026-09-15');
  await expect(page.getByTestId(tid.leave.qty)).toHaveValue('2 days · 16.00 hours');
  await page.getByTestId(tid.leave.note).fill('Wedding');
  await page.getByTestId(tid.leave.send).click();
  await expect(info(page, 'Annual leave requested · 2 days · 16.00 hours · sent to Manish Nepal')).toBeVisible();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
  const row = page.getByTestId(tid.leave.request('lr_6'));
  await expect(row).toContainText('14/09/2026 – 15/09/2026 · Annual leave · 2 days');
  await expect(page.getByTestId(tid.leave.state('lr_6'))).toContainText('Waiting');
  await expect(page.getByTestId(tid.leave.pending)).toContainText('4 days');
  /* pending holds the days back from the balance (D2) */
  expect((await myLeave(api)).balance).toMatchObject({ pending: 4, leftD: 10.5, takenD: before.balance.takenD });

  /* cancel it: the days come back, exactly once */
  await page.getByTestId(tid.leave.cancel('lr_6')).click();
  await expect(info(page, 'Request cancelled. Your manager has been told.')).toBeVisible();
  await expect(page.getByTestId(tid.leave.state('lr_6'))).toContainText('Cancelled');
  await expect(page.getByTestId(tid.leave.cancel('lr_6'))).toHaveCount(0);
  const after = await myLeave(api);
  expect(after.balance).toEqual(before.balance);
  expect(after.requests.find(r => r.id === 'lr_6')).toMatchObject({ state: 'cancelled', version: 2 });
  /* a cancelled request cannot be cancelled again */
  const again = await sendVersioned(page, 'POST', '/api/v1/leave/requests/lr_6/cancel', 2);
  expect([again.status, (again.body as { code: string }).code]).toEqual([409, 'TRANSITION_NOT_ALLOWED']);
  expect((await leaveAudit(page)).map(a => a.act)).toEqual(['Leave requested', 'Leave request cancelled']);
});

test('on a day of approved leave My timesheet shows the banner; saving time is refused until the day is marked called in and worked anyway', async ({ page, api }) => {
  /* today goes onto Bigyan's leave: asked for by him, approved by Pukar */
  await signInEmail(page, BIGYAN);
  const asked = await askFor(api, TODAY);
  await signInEmail(page, PUKAR);
  expect((await decide(page, asked, 'approve')).status).toBe(200);

  await signInEmail(page, BIGYAN);
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).click();
  await expect(page.getByTestId(tid.ts.dayLabel)).toContainText('Thu 13 Aug');
  await expect(page.getByTestId(tid.ts.banner('absence'))).toContainText('Annual leave is recorded for this day');
  await expect(page.getByTestId(tid.ts.dayState)).toContainText('Annual leave');

  await page.getByTestId(tid.dayForm.field('start')).fill('09:00');
  await page.getByTestId(tid.dayForm.field('finish')).fill('17:00');
  const refused = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes(`/days/${TODAY}`));
  await page.getByTestId(tid.dayForm.save).click();
  const res = await refused;
  expect(res.status()).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe('ABSENCE_BLOCKED');
  await expect(page.getByTestId(tid.dayForm.refusal)).toContainText('Annual leave is recorded for this day. Approved absence blocks timesheet capture');
  await expect(page.getByTestId(tid.dayForm.refusal)).toContainText('If you did work, mark the day non-working and tick “Called in and worked anyway”.');
  expect((await dayState(api, 'EMP004', TODAY)).state).toBe('none');

  await page.getByTestId(tid.ts.nonWorking).click();
  await page.getByTestId(tid.ts.workedAnyway).click();
  await expect(page.getByTestId(tid.dayForm.field('start'))).toHaveValue('09:00');
  await page.getByTestId(tid.dayForm.save).click();
  await expect(info(page, 'Draft saved · 08:00 · not submitted yet')).toBeVisible();
  expect(await dayState(api, 'EMP004', TODAY)).toMatchObject({ state: 'draft', minutes: 480 });
});

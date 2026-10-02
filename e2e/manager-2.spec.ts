import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { BIGYAN, EDDIE, PUKAR, TODAY, dayState, sendVersioned, signInEmail } from './support/timesheet';

/* Module 2, the manager's journey on Team timesheets (Review Focus 1, 4 and
   5): approve one day, return another with a reason, approve the rest in
   bulk, enter a day on a team member's behalf and approve it from the week
   matrix. Then the permission paths, straight to the server: their own day,
   someone outside their location, and an employee with no team rights. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
const BIGYAN_DAY = 'tsd_EMP004_2026-08-12', BIJAY_DAY = 'tsd_EMP005_2026-08-11', JAMIR_DAY = 'tsd_EMP007_2026-08-10';

test('a manager approves a day, returns one with a reason, and approves the rest in bulk, each queued for Business Central', async ({ page, api }) => {
  await signInEmail(page, PUKAR);
  await page.goto('/team/tteam');
  await expect(page.getByTestId(tid.tteam.pending)).toContainText('3 timesheets awaiting your decision');

  await page.getByTestId(tid.tteam.approve(BIGYAN_DAY)).click();
  await expect(page.getByTestId(tid.toast.info).last()).toContainText('Approved · Bigyan Poudel · queued for Business Central');
  await expect(page.getByTestId(tid.tteam.row(BIGYAN_DAY))).toHaveCount(0);
  expect((await dayState(api, 'EMP004', '2026-08-12')).state).toBe('ok');

  await page.getByTestId(tid.tteam.ret(BIJAY_DAY)).click();
  await page.getByTestId(tid.tteam.returnConfirm).click();
  await expect(page.getByTestId(tid.field.root(tid.tteam.returnReason))).toContainText('A reason is required.');
  await page.getByTestId(tid.tteam.returnReason).fill('The waking night allowance needs a note.');
  await page.getByTestId(tid.tteam.returnConfirm).click();
  await expect(page.getByTestId(tid.toast.info).last()).toContainText('Sent back with a reason · Bijay Shrestha');
  expect(await dayState(api, 'EMP005', '2026-08-11')).toMatchObject({ state: 'back', record: { returnReason: 'The waking night allowance needs a note.' } });

  await expect(page.getByTestId(tid.tteam.pending)).toContainText('1 timesheet awaiting your decision');
  await page.getByTestId(tid.tteam.approveAll).click();
  await expect(page.getByTestId(tid.modal.title)).toContainText('Approve 1 timesheet');
  await page.getByTestId(tid.tteam.bulkConfirm).click();
  await expect(page.getByTestId(tid.tteam.bulkWarn)).toContainText('Tick the confirmation to continue.');
  await page.getByTestId(tid.tteam.bulkAck).click();
  await page.getByTestId(tid.tteam.bulkConfirm).click();
  await expect(page.getByTestId(tid.toast.info).last()).toContainText('1 approved');
  await expect(page.getByTestId(tid.tteam.clear)).toContainText('Nothing waiting on you');
  expect((await dayState(api, 'EMP007', '2026-08-10')).state).toBe('ok');

  /* the approvals queue never claims posted: approved days show what the dispatcher last resolved */
  await page.getByTestId(tid.tteam.filter('ok')).click();
  await expect(page.getByTestId(tid.tteam.row(JAMIR_DAY))).toBeVisible();
  await expect(page.getByTestId(tid.tteam.dot(JAMIR_DAY))).toBeAttached();
});

test('a manager enters a day on a team member’s behalf, it shows as a proxy entry, and they approve it from the week matrix', async ({ page, api }) => {
  await signInEmail(page, PUKAR);
  await page.goto('/team/tpeople');
  await page.getByTestId(tid.people.open('EMP005')).click();
  await page.getByTestId(tid.proxy.open).click();
  await expect(page.getByTestId(tid.modal.title)).toContainText('Log time · Bijay Shrestha');
  await expect(page.getByTestId(tid.proxy.banner)).toContainText('attributed to you');
  await page.getByTestId(tid.dayForm.field('start')).fill('07:00');
  await page.getByTestId(tid.dayForm.field('finish')).fill('15:00');
  await page.getByTestId(tid.proxy.submitDay).click();
  await expect(page.getByTestId(tid.toast.info).last())
    .toContainText('Submitted for Bijay Shrestha on their behalf · 13/08/2026 · 08:00 · attributed to you · Bijay notified');
  expect(await dayState(api, 'EMP005', TODAY)).toMatchObject({ state: 'pend', record: { captureSource: 'proxy', enteredBy: 'EMP001' } });

  const proxyDay = `tsd_EMP005_${TODAY}`;
  await page.goto('/team/tteam');
  await expect(page.getByTestId(tid.tteam.proxyPill(proxyDay))).toBeVisible();

  await page.getByTestId(tid.tteam.view('week')).click();
  await page.getByTestId(tid.tteam.matrix).waitFor();
  await expect(page.getByTestId(tid.tteam.pip('EMP005', 3))).toHaveAttribute('data-state', 'pend');
  await page.getByTestId(tid.tteam.mxCheck('EMP005')).click();
  await page.getByTestId(tid.tteam.approveSelected).click();
  /* Bijay's 11/08 day is pending too, so the week approves both */
  await expect(page.getByTestId(tid.toast.info).last()).toContainText('2 days approved · 1 employee · queued for Business Central');
  await expect(page.getByTestId(tid.tteam.pip('EMP005', 3))).toHaveAttribute('data-state', 'ok');
  expect((await dayState(api, 'EMP005', TODAY)).state).toBe('ok');
  expect((await dayState(api, 'EMP004', '2026-08-12')).state).toBe('pend');
});

test('the server refuses a manager’s own day, a day outside their location, and an employee with no team rights', async ({ page, api }) => {
  /* everyone in the qnipay roster is at Manchester, so the admin moves Jamir to Remote first */
  await signInEmail(page, EDDIE);
  const jamir = (await api.get('/api/v1/people/per_EMP007')).body as { version: number };
  expect((await sendVersioned(page, 'PATCH', '/api/v1/people/per_EMP007', jamir.version, { location: 'REM' })).status).toBe(200);

  await signInEmail(page, PUKAR);
  await page.goto('/team/tteam');
  await page.getByTestId(tid.tteam.table).waitFor();
  /* their own day, submitted, then put to themselves */
  const own = await sendVersioned(page, 'POST', `/api/v1/timesheets/EMP001/days/${TODAY}/submit`, 0, { entries: [{ start: '09:00', finish: '17:00', breaks: [] }] });
  expect(own.status).toBe(200);
  const self = await sendVersioned(page, 'POST', `/api/v1/timesheet-days/tsd_EMP001_${TODAY}/transition`, 1, { to: 'ok', reason: '' });
  expect([self.status, (self.body as { code: string }).code]).toEqual([403, 'SELF_APPROVAL']);
  expect((self.body as { next: string }).next).toBe('Ask another approver at your location.');
  expect((await dayState(api, 'EMP001', TODAY)).state).toBe('pend');

  /* someone at another location: not in the queue, and refused by the server */
  await expect(page.getByTestId(tid.tteam.row(BIGYAN_DAY))).toBeVisible();
  await expect(page.getByTestId(tid.tteam.row(JAMIR_DAY))).toHaveCount(0);
  const outside = await sendVersioned(page, 'POST', `/api/v1/timesheet-days/${JAMIR_DAY}/transition`, 1, { to: 'ok', reason: '' });
  expect(outside.status).toBe(403);
  const proxy = await sendVersioned(page, 'PUT', `/api/v1/timesheets/EMP007/days/${TODAY}`, 0, { entries: [{ start: '09:00', finish: '17:00', breaks: [] }] });
  expect(proxy.status).toBe(403);

  await signInEmail(page, BIGYAN);
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).waitFor();
  const queue = await api.get('/api/v1/approvals/timesheets?status=pend');
  expect(queue.status).toBe(403);
  const decide = await sendVersioned(page, 'POST', '/api/v1/timesheet-days/tsd_EMP005_2026-08-11/transition', 1, { to: 'ok', reason: '' });
  expect(decide.status).toBe(403);
  const theirs = await api.get('/api/v1/timesheets/EMP005/weeks/2026-08-10');
  expect(theirs.status).toBe(403);
  expect((await dayState(api, 'EMP004', '2026-08-12')).state).toBe('pend');
});

import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { auditOf } from './support/read';
import { BIGYAN, EDDIE, PUKAR, TODAY, WEEK, dayState, sendVersioned, signInEmail, weekOf } from './support/timesheet';

/* Module 2 Review Focus 6: a 500 on any timesheet write shows the refusal and
   leaves no record and no audit row. One journey across the writes: save a
   day, submit a day, submit a week, submit earlier weeks, enter a day as
   proxy, approve, approve in bulk, save Timesheet setup and retry a posting.
   A fault is registered after signing in, because signing in reloads the
   page and faults live in the page (fixtures.ts). */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });

test('a fault on any timesheet write shows the refusal, and leaves no record and no audit row', async ({ page, api }) => {
  test.setTimeout(120_000);
  const refused = async () => { await expect(page.getByTestId(tid.toast.error).last()).toContainText('Nothing has been changed'); };
  const day = `/api/v1/timesheets/EMP004/days/${TODAY}`;

  await signInEmail(page, BIGYAN);
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).click();
  const before = await weekOf(api, 'EMP004');
  await page.getByTestId(tid.dayForm.field('start')).fill('09:00');
  await page.getByTestId(tid.dayForm.field('finish')).fill('17:00');
  await api.fault('PUT', day, 500);
  await page.getByTestId(tid.dayForm.save).click();
  await refused();
  await api.fault('POST', `${day}/submit`, 500);
  await page.getByTestId(tid.dayForm.submit).click();
  await refused();
  await expect(page.getByTestId(tid.dayForm.field('start'))).toHaveValue('09:00');
  await expect(page.getByTestId(tid.ts.dayState)).toContainText('Nothing logged');

  await page.getByTestId(tid.ts.view('week')).click();
  await page.getByTestId(tid.week.grid).waitFor();
  await page.getByTestId(tid.week.cell(0, 0, 'start')).fill('09:00');
  await page.getByTestId(tid.week.cell(0, 0, 'finish')).fill('17:00');
  await api.fault('POST', `/api/v1/timesheets/EMP004/weeks/${WEEK}/submit`, 500);
  await page.getByTestId(tid.ts.submitWeek).click();
  await refused();
  await page.getByTestId(tid.ts.mwAll).click();
  await api.fault('POST', '/api/v1/timesheets/EMP004/multiweek/submit', 500);
  await page.getByTestId(tid.ts.mwSubmit).click();
  await refused();
  expect(await weekOf(api, 'EMP004')).toEqual(before);
  expect((await dayState(api, 'EMP004', '2026-08-03', '2026-08-03')).state).toBe('draft');

  await signInEmail(page, PUKAR);
  await page.goto('/team/tpeople');
  await page.getByTestId(tid.people.open('EMP005')).click();
  await page.getByTestId(tid.proxy.open).click();
  await page.getByTestId(tid.dayForm.field('start')).fill('07:00');
  await page.getByTestId(tid.dayForm.field('finish')).fill('15:00');
  await api.fault('POST', `/api/v1/timesheets/EMP005/days/${TODAY}/submit`, 500);
  await page.getByTestId(tid.proxy.submitDay).click();
  await refused();
  await expect(page.getByTestId(tid.proxy.banner)).toBeVisible();
  expect((await dayState(api, 'EMP005', TODAY)).state).toBe('none');
  await page.keyboard.press('Escape');

  await page.goto('/team/tteam');
  const bigyanDay = 'tsd_EMP004_2026-08-12';
  await page.getByTestId(tid.tteam.row(bigyanDay)).waitFor();
  const queue = (await api.get('/api/v1/approvals/timesheets?status=all')).body as { rows: unknown[] };
  await api.fault('POST', `/api/v1/timesheet-days/${bigyanDay}/transition`, 500);
  await page.getByTestId(tid.tteam.approve(bigyanDay)).click();
  await refused();
  await expect(page.getByTestId(tid.tteam.row(bigyanDay))).toBeVisible();
  await page.getByTestId(tid.tteam.approveAll).click();
  await page.getByTestId(tid.tteam.bulkAck).click();
  await api.fault('POST', '/api/v1/approvals/timesheets/bulk', 500);
  await page.getByTestId(tid.tteam.bulkConfirm).click();
  await refused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(tid.tteam.pending)).toContainText('3 timesheets awaiting your decision');
  expect(((await api.get('/api/v1/approvals/timesheets?status=all')).body as { rows: unknown[] }).rows).toEqual(queue.rows);

  await signInEmail(page, EDDIE);
  await page.goto('/setup/mts');
  await page.getByTestId(tid.mts.card('rules')).waitFor();
  const config = (await api.get('/api/v1/timesheet-config')).body as { config: { version: number } };
  await page.getByTestId(tid.mts.rule('maxDaily')).selectOption('12');
  await api.fault('PATCH', '/api/v1/timesheet-config', 500);
  await page.getByTestId(tid.mts.save).click();
  await refused();
  await expect(page.getByTestId(tid.mts.dirty)).toBeVisible();
  expect((await api.get('/api/v1/timesheet-config')).body).toEqual(config);

  /* the posting retry has no screen in this module (it is module 6's), so it is called directly */
  await api.fault('POST', '/api/v1/integration/attempts/int_a1f3/retry', 500);
  expect((await sendVersioned(page, 'POST', '/api/v1/integration/attempts/int_a1f3/retry', 1)).status).toBe(500);

  for (const entity of ['timesheetDay', 'timesheetConfig', 'integrationAttempt']) expect(await auditOf(api, entity), entity).toEqual([]);
});

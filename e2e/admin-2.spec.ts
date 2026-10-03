import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { auditOf, pick } from './support/read';
import { BIGYAN, EDDIE, TODAY, dayState, sendVersioned, signInEmail } from './support/timesheet';

/* Module 2, the admin's journey (Review Focus 2, D3 and D12): a capture rule
   changed on Timesheet setup applies on Save, with one audit row holding the
   before and after, and the employee's next save is refused by it, on screen
   and by the server. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });

test('an admin lowers the daily maximum on Timesheet setup, and the employee’s 13-hour day is then refused by it', async ({ page, api }) => {
  await signInEmail(page, EDDIE);
  await page.goto('/setup/mts');
  await page.getByTestId(tid.mts.card('rules')).waitFor();
  await expect(page.getByTestId(tid.mts.rule('maxDaily'))).toHaveValue('16');
  await page.getByTestId(tid.mts.rule('maxDaily')).selectOption('12');
  await expect(page.getByTestId(tid.mts.dirty)).toBeVisible();
  /* nothing is stored until Save */
  expect(((await api.get('/api/v1/timesheet-config')).body as { config: { rules: { maxDaily: number } } }).config.rules.maxDaily).toBe(16);
  await page.getByTestId(tid.mts.save).click();
  await expect(page.getByTestId(tid.toast.info).filter({ hasText: 'Timesheet setup saved. It applies to the next save or submission.' })).toBeVisible();
  await expect(page.getByTestId(tid.mts.save)).toBeDisabled();
  expect(((await api.get('/api/v1/timesheet-config')).body as { config: { rules: { maxDaily: number } } }).config.rules.maxDaily).toBe(12);
  const saved = await auditOf(api, 'timesheetConfig');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ before: { rules: { maxDaily: 16 } }, after: { rules: { maxDaily: 12 } } });

  /* the audit log can be filtered to timesheet setup */
  await page.goto('/setup/iaudit');
  await page.getByTestId(tid.audit.table).waitFor();
  await pick(page, tid.audit.filterEntity, 'timesheetConfig');
  await expect(page.getByTestId(tid.audit.table)).toContainText('Timesheet setup');

  await signInEmail(page, BIGYAN);
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).click();
  await page.getByTestId(tid.dayForm.field('start')).fill('07:00');
  await page.getByTestId(tid.dayForm.field('finish')).fill('20:00');
  await page.getByTestId(tid.dayForm.save).click();
  await expect(page.getByTestId(tid.dayForm.warn)).toContainText('Net time is 13:00, above the 12-hour daily maximum.');
  expect((await dayState(api, 'EMP004', TODAY)).state).toBe('none');

  /* the server owns the rule: the same day sent straight to it is refused on the field */
  const refused = await sendVersioned(page, 'PUT', `/api/v1/timesheets/EMP004/days/${TODAY}`, 0, { entries: [{ start: '07:00', finish: '20:00', breaks: [] }] });
  expect(refused.status).toBe(422);
  expect(refused.body).toMatchObject({ code: 'TS_INVALID', field: 'entries.0.finish', message: 'Net time is 13:00, above the 12-hour daily maximum.' });
  expect((await dayState(api, 'EMP004', TODAY)).state).toBe('none');

  /* a 12-hour day is inside the new maximum and saves */
  await page.getByTestId(tid.dayForm.field('finish')).fill('19:00');
  await page.getByTestId(tid.dayForm.save).click();
  await expect(page.getByTestId(tid.toast.info).filter({ hasText: 'Draft saved · 12:00 · not submitted yet' })).toBeVisible();
  expect((await dayState(api, 'EMP004', TODAY)).minutes).toBe(720);
});

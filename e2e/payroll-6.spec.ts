import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { sendVersioned, signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL, auditRows, info, refusedToast } from './support/config';
import { FAILED_POSTING, RUN, clearPayrollBlockers, exceptionsAt, readinessOf } from './support/payroll';

/* Module 6, Payroll and Business Central surfaces, on social at the frozen
   clock (Thursday 13/08/2026). Amara Okafor (CP-1042) is a Support Worker at
   Willow House; Rachel Hussain (CP-1001) manages it and holds Team hours; Dee
   Fitzgerald is the administrator, who holds Workforce master data and
   Integration. The pay period is 03/08 to 16/08 (support/payroll.ts). */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

/* The saved file's lines, read from disk: what the person actually got. */
async function savedLines(d: Download): Promise<string[]> {
  const path = await d.path();
  return (await readFile(path, 'utf8')).split('\r\n').filter(Boolean);
}
const saved = (page: Page) => page.waitForEvent('download');

test('employee: My hours shows contracted, rota\'d and worked for the week, the flags they raise, and each day against the rota', async ({ page }) => {
  await signInEmail(page, AMARA);
  await page.goto('/work/hours');
  await page.getByTestId(tid.hours.days).waitFor();
  await expect(page.getByTestId(tid.hours.contracted)).toHaveText('37.5h');
  await expect(page.getByTestId(tid.hours.rotad)).toHaveText('33h');
  await expect(page.getByTestId(tid.hours.worked)).toHaveText('7.5h');
  await expect(page.getByTestId(tid.hours.checks)).toHaveText('1');
  await expect(page.getByTestId(tid.hours.flags)).toContainText('Under contracted');
  await expect(page.getByTestId(tid.hours.flags)).toContainText('2 nights');
  await expect(page.getByTestId(tid.hours.status('2026-08-10'))).toHaveText('Nothing recorded');
  await expect(page.getByTestId(tid.hours.variance('2026-08-10'))).toHaveText('-7.5h');
  await expect(page.getByTestId(tid.hours.status('2026-08-12'))).toContainText('Awaiting approval');
  await expect(page.getByTestId(tid.hours.status('2026-08-14'))).toHaveText('Still to come');
  await expect(page.getByTestId(tid.hours.status('2026-08-15'))).toHaveText('Rest day');
  await expect(page.getByTestId(tid.hours.total)).toContainText('33h');
});

test('manager: Team hours lists Willow House\'s week, and Export saves a real CSV whose row count is the toast\'s, with one audit row', async ({ page }) => {
  await signInEmail(page, RACHEL);
  await page.goto('/team/thours');
  await page.getByTestId(tid.thours.table).waitFor();
  await expect(page.getByTestId(tid.thours.location)).toContainText('Willow House');
  await expect(page.getByTestId(tid.thours.flags('CP-1042'))).toContainText('Under contracted');
  /* a bank worker has no contracted figure, so no variance against one */
  await expect(page.getByTestId(tid.thours.rotaVar('CP-1310'))).toHaveText('—');
  await page.getByTestId(tid.thours.search).fill('Amara');
  await expect(page.getByTestId(tid.thours.row('CP-1042'))).toBeVisible();
  await expect(page.getByTestId(tid.thours.row('CP-1310'))).toHaveCount(0);
  await page.getByTestId(tid.thours.search).fill('');

  const file = saved(page);
  await page.getByTestId(tid.thours.export).click();
  const d = await file;
  expect(d.suggestedFilename()).toBe('qnipay-hours-position-WH-10-08-2026.csv');
  const lines = await savedLines(d);
  await expect(info(page, `Exported · ${lines.length - 1} rows · qnipay-hours-position-WH-10-08-2026.csv`)).toBeVisible();
  expect(lines.length - 1).toBe(10);
  expect(lines[0]).toMatch(/^Employee ID,/);
  expect(lines.join('\n')).not.toMatch(/[£$€]|amount|rate|cost|currency/i);
  expect((await auditRows(page, 'hours')).map(a => a.after)).toEqual([{ location: 'WH', weekStart: '2026-08-10', rows: 10 }]);
});

test('manager: an exception is taken, refused a resolution without a note, resolved with one, then reopened, each with one audit row', async ({ page, api }) => {
  test.setTimeout(90_000);
  await signInEmail(page, RACHEL);
  const x = (await exceptionsAt(api)).items.find(i => i.kind === 'Hours');
  if (!x) throw new Error('no Hours exception at Willow House');
  await page.goto('/team/texc');
  await page.getByTestId(tid.texc.list).waitFor();
  await expect(page.getByTestId(tid.texc.filter('open'))).toHaveAttribute('aria-pressed', 'true');
  const row = page.getByTestId(tid.texc.row(x.id));
  await expect(page.getByTestId(tid.texc.state(x.id))).toContainText('Open');

  await row.getByTestId(tid.texc.move(x.id, 'take')).click();
  await expect(info(page, 'Taken · you are now the owner')).toBeVisible();
  await expect(page.getByTestId(tid.texc.state(x.id))).toContainText('In progress');
  await expect(page.getByTestId(tid.texc.meta(x.id))).toContainText('Owner: Rachel Hussain');

  await row.getByTestId(tid.texc.move(x.id, 'resolve')).click();
  const box = page.getByTestId(tid.modal.root);
  await box.getByTestId(tid.texc.confirm).click();
  await expect(refusedToast(page, 'A resolution note is required.')).toBeVisible();
  await expect(box).toContainText('A resolution note is required.');
  await box.getByTestId(tid.texc.note).fill('Hours corrected with the colleague and resubmitted');
  await box.getByTestId(tid.texc.confirm).click();
  await expect(info(page, 'Resolved · recorded against the exception')).toBeVisible();
  await expect(box).toHaveCount(0);
  /* resolved no longer needs action */
  await expect(row).toHaveCount(0);
  await page.getByTestId(tid.texc.filter('resolved')).click();
  await expect(page.getByTestId(tid.texc.state(x.id))).toContainText('Resolved');
  await expect(page.getByTestId(tid.texc.meta(x.id))).toContainText('Resolution: Hours corrected with the colleague and resubmitted');

  await row.getByTestId(tid.texc.move(x.id, 'reopen')).click();
  await expect(info(page, 'Reopened · it needs action again')).toBeVisible();
  await page.getByTestId(tid.texc.filter('open')).click();
  await expect(page.getByTestId(tid.texc.state(x.id))).toContainText('Reopened');
  await expect(page.getByTestId(tid.texc.meta(x.id))).toContainText('3 changes');
  expect((await auditRows(page, 'exception')).map(a => a.act)).toEqual(['Exception in progress', 'Exception resolved', 'Exception reopened']);
});

test('admin: a pay code is created and is at once a rate type, an edit says how many fields changed, and a code in use cannot be removed', async ({ page, api }) => {
  test.setTimeout(90_000);
  await signInEmail(page, DEE);
  await page.goto('/setup/mpay');
  await page.getByTestId(tid.mpay.table).waitFor();

  await page.getByTestId(tid.mpay.add).click();
  let box = page.getByTestId(tid.modal.root);
  await expect(box.getByTestId(tid.mpay.money)).toContainText('Nothing here sets a monetary value.');
  await box.getByTestId(tid.mpay.code).fill('ot-bh');
  await box.getByTestId(tid.mpay.label).fill('Overtime bank holiday');
  await box.getByTestId(tid.mpay.valueInput).fill('2');
  await box.getByTestId(tid.mpay.element).fill('PE-OTBH');
  await box.getByTestId(tid.mpay.wt).click();
  await box.getByTestId(tid.mpay.save).click();
  await expect(info(page, 'OT-BH created · Overtime bank holiday · available now as a rate type on timesheets and in Timesheet setup’s pay rules')).toBeVisible();
  await expect(page.getByTestId(tid.mpay.row('OT-BH'))).toContainText('PE-OTBH');
  await expect(page.getByTestId(tid.mpay.workType('OT-BH'))).toHaveText('Yes');
  const cfg = (await api.get('/api/v1/timesheet-config')).body as { payCodes: { code: string }[] };
  expect(cfg.payCodes.map(p => p.code)).toContain('OT-BH');

  /* the code is locked once it exists */
  await page.getByTestId(tid.mpay.edit('OT20')).click();
  box = page.getByTestId(tid.modal.root);
  await expect(box.getByTestId(tid.mpay.code)).toBeDisabled();
  await expect(box).toContainText('Codes cannot change. Postings already reference them.');
  await box.getByTestId(tid.mpay.valueInput).fill('2.5');
  await box.getByTestId(tid.mpay.wt).click();
  await box.getByTestId(tid.mpay.save).click();
  await expect(info(page, 'OT20 updated · 2 field(s) changed')).toBeVisible();
  await expect(page.getByTestId(tid.mpay.value('OT20'))).toContainText('2.5');

  await page.getByTestId(tid.mpay.edit('STD')).click();
  box = page.getByTestId(tid.modal.root);
  await expect(box.getByTestId(tid.mpay.inUse)).toContainText('In use by');
  await box.getByTestId(tid.mpay.remove).click();
  await expect(refusedToast(page, /^STD is used by 2 employee types and \d+ timesheet days\./)).toBeVisible();
  await expect(box.getByTestId(tid.mpay.warn)).toContainText(/STD is used by 2 employee types and \d+ timesheet days\./);
  await box.getByTestId(tid.mpay.cancel).click();
  await expect(page.getByTestId(tid.mpay.row('STD'))).toBeVisible();
  expect((await auditRows(page, 'payCode')).map(a => a.act)).toEqual(['Pay code created', 'Pay code edited']);
});

test('admin: a pay code saved over a newer version is refused with 412 and the reload prompt, re-read, and saved once applied again', async ({ page }) => {
  test.setTimeout(90_000);
  await signInEmail(page, DEE);
  await page.goto('/setup/mpay');
  await page.getByTestId(tid.mpay.edit('OT20')).click();
  const box = page.getByTestId(tid.modal.root);
  await expect(box.getByTestId(tid.mpay.valueInput)).toHaveValue('2');

  /* another administrator changes OT20 while the dialog is open */
  expect((await sendVersioned(page, 'PATCH', '/api/v1/pay-codes/pc_OT20', 1, { value: '2.5' })).status).toBe(200);

  await box.getByTestId(tid.mpay.label).fill('Overtime, double');
  const answer = page.waitForResponse(r => r.url().endsWith('/api/v1/pay-codes/pc_OT20') && r.request().method() === 'PATCH');
  await box.getByTestId(tid.mpay.save).click();
  expect((await answer).status()).toBe(412);
  const toast = refusedToast(page, 'Somebody changed this since you opened it. Your change has not been saved.');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Reload and apply your change again');
  /* the dialog starts again on what is stored: the other change shows, its own draft is gone */
  await expect(box.getByTestId(tid.mpay.valueInput)).toHaveValue('2.5');
  await expect(box.getByTestId(tid.mpay.label)).not.toHaveValue('Overtime, double');
  expect((await auditRows(page, 'payCode')).map(a => a.after)).toEqual([{ value: '2.5' }]);

  await box.getByTestId(tid.mpay.label).fill('Overtime, double');
  await box.getByTestId(tid.mpay.save).click();
  await expect(info(page, 'OT20 updated · 1 field(s) changed')).toBeVisible();
  expect(await auditRows(page, 'payCode')).toHaveLength(2);
});

test('admin: Payroll readiness blocks export while NOT READY; once ready the approved hours export as a real file, then reconcile, then reopen with a reason', async ({ page, api }) => {
  test.setTimeout(120_000);
  await signInEmail(page, DEE);
  await page.goto('/setup/ipay');
  await expect(page.getByTestId(tid.ipay.banner)).toContainText('NOT READY');
  await expect(page.getByTestId(tid.ipay.blockers)).toBeVisible();
  await expect(page.getByTestId(tid.ipay.export)).toBeDisabled();
  await expect(page.getByTestId(tid.ipay.reconcile)).toBeDisabled();

  await clearPayrollBlockers(page, api);
  await page.reload();
  await expect(page.getByTestId(tid.ipay.banner)).toContainText('READY WITH WARNINGS');
  await expect(page.getByTestId(tid.ipay.blockers)).toHaveCount(0);

  const file = saved(page);
  await page.getByTestId(tid.ipay.export).click();
  const d = await file;
  expect(d.suggestedFilename()).toBe('qnipay-payroll-03-08-2026.csv');
  const lines = await savedLines(d);
  const n = lines.length - 1;
  expect(n).toBeGreaterThan(0);
  expect(lines[0]).toBe('Employee ID,Name,Resource no.,Date,Shift,Pay code,Pay elements,Allowances,Hours,State,Integration');
  expect(lines.join('\n')).not.toMatch(/[£$€]|amount|rate|cost|currency/i);
  await expect(info(page, `Exported · ${n} approved record${n === 1 ? '' : 's'} · qnipay-payroll-03-08-2026.csv`)).toBeVisible();
  await expect(page.getByTestId(tid.ipay.banner)).toContainText('EXPORTED');
  await expect(page.getByTestId(tid.ipay.export)).toBeDisabled();

  await page.getByTestId(tid.ipay.reconcile).click();
  await expect(info(page, 'Reconciled · recorded against the period and the audit log')).toBeVisible();
  await expect(page.getByTestId(tid.ipay.banner)).toContainText('RECONCILED');

  await page.getByTestId(tid.ipay.reopen).click();
  const box = page.getByTestId(tid.modal.root);
  await box.getByTestId(tid.ipay.confirm).click();
  await expect(refusedToast(page, 'A reason for reopening is required.')).toBeVisible();
  await box.getByTestId(tid.ipay.reason).fill('A late correction to Willow House\'s hours');
  await box.getByTestId(tid.ipay.confirm).click();
  await expect(info(page, 'Period reopened · readiness recalculated')).toBeVisible();
  await expect(page.getByTestId(tid.ipay.banner)).toContainText('READY WITH WARNINGS');
  await expect(page.getByTestId(tid.ipay.history)).toContainText(`Exported`);
  await expect(page.getByTestId(tid.ipay.history)).toContainText('Reopened');
  await expect(page.getByTestId(tid.ipay.history)).toContainText('A late correction to Willow House\'s hours');
  expect((await auditRows(page, 'payrollRun')).map(a => [a.act, a.entityId])).toEqual([
    ['Payroll exported', RUN], ['Payroll reconciled', RUN], ['Payroll period reopened', RUN]]);
  expect((await readinessOf(api)).run).toMatchObject({ state: 'open', version: 3 });
});

test('admin: a failed posting is retried from Business Central; the toast says re-queued with the attempt, never accepted, and the dispatcher then resolves it', async ({ page }) => {
  test.setTimeout(90_000);
  await signInEmail(page, DEE);
  await page.goto('/setup/ibc');
  await expect(page.getByTestId(tid.ibc.banner)).toContainText('Business Central connection');
  await expect(page.getByTestId(tid.ibc.state(FAILED_POSTING))).toContainText('Failed');
  await expect(page.getByTestId(tid.ibc.tile('failed'))).toHaveText('1');

  await page.getByTestId(tid.ibc.retry(FAILED_POSTING)).click();
  const requeued = info(page, 'Re-queued. Attempt 2 is waiting on Business Central.');
  await expect(requeued).toBeVisible();
  await expect(requeued).not.toContainText(/accepted|posted/i);
  /* queued is queued: until the dispatcher has answered, it is neither posted nor failed */
  await expect(page.getByTestId(tid.ibc.state(FAILED_POSTING))).toContainText('Queued');
  await expect(page.getByTestId(tid.ibc.attempt(FAILED_POSTING))).toHaveText('2');
  await expect(page.getByTestId(tid.ibc.retry(FAILED_POSTING))).toHaveCount(0);

  /* the cause was not fixed, so the dispatcher fails it again, and says why */
  await expect(refusedToast(page, 'Posting failed · Batch WK32 · generic API · Line 2: unknown cost centre CC-991')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(tid.ibc.state(FAILED_POSTING))).toContainText('Failed');
  await expect(page.getByTestId(tid.ibc.attempt(FAILED_POSTING))).toHaveText('2');
  const acts = (await auditRows(page, 'integrationAttempt')).map(a => a.act);
  expect(acts[0]).toBe('Integration retry');
  expect(acts).toHaveLength(2);
});

test('the server refuses each module 6 write to a session without its capability, and nothing is written', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  for (const [method, path, body, v] of [
    ['PATCH', '/api/v1/pay-codes/pc_OT20', { value: '3' }, 1],
    ['POST', `/api/v1/payroll/runs/${RUN}/export`, undefined, 0],
    ['POST', `/api/v1/payroll/runs/${RUN}/reopen`, { reason: 'Why not' }, 0],
    ['POST', `/api/v1/integration/attempts/${FAILED_POSTING}/retry`, undefined, 1],
  ] as const) {
    const r = await sendVersioned(page, method, path, v, body);
    expect([path, r.status, (r.body as { code: string }).code]).toEqual([path, 403, 'capability']);
  }
  await signInEmail(page, AMARA);
  const x = await api.send('POST', '/api/v1/hours/team/export', { location: 'WH' });
  expect([x.status, (x.body as { code: string }).code]).toEqual([403, 'capability']);
  const exc = await sendVersioned(page, 'POST', '/api/v1/exceptions/exc_0000000000000000/take', 0);
  expect([exc.status, (exc.body as { code: string }).code]).toEqual([403, 'capability']);
  expect(await auditRows(page, 'hours', 'exception', 'payCode', 'payrollRun', 'integrationAttempt')).toEqual([]);
});

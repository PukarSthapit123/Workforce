import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { POSTING_DOT } from '../src/domain/timesheet';
import { signInEmail } from './support/timesheet';
import { DEE, RACHEL, auditRows, info } from './support/config';

/* Module 8, setup hardening: an administrator changes a setting and the rule
   visibly follows. Group 4, Timesheet: a payroll layer added to the
   Timesheet approval chain holds a day the line manager approves until
   payroll approves it too, and only then is it posted. On social, Rachel
   Hussain is the line manager at Whitehaven and Dee Fitzgerald the
   administrator, who approves timesheets for payroll. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const AMARA_DAY = 'tsd_CP-1042_2026-08-12';
const WAITING = 'Approved by manager, waiting on payroll';

test('a payroll layer added on Approvals: the manager\'s approval leaves the day waiting on payroll, and it is posted only after payroll approves', async ({ page }) => {
  test.setTimeout(90_000);
  await signInEmail(page, DEE);
  await page.goto('/setup/aappr');
  await page.getByTestId(tid.aappr.chainTable).waitFor();
  await page.getByTestId(tid.aappr.edit('Timesheet')).click();
  const box = page.getByTestId(tid.modal.root);
  /* the seeded payroll layer applies only above a premium threshold: take it out and add one for every timesheet */
  await box.getByTestId(tid.aappr.remove(1)).click();
  await box.getByTestId(tid.aappr.add).click();
  await box.getByTestId(tid.aappr.role(1)).selectOption('Payroll');
  await box.getByTestId(tid.aappr.scope(1)).selectOption('All departments');
  await box.getByTestId(tid.aappr.when(1)).selectOption('Every timesheet');
  await box.getByTestId(tid.aappr.chainSave).click();
  await expect(info(page, 'Timesheet approval chain saved: Line manager, then Payroll, then Business Central.')).toBeVisible();
  await expect(page.getByTestId(tid.aappr.row('Timesheet', 1))).toContainText('Every timesheet');

  await signInEmail(page, RACHEL);
  await page.goto('/team/tteam');
  const row = page.getByTestId(tid.tteam.row(AMARA_DAY));
  await row.getByTestId(tid.tteam.approve(AMARA_DAY)).click();
  await expect(info(page, 'Approved · Amara Okafor · now waiting on payroll')).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByTestId(tid.tteam.filter('mgrok')).click();
  await expect(page.getByTestId(tid.tteam.state(AMARA_DAY))).toHaveText(WAITING);
  await expect(page.getByTestId(tid.tteam.approve(AMARA_DAY))).toHaveCount(0);
  await expect(page.getByTestId(tid.tteam.dot(AMARA_DAY))).toContainText(POSTING_DOT.none.text);

  await signInEmail(page, DEE);
  await page.goto('/team/tteam');
  await expect(page.getByTestId(tid.tteam.state(AMARA_DAY))).toHaveText(WAITING);
  await page.getByTestId(tid.tteam.approve(AMARA_DAY)).click();
  await expect(info(page, 'Approved · Amara Okafor · queued for Business Central')).toBeVisible();
  /* the next read of the queue runs the dispatcher, which posts it */
  await page.getByTestId(tid.tteam.filter('ok')).click();
  await expect(page.getByTestId(tid.tteam.state(AMARA_DAY))).toHaveText('Approved');
  await expect(page.getByTestId(tid.tteam.dot(AMARA_DAY))).toContainText(POSTING_DOT.posted.text);
  expect((await auditRows(page, 'timesheetDay')).map(a => a.act).slice(-2)).toEqual(['Timesheet passed to payroll', 'Timesheet approved']);
});

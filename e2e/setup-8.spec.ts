import { test, expect, FROZEN } from './support/fixtures';
import type { Page } from '@playwright/test';
import { tid } from '../src/testids';
import { POSTING_DOT } from '../src/domain/timesheet';
import { sendVersioned, signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL, auditRows, info } from './support/config';
import { myLeave, openRequest } from './support/leave';

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

/* Group 4B. Dee gives the administrator template the capability a later layer
   needs, so there is a second person to decide it, then adds that layer on
   Approvals. */
async function grantAdmin(page: Page, api: { get(path: string): Promise<{ status: number; body: unknown }> }, cap: string) {
  const types = (await api.get('/api/v1/user-types')).body as { id: string; version: number }[];
  const admin = types.find(t => t.id === 'admin');
  if (!admin) throw new Error('no admin user type');
  expect((await sendVersioned(page, 'PUT', `/api/v1/user-types/admin/capabilities/${cap}`, admin.version, { granted: true })).status).toBe(200);
}

test('Rota: publish waits for sign-off', async ({ page, api }) => {
  test.setTimeout(120_000);
  await signInEmail(page, DEE);
  await grantAdmin(page, api, 'team_rota');
  /* week 34 is empty, so its gaps would block publishing: that rule is not what this journey shows */
  const rc = (await api.get('/api/v1/rota/config')).body as { config: { version: number } };
  expect((await sendVersioned(page, 'PATCH', '/api/v1/rota/config', rc.config.version, { publishBlockOnGap: false })).status).toBe(200);
  await page.goto('/setup/aappr');
  await page.getByTestId(tid.aappr.chainTable).waitFor();
  await page.getByTestId(tid.aappr.edit('Rota')).click();
  const box = page.getByTestId(tid.modal.root);
  await box.getByTestId(tid.aappr.when(0)).selectOption('Every rota week');
  await box.getByTestId(tid.aappr.add).click();
  await box.getByTestId(tid.aappr.scope(1)).selectOption('All departments');
  await box.getByTestId(tid.aappr.when(1)).selectOption('Every rota week');
  await box.getByTestId(tid.aappr.chainSave).click();
  await expect(info(page, 'Rota approval chain saved: Service Manager, then Service Manager.')).toBeVisible();

  /* the rota manager publishes week 34: it waits in review, which colleagues do not see */
  await signInEmail(page, RACHEL);
  await page.goto('/team/trota');
  await page.getByTestId(tid.trota.grid).waitFor();
  await page.getByTestId(tid.trota.weekNext).click();
  await expect(page.getByTestId(tid.trota.isoWeek)).toHaveText('Week 34');
  await page.getByTestId(tid.trota.publish).click();
  await expect(info(page, 'Week 34 sent for sign-off. It is published once the Service Manager signs it off.')).toBeVisible();
  const banner = page.getByTestId(tid.trota.signoff);
  await expect(banner).toContainText('Waiting on sign-off by the Service Manager');
  await expect(banner).toContainText('You sent this week to be published, so someone else signs it off.');
  await expect(page.getByTestId(tid.trota.state)).toContainText('In review');
  await expect(page.getByTestId(tid.trota.publish)).toBeDisabled();

  /* the Service Manager finds it waiting on them, signs it off, and it is published */
  await signInEmail(page, DEE);
  await page.goto('/team/trota');
  const awaiting = page.getByTestId(tid.trota.awaiting);
  await expect(awaiting).toContainText('1 week waiting on your sign-off');
  await awaiting.getByTestId(tid.trota.awaitingWeek('rw_WH_2026-08-17')).click();
  await expect(page.getByTestId(tid.trota.isoWeek)).toHaveText('Week 34');
  await page.getByTestId(tid.trota.signoff).getByTestId(tid.trota.signOff).click();
  await expect(info(page, /^Rota published · v1 · \d+ colleagues notified · signed off$/)).toBeVisible();
  await expect(page.getByTestId(tid.trota.signoff)).toHaveCount(0);
  await expect(page.getByTestId(tid.trota.state)).toContainText('Published · v1');
  expect((await auditRows(page, 'rotaWeek')).map(a => a.act).slice(-2)).toEqual(['Rota sent for sign-off', 'Rota published']);
});

test('Leave: a request the line manager approves waits on the Service Manager, and is approved only after both', async ({ page, api }) => {
  test.setTimeout(120_000);
  await signInEmail(page, DEE);
  await grantAdmin(page, api, 'team_leave');
  await page.goto('/setup/aappr');
  await page.getByTestId(tid.aappr.chainTable).waitFor();
  await page.getByTestId(tid.aappr.edit('Leave')).click();
  const box = page.getByTestId(tid.modal.root);
  /* the seeded Service Manager layer applies only once the SLA is breached: make it apply to every request */
  await box.getByTestId(tid.aappr.scope(1)).selectOption('All departments');
  await box.getByTestId(tid.aappr.when(1)).selectOption('Every leave request');
  await box.getByTestId(tid.aappr.chainSave).click();
  await expect(info(page, 'Leave approval chain saved: Line manager, then Service Manager.')).toBeVisible();

  await signInEmail(page, AMARA);
  await page.goto('/work/leave');
  await page.getByTestId(tid.leave.cards).waitFor();
  await openRequest(page, '2026-09-14', '2026-09-14');
  await page.getByTestId(tid.leave.send).click();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
  const mine = (await myLeave(api)).requests.find(r => r.from === '2026-09-14');
  if (!mine) throw new Error('the request was not stored');

  await signInEmail(page, RACHEL);
  await page.goto('/team/tleave');
  await page.getByTestId(tid.tleave.card(mine.id)).getByTestId(tid.tleave.approve(mine.id)).click();
  await expect(info(page, 'Amara’s request approved by you. It now waits on the Service Manager.')).toBeVisible();
  await expect(page.getByTestId(tid.tleave.card(mine.id))).toHaveCount(0);

  await signInEmail(page, AMARA);
  await page.goto('/work/leave');
  await expect(page.getByTestId(tid.leave.state(mine.id))).toContainText(LEAVE_WAITING);

  await signInEmail(page, DEE);
  await page.goto('/team/tleave');
  const card = page.getByTestId(tid.tleave.card(mine.id));
  await expect(card.getByTestId(tid.tleave.layer(mine.id))).toHaveText('Layer 2 of 2 · Service Manager. Approved by Rachel Hussain as the line manager.');
  await card.getByTestId(tid.tleave.approve(mine.id)).click();
  await expect(info(page, /^Amara’s leave approved/)).toBeVisible();

  await signInEmail(page, AMARA);
  await page.goto('/work/leave');
  await expect(page.getByTestId(tid.leave.state(mine.id))).toContainText('Approved');
  expect((await auditRows(page, 'leaveRequest')).map(a => a.act).slice(-3)).toEqual(['Leave requested', 'Leave passed to the Service Manager', 'Leave approved']);
});
const LEAVE_WAITING = 'Approved by the line manager, waiting on the Service Manager';

test('Leave: a new policy gives the right entitlement, and carry-over appears', async ({ page }) => {
  test.setTimeout(120_000);
  await signInEmail(page, DEE);
  await page.goto('/setup/mleave');
  await page.getByTestId(tid.mleave.card('types')).waitFor();
  await page.getByTestId(tid.mleave.policyAdd).click();
  const box = page.getByTestId(tid.modal.root);
  await box.getByTestId(tid.mleave.addCode).fill('senior');
  await box.getByTestId(tid.mleave.addName).fill('Senior annual leave');
  await box.getByTestId(tid.mleave.addSave).click();
  await expect(page.getByTestId(tid.mleave.policyCode)).toHaveText('SENIOR', { timeout: 10_000 });
  /* a set 30 days a year, pro-rated, with up to 5 unused days carried into the next year */
  await page.getByTestId(tid.mleave.policyNum(7, 'base')).fill('30');
  await page.getByTestId(tid.mleave.policyNum(7, 'carry')).fill('5');
  await page.getByTestId(tid.mleave.policySave).click();
  await expect(info(page, 'Senior annual leave saved. It applies across the tenant straight away.')).toBeVisible();
  await page.getByTestId(tid.mleave.policyBack).click();
  await page.getByTestId(tid.mleave.card('types')).waitFor();
  /* Support Workers move onto it */
  await page.getByTestId(tid.mleave.empType('shift')).click();
  await page.getByTestId(tid.mleave.tlPolicy).selectOption('SENIOR');
  await page.getByTestId(tid.mleave.save).click();
  await expect(page.getByTestId(tid.mleave.dirty)).toHaveCount(0, { timeout: 10_000 });

  /* Amara is a Support Worker on full-time hours: 30 days, and the 5 days of it she did not
     use last year carried over, 35 days in all */
  await signInEmail(page, AMARA);
  await page.goto('/work/leave');
  await page.getByTestId(tid.leave.entShow).click();
  const dialog = page.getByTestId(tid.modal.root);
  await expect(dialog.getByTestId(tid.leave.entPolicy)).toContainText('Senior annual leave');
  await expect(dialog.getByTestId(tid.leave.entLine(0))).toContainText('30 days');
  await expect(dialog).toContainText('5 of 5 days carried from 2025/26');
  await expect(dialog.getByTestId(tid.leave.entEntitlement)).toContainText('35 days');
  await expect(dialog.getByTestId(tid.leave.entCarry)).toContainText('5 days');
});

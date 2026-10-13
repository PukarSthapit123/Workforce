import { test, expect, FROZEN } from './support/fixtures';
import type { Page } from '@playwright/test';
import { tid } from '../src/testids';
import { POSTING_DOT } from '../src/domain/timesheet';
import { sendVersioned, signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL, auditRows, info, refusedToast } from './support/config';
import { TOM_SOCIAL, openPortal, pdf, uploadDoc } from './support/onboarding';
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

/* Group 5: the smaller setup gaps. */
test('Rota setup: a support level\'s new people per shift is what Team rota measures its locations against', async ({ page }) => {
  test.setTimeout(90_000);
  await signInEmail(page, DEE);
  await page.goto('/setup/mrota');
  await page.getByTestId(tid.mrota.card('staffing')).waitFor();
  await page.getByTestId(tid.mrota.levelMin('High')).fill('5');
  await page.getByTestId(tid.mrota.save).click();
  await expect(info(page, 'Rota setup saved. It applies across the tenant straight away.')).toBeVisible();
  const saved = (await auditRows(page, 'rotaConfig')).at(-1);
  expect(saved?.after).toMatchObject({ locations: expect.objectContaining({ WH: 5 }) });

  /* Willow House is a high support location: its rota now needs 5 on every shift */
  await signInEmail(page, RACHEL);
  await page.goto('/team/trota');
  await page.getByTestId(tid.trota.grid).waitFor();
  await expect(page.getByTestId(tid.trota.cov(0))).toHaveAttribute('aria-label', /of 5 on shift/);
});

test('Rota setup: new flexible-worker milestones and recipient show with the evidence on Notifications', async ({ page }) => {
  await signInEmail(page, DEE);
  await page.goto('/setup/mrota');
  await page.getByTestId(tid.mrota.card('flex')).waitFor();
  await expect(page.getByTestId(tid.mrota.flexNote)).toContainText('Counting bank weeks is not built yet');
  await page.getByTestId(tid.mrota.milestones).fill('6, 10');
  await page.getByTestId(tid.mrota.notifyTo).selectOption('Service Manager');
  await page.getByTestId(tid.mrota.save).click();
  await expect(info(page, 'Rota setup saved. It applies across the tenant straight away.')).toBeVisible();
  await page.goto('/setup/anotif');
  await expect(page.getByTestId(tid.anotif.flexMilestones)).toHaveText('Milestones at 6 and 10 weeks · notified to Service Manager');
});

test('Onboarding setup: a document the administrator adds and makes required is asked of a new starter, and cannot be removed once he holds it', async ({ page }) => {
  test.setTimeout(120_000);
  await signInEmail(page, DEE);
  await page.goto('/setup/monb');
  await page.getByTestId(tid.monb.docs).waitFor();
  await page.getByTestId(tid.monb.docAdd).click();
  await page.getByTestId(tid.monb.docName).fill('DBS check');
  await page.getByTestId(tid.monb.docHint).fill('An enhanced certificate issued in the last three years.');
  await page.getByTestId(tid.monb.docSave).click();
  await expect(info(page, 'DBS check added. It is optional until you make it required and save.')).toBeVisible();
  await page.getByTestId(tid.monb.docReq('dbs-check')).click();
  await page.getByTestId(tid.monb.save).click();
  await expect(page.getByTestId(tid.monb.dirty)).toHaveCount(0, { timeout: 10_000 });

  /* Tom is asked for it, with its hint, and uploads it */
  await signInEmail(page, TOM_SOCIAL);
  await openPortal(page);
  await page.getByTestId(tid.onb.step('documents')).click();
  await page.getByTestId(tid.onb.body('documents')).waitFor();
  await expect(page.getByTestId(tid.onb.doc('dbs-check'))).toContainText('An enhanced certificate issued in the last three years.');
  await uploadDoc(page, 'dbs-check', pdf('dbs.pdf'));
  await expect(page.getByTestId(tid.onb.docFile('dbs-check'))).toContainText('dbs.pdf');

  /* now he holds it, removing it is refused and names him */
  await signInEmail(page, DEE);
  await page.goto('/setup/monb');
  await page.getByTestId(tid.monb.docRemove('dbs-check')).click();
  await page.getByTestId(tid.modal.root).getByRole('button', { name: 'Remove' }).click();
  await expect(refusedToast(page, 'DBS check is on the onboarding of Tom Achterberg, so it cannot be removed.')).toBeVisible();
  await expect(page.getByTestId(tid.monb.doc('dbs-check'))).toBeVisible();
});

test('Organisation: the country offers its own time zone, and taking it sets the organisation\'s', async ({ page }) => {
  await signInEmail(page, DEE);
  await page.goto('/setup/aorg');
  await page.getByTestId(tid.aorg.card('pay')).waitFor();
  await expect(page.getByTestId(tid.aorg.card('pay'))).toContainText('Used by Payroll and Business Central, which is not built yet.');
  await page.getByTestId(tid.aorg.country).selectOption('Nepal');
  await expect(page.getByTestId(tid.aorg.countryZone)).toContainText('Its time zone is Asia/Kathmandu. This organisation keeps Europe/London');
  await page.getByTestId(tid.aorg.useCountryZone).click();
  await expect(info(page, 'Time zone saved: Asia/Kathmandu.')).toBeVisible();
  await expect(page.getByTestId(tid.aorg.timezone)).toHaveValue('Asia/Kathmandu');
  await expect(page.getByTestId(tid.aorg.countryZone)).toContainText('Its time zone, Asia/Kathmandu, is the one set under Date and time.');
});

test('Approvals: the return-reason row opens the real control on Timesheet setup, and what is saved there shows back on Approvals', async ({ page }) => {
  await signInEmail(page, DEE);
  await page.goto('/setup/aappr');
  await expect(page.getByTestId(tid.aappr.reason)).toHaveText('Required');
  await page.getByTestId(tid.aappr.reasonLink).click();
  await expect(page).toHaveURL(/\/setup\/mts#mts-return-reason$/);
  const control = page.getByTestId(tid.mts.returnReasonRequired);
  await expect(control).toBeInViewport();
  await control.click();
  await page.getByTestId(tid.mts.save).click();
  await expect(page.getByTestId(tid.mts.dirty)).toHaveCount(0, { timeout: 10_000 });
  await page.goto('/setup/aappr');
  await expect(page.getByTestId(tid.aappr.reason)).toHaveText('Not required');
  await page.getByTestId(tid.aappr.cutoffLink).click();
  await expect(page.locator('#mts-cutoff')).toBeInViewport();
});

/* Group 6. Group 1: the day changes at the tenant's own midnight. 18:30 UTC
   on Thursday 13 August is 19:30 in London and 00:15 on Friday in
   Kathmandu; half an hour earlier it is 23:45 there, still Thursday. */
const KTM_BEFORE_MIDNIGHT = '2026-08-13T18:00:00.000Z', KTM_AFTER_MIDNIGHT = '2026-08-13T18:30:00.000Z';
async function myDay(page: Page) {
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).click();
  return page.getByTestId(tid.ts.dayLabel);
}

test('Organisation: a new time zone moves today at its own midnight, so My timesheet and My home open on the Kathmandu date', async ({ page, api }) => {
  test.setTimeout(120_000);
  await api.setClock(KTM_AFTER_MIDNIGHT);
  await signInEmail(page, AMARA);
  await expect(await myDay(page)).toContainText('Thu 13 Aug');

  await signInEmail(page, DEE);
  await page.goto('/setup/aorg');
  const zone = page.getByTestId(tid.aorg.timezone);
  await zone.fill('Asia/Kathmandu');
  await zone.press('Enter');
  await expect(info(page, 'Time zone saved.')).toBeVisible();

  /* 23:45 in Kathmandu: still Thursday */
  await api.setClock(KTM_BEFORE_MIDNIGHT);
  await signInEmail(page, AMARA);
  await expect(await myDay(page)).toContainText('Thu 13 Aug');
  /* past midnight there it is Friday, though London is still on Thursday evening */
  await api.setClock(KTM_AFTER_MIDNIGHT);
  await expect(await myDay(page)).toContainText('Fri 14 Aug');
  await page.getByTestId(tid.ts.dayPrev).click();
  await page.getByTestId(tid.ts.dayToday).click();
  await expect(page.getByTestId(tid.ts.dayLabel)).toContainText('Fri 14 Aug');
  await page.goto('/work/home');
  await expect(page.getByTestId(tid.home.day('2026-08-14'))).not.toHaveAttribute('data-future');
  await expect(page.getByTestId(tid.home.day('2026-08-15'))).toHaveAttribute('data-future', 'true');
});

/* Group 6: the fault journey. Two administrators have Rota setup open; the
   second Save is based on a version the first has replaced, so it is refused
   with 412 and the standard reload prompt, the page re-reads what is stored,
   and nothing of the stale draft is written. */
test('Rota setup: a Save from a second tab over a newer version is refused with the reload prompt, and only the first change and its audit row are kept', async ({ page, context }) => {
  test.setTimeout(120_000);
  await signInEmail(page, DEE);
  const tabB = await context.newPage();
  await tabB.goto('/');
  await signInEmail(tabB, DEE);
  await page.goto('/setup/mrota');
  await tabB.goto('/setup/mrota');
  await page.getByTestId(tid.mrota.card('staffing')).waitFor();
  await tabB.getByTestId(tid.mrota.card('flex')).waitFor();
  const seeded = await tabB.getByTestId(tid.mrota.milestones).inputValue();

  await page.getByTestId(tid.mrota.levelMin('High')).fill('5');
  await page.getByTestId(tid.mrota.save).click();
  await expect(info(page, 'Rota setup saved. It applies across the tenant straight away.')).toBeVisible();

  /* tab B still holds the version it opened, so its Save is stale */
  await tabB.getByTestId(tid.mrota.milestones).fill('6, 10');
  const saved = tabB.waitForResponse(r => r.url().endsWith('/api/v1/rota/config') && r.request().method() === 'PATCH');
  await tabB.getByTestId(tid.mrota.save).click();
  expect((await saved).status()).toBe(412);
  const toast = refusedToast(tabB, 'Somebody changed this since you opened it. Your change has not been saved.');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Reload and apply your change again');
  /* it re-reads what is stored: the first tab's change shows, and its own draft is gone */
  await expect(tabB.getByTestId(tid.mrota.levelMin('High'))).toHaveValue('5');
  await expect(tabB.getByTestId(tid.mrota.milestones)).toHaveValue(seeded);
  await expect(tabB.getByTestId(tid.mrota.dirty)).toHaveCount(0);
  const rows = (await auditRows(page, 'rotaConfig')).map(a => a.after);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ locations: expect.objectContaining({ WH: 5 }) });

  /* applied again on the fresh version, it saves */
  await tabB.getByTestId(tid.mrota.milestones).fill('6, 10');
  await tabB.getByTestId(tid.mrota.save).click();
  await expect(info(tabB, 'Rota setup saved. It applies across the tenant straight away.')).toBeVisible();
  expect(await auditRows(tabB, 'rotaConfig')).toHaveLength(2);
  await tabB.close();
});

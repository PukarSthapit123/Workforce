import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail, dayState, sendVersioned } from './support/timesheet';
import { auditRows, info, openModule, refusedToast, tenantOf, wholeStore } from './support/config';
import { AMARA, DEE, MARCUS, RACHEL, THU, clockAudit, clockMove, forgetClock, lateNotes, london, myClock, openMyDay } from './support/clock';

/* Module 2b Clocking, the journeys: a day on the clock from clock in to the
   approver; a late clock in and who hears of it; a clock left running on an
   earlier day, closed the next day; Clock in / out switched off and on;
   nobody reaching someone else's clock; and a fault on clock out. On social
   against the frozen Thursday 13 August, 15:30 in London (support/clock.ts). */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

test('an employee clocks in, takes a break and clocks out: the times land on the day as a draft, Submit day sends it to the approver, one audit row per event', async ({ page, api }) => {
  await signInEmail(page, AMARA);
  await openMyDay(page);
  const card = page.getByTestId(tid.clock.card), status = page.getByTestId(tid.clock.status);
  await expect(status).toHaveText('Ready to start. Tap Clock in when you begin your shift.');
  await expect(page.getByTestId(tid.clock.timer)).toHaveText('0:00:00');

  await card.getByTestId(tid.clock.clockIn).click();
  await expect(info(page, 'Clocked in. Start time 15:30.')).toBeVisible();
  await expect(status).toHaveText('Clocked in. Shift running.');
  /* while the shift runs the start is the clock's and start and finish are read-only */
  await expect(page.getByTestId(tid.dayForm.field('start'))).toHaveValue('15:30');
  await expect(page.getByTestId(tid.dayForm.field('start'))).toHaveAttribute('readonly', '');
  await expect(page.getByTestId(tid.dayForm.field('finish'))).toHaveAttribute('readonly', '');
  /* review I1: the finish waits for clock out, not the rota line's, and the day cannot be saved or submitted until then */
  await expect(page.getByTestId(tid.dayForm.field('finish'))).toHaveValue('');
  await expect(page.getByTestId(tid.dayForm.save)).toBeDisabled();
  await expect(page.getByTestId(tid.dayForm.submit)).toBeDisabled();
  await expect(page.getByTestId(tid.clock.outFirst)).toHaveText('Clock out first.');

  await api.setClock(london('16:00'));
  await card.getByTestId(tid.clock.breakStart).click();
  await expect(info(page, 'On break. Timer paused.')).toBeVisible();
  await expect(status).toHaveText('On break. Timer paused.');
  await expect(page.getByTestId(tid.clock.timer)).toHaveText('0:30:00');
  await expect(card.getByTestId(tid.clock.clockIn)).toHaveCount(0);

  await api.setClock(london('16:20'));
  await card.getByTestId(tid.clock.resume).click();
  await expect(info(page, 'Break ended and added to your breaks.')).toBeVisible();
  await expect(status).toHaveText('Clocked in. Shift running.');

  await api.setClock(london('18:30'));
  await card.getByTestId(tid.clock.clockOut).click();
  await expect(info(page, 'Clocked out and saved as a draft. 2:40:00. Not submitted yet.')).toBeVisible();
  await expect(status).toHaveText('Clocked out and saved as a draft. Save or submit the day below.');
  await expect(card.getByTestId(tid.clock.again)).toBeVisible();
  /* the clock's times are on the day form, which is a draft and editable again */
  await expect(page.getByTestId(tid.ts.dayState)).toContainText('Draft · not submitted');
  await expect(page.getByTestId(tid.dayForm.field('start'))).toHaveValue('15:30');
  await expect(page.getByTestId(tid.dayForm.field('finish'))).toHaveValue('18:30');
  await expect(page.getByTestId(tid.dayForm.field('break_s'))).toHaveValue('16:00');
  await expect(page.getByTestId(tid.dayForm.field('break_e'))).toHaveValue('16:20');
  await expect(page.getByTestId(tid.dayForm.field('finish'))).not.toHaveAttribute('readonly', '');
  expect(await dayState(api, 'CP-1042', THU)).toMatchObject({ state: 'draft', minutes: 160, record: { captureSource: 'clock' } });

  await page.getByTestId(tid.dayForm.submit).click();
  await expect(info(page, /^Day submitted · .* · routed to Rachel Hussain for sign-off/)).toBeVisible();
  await expect(page.getByTestId(tid.ts.dayState)).toContainText('Awaiting approval');
  expect((await dayState(api, 'CP-1042', THU)).state).toBe('pend');

  /* one audit row per clock event; the clock out's day save is that event's, the submission is the day's own */
  expect(await clockAudit(page)).toEqual(['Clocked in', 'Break started', 'Break ended', 'Clocked out']);
  expect((await auditRows(page, 'timesheetDay')).map(a => a.act)).toHaveLength(1);

  await signInEmail(page, RACHEL);
  await page.goto('/team/tteam');
  await expect(page.getByTestId(tid.tteam.row(`tsd_CP-1042_${THU}`))).toBeVisible();
  await expect(page.getByTestId(tid.clock.queueLate(`tsd_CP-1042_${THU}`))).toHaveCount(0);
});

test('a late clock in flags the day Late, tells the person and their line manager, and the manager sees Late in Team timesheets', async ({ page, api }) => {
  await signInEmail(page, MARCUS);
  await openMyDay(page);
  await page.getByTestId(tid.clock.clockIn).click();
  await expect(info(page, 'Clocked in. Start time 15:30.')).toBeVisible();
  await expect(page.getByTestId(tid.clock.late)).toHaveText('Late');
  expect((await myClock(api)).current).toMatchObject({ late: true });
  expect(await lateNotes(page)).toEqual([
    ['CP-1088', 'Late clock-in', 'You clocked in at 15:30 on Thu 13 Aug. Your shift started at 14:30.'],
    ['CP-1001', 'Late clock-in', 'Marcus Reilly clocked in at 15:30 on Thu 13 Aug. The shift started at 14:30.'],
  ]);

  await api.setClock(london('21:00'));
  await page.getByTestId(tid.clock.clockOut).click();
  await expect(info(page, /^Clocked out and saved as a draft\./)).toBeVisible();
  await page.getByTestId(tid.dayForm.submit).click();
  await expect(info(page, /^Day submitted/)).toBeVisible();
  await expect(page.getByTestId(tid.clock.late)).toHaveText('Late');

  await signInEmail(page, RACHEL);
  await page.goto('/team/tteam');
  await expect(page.getByTestId(tid.clock.queueLate(`tsd_CP-1088_${THU}`))).toHaveText('Late');
});

test('a clock left running on an earlier day shows the banner, blocks a new clock in, and closes with a finish time that writes that day as a draft', async ({ page, api }) => {
  await signInEmail(page, AMARA);
  await forgetClock(page, api, '2026-08-11', '06:55', FROZEN);
  await openMyDay(page);
  const banner = page.getByTestId(tid.clock.forgotten);
  await expect(banner).toContainText('You did not clock out on Tue 11 Aug.');

  await page.getByTestId(tid.clock.clockIn).click();
  await expect(page.getByTestId(tid.clock.refusal)).toContainText('Close the clock from Tue 11 Aug first.');
  await expect(page.getByTestId(tid.clock.status)).toHaveText('Ready to start. Tap Clock in when you begin your shift.');
  expect((await myClock(api)).current).toBeNull();

  await banner.getByTestId(tid.clock.finish).fill('15:00');
  await banner.getByTestId(tid.clock.close).click();
  await expect(info(page, 'The clock from Tue 11 Aug is closed and the day saved as a draft. Not submitted yet.')).toBeVisible();
  await expect(banner).toHaveCount(0);
  expect(await dayState(api, 'CP-1042', '2026-08-11')).toMatchObject({ state: 'draft', minutes: 485, record: { captureSource: 'clock' } });
  expect(await clockAudit(page)).toEqual(['Clocked in', 'Forgotten clock closed']);

  /* the closed day says so, and today's clock is free again */
  await page.getByTestId(tid.ts.dayPrev).click();
  await page.getByTestId(tid.ts.dayPrev).click();
  await expect(page.getByTestId(tid.ts.dayLabel)).toContainText('Tue 11 Aug');
  await expect(page.getByTestId(tid.clock.closedLate)).toHaveText('Closed later');
  await page.getByTestId(tid.ts.dayToday).click();
  await page.getByTestId(tid.clock.clockIn).click();
  await expect(page.getByTestId(tid.clock.status)).toHaveText('Clocked in. Shift running.');
});

test('with Clock in / out off the card goes and the clock type records on the day form; back on, the card returns', async ({ page, api }) => {
  test.setTimeout(90_000); // five sign-ins across three people
  await signInEmail(page, AMARA);
  await openMyDay(page);
  await expect(page.getByTestId(tid.clock.card)).toBeVisible();

  await signInEmail(page, DEE);
  await openModule(page, 'TS');
  await page.getByTestId(tid.amods.mod('B')).click();
  const box = page.getByTestId(tid.modal.root);
  await expect(box.getByTestId(tid.modal.title)).toHaveText('Turn off Clock in / out?');
  await expect(box).toContainText('The clock disappears; types set to clock entry fall back to the day form.');
  await box.getByTestId(tid.modal.confirm).click();
  await expect(info(page, /^Clock in \/ out turned off\./)).toBeVisible();
  expect((await tenantOf(api)).modules.B).toBe(false);

  await signInEmail(page, AMARA);
  await openMyDay(page);
  await expect(page.getByTestId(tid.clock.card)).toHaveCount(0);
  await page.getByTestId(tid.dayForm.field('start')).fill('09:00');
  await page.getByTestId(tid.dayForm.field('finish')).fill('13:00');
  await page.getByTestId(tid.dayForm.save).click();
  await expect(info(page, /^Draft saved · .* · not submitted yet/)).toBeVisible();
  expect(await dayState(api, 'CP-1042', THU)).toMatchObject({ state: 'draft', minutes: 240, record: { captureSource: 'self' } });
  /* and the server agrees: no clock while it is off */
  const off = await clockMove(page, api, 'in');
  expect([off.status, (off.body as { code: string }).code]).toEqual([409, 'MODULE_OFF']);

  await signInEmail(page, DEE);
  await openModule(page, 'TS');
  await page.getByTestId(tid.amods.mod('B')).click();
  await expect(info(page, /^Clock in \/ out turned on/)).toBeVisible();
  expect((await tenantOf(api)).modules.B).toBe(true);

  await signInEmail(page, AMARA);
  await openMyDay(page);
  await expect(page.getByTestId(tid.clock.card)).toBeVisible();
  await expect(page.getByTestId(tid.clock.clockIn)).toBeVisible();
});

test('nobody reaches someone else’s clock: another person’s day is not found, and a type that does not clock is refused, straight to the server', async ({ page, api }) => {
  test.setTimeout(60_000);
  await signInEmail(page, AMARA);
  await forgetClock(page, api, '2026-08-11', '06:55', FROZEN);
  /* everything the server holds but the session rows the sign-ins below write */
  const held = async () => {
    const all = await wholeStore(page);
    return { ...all, audit: (await auditRows(page)).filter(a => a.entity !== 'session') };
  };
  const before = await held();

  /* Marcus has no clock on Amara's Tuesday: every path is his own */
  await signInEmail(page, MARCUS);
  expect((await myClock(api)).open).toBeNull();
  const close = await sendVersioned(page, 'POST', '/api/v1/clock/2026-08-11/close', 1, { finish: '15:00' });
  expect(close.status).toBe(404);
  expect(close.body).toMatchObject({ code: 'not-found', message: 'You have no clock on Tue 11 Aug.' });

  /* Rachel records on the day form: the clock refuses her */
  await signInEmail(page, RACHEL);
  const rachel = await sendVersioned(page, 'POST', '/api/v1/clock/in', 0);
  expect(rachel.status).toBe(409);
  expect(rachel.body).toMatchObject({ code: 'NOT_CLOCK_TYPE', message: 'Service Manager records time on the day form, not the clock.' });
  const theirs = await sendVersioned(page, 'POST', '/api/v1/clock/2026-08-11/close', 1, { finish: '15:00' });
  expect(theirs.status).toBe(409);
  expect(await held()).toEqual(before);

  await signInEmail(page, AMARA);
  expect((await myClock(api)).open).toMatchObject({ date: '2026-08-11', state: 'running' });
});

test('a fault on clock out leaves no event, no day, no notification and no audit row, and the card keeps its state', async ({ page, api }) => {
  await signInEmail(page, AMARA);
  await openMyDay(page);
  await page.getByTestId(tid.clock.clockIn).click();
  await expect(page.getByTestId(tid.clock.status)).toHaveText('Clocked in. Shift running.');
  await api.setClock(london('18:00'));
  const before = await wholeStore(page);

  await api.fault('POST', '/api/v1/clock/out', 500);
  await page.getByTestId(tid.clock.clockOut).click();
  await expect(refusedToast(page, 'Nothing has been changed')).toBeVisible();
  await expect(page.getByTestId(tid.clock.status)).toHaveText('Clocked in. Shift running.');
  await expect(page.getByTestId(tid.clock.clockOut)).toBeVisible();
  expect(await wholeStore(page)).toEqual(before);
  expect((await dayState(api, 'CP-1042', THU)).state).toBe('none');
  expect(await clockAudit(page)).toEqual(['Clocked in']);

  /* the same click, once the fault has passed, goes through */
  await page.getByTestId(tid.clock.clockOut).click();
  await expect(page.getByTestId(tid.clock.status)).toHaveText('Clocked out and saved as a draft. Save or submit the day below.');
});

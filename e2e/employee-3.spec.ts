import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { AMARA, RACHEL, SANA, W33, lineOf, rotaWeek, weekPath } from './support/rota';

/* Module 3, the employee's journey (D13, D14, D15, Review Focus 5 and 7): My
   shifts shows the published week and reads Not published yet for one that
   is not; a bank worker claims an open shift and it lands on the rota; and My
   timesheet starts the day from the rota's Night line, gives the variance
   against it, and fills the week from the rota before it is submitted. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });

test('an employee sees their published week on My shifts, and a week not yet published shows no shift times', async ({ page, api }) => {
  await signInEmail(page, AMARA);
  await page.goto('/work/shifts');
  await page.getByTestId(tid.shifts.cards).waitFor();
  await expect(page.getByTestId(tid.shifts.published)).toContainText('Published to 16/08/2026');
  await expect(page.getByTestId(tid.shifts.nextWhen)).toContainText('22:00');
  await expect(page.getByTestId(tid.shifts.weekHead)).toContainText(/^This week · 4 shifts · 33 hours$/);
  await expect(page.getByTestId(tid.shifts.day('2026-08-10'))).toContainText('Early');
  await expect(page.getByTestId(tid.shifts.day('2026-08-13'))).toContainText('Night');
  await expect(page.getByTestId(tid.shifts.rest)).toContainText('Off');

  /* a week later on the clock, week 34 has not been published (it is not even started) */
  await api.setClock('2026-08-20T10:00:00.000Z');
  await page.reload();
  await page.getByTestId(tid.shifts.cards).waitFor();
  await expect(page.getByTestId(tid.shifts.notPublished)).toContainText('Not published yet.');
  await expect(page.getByTestId(tid.shifts.next)).toContainText('Not published yet.');
  await expect(page.getByTestId(tid.shifts.weekHead)).toHaveText('This week');
  await expect(page.getByTestId(tid.shifts.cards)).not.toContainText(/\d\d:\d\d/);
  const mine = await api.get('/api/v1/rota/my-shifts');
  expect(mine.body).toMatchObject({ weekStart: '2026-08-17', visible: false, days: [] });
});

test('a bank worker claims an urgent open shift from My shifts, and it is written to the published rota as an amendment', async ({ page, api }) => {
  await signInEmail(page, SANA);
  await page.goto('/work/shifts');
  const offer = page.getByTestId(tid.shifts.offer('cov_2'));
  await expect(offer).toContainText('Fri 14 Aug · Late');
  await expect(offer.getByTestId(tid.shifts.urgent('cov_2'))).toContainText('Urgent');
  await expect(offer).toContainText('You are a favourite here, so it is offered to you first');
  await page.getByTestId(tid.shifts.claim('cov_2')).click();
  await expect(info(page, 'Shift claimed. Your manager will confirm it, and you can log time against it.')).toBeVisible();
  await expect(page.getByTestId(tid.shifts.offer('cov_2'))).toHaveCount(0);
  await expect(page.getByTestId(tid.shifts.day('2026-08-14'))).toContainText('Fri 14 · Late');
  /* the employee cannot read the team rota */
  expect((await api.get(weekPath(W33))).status).toBe(403);
  const mine = (await api.get('/api/v1/rota/my-shifts')).body as { days: { date: string; code: string }[]; openShifts: { id: string }[] };
  expect(mine.days).toContainEqual(expect.objectContaining({ date: '2026-08-14', code: 'L' }));
  expect(mine.openShifts.map(o => o.id)).not.toContain('cov_2');

  /* the manager's week holds it, through the same write as an assign (D15): a live week moves to amendment */
  await signInEmail(page, RACHEL);
  const w = await rotaWeek(api, W33);
  expect(lineOf(w, 'CP-1455')[4]).toBe('L');
  expect(w.state).toBe('amendment');
  expect(w.changes[0]).toMatchObject({ personCode: 'CP-1455', to: 'L', afterPublish: true });
});

test('My timesheet starts the day from the rota’s Night line with its variance, then fills the week from the rota and submits it', async ({ page, api }) => {
  await signInEmail(page, AMARA);
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.view('day')).click();
  await expect(page.getByTestId(tid.ts.dayLabel)).toContainText('Thu 13 Aug');
  const banner = page.getByTestId(tid.ts.banner('rota'));
  await expect(banner).toContainText('Scheduled on the rota · Night 22:00–07:00 · 9 hours');
  await expect(banner.getByTestId(tid.tsRota.seeShift)).toHaveAttribute('href', '/work/shifts');
  await expect(page.getByTestId(tid.dayForm.field('start'))).toHaveValue('22:00');
  await expect(page.getByTestId(tid.dayForm.field('finish'))).toHaveValue('07:00');
  await expect(page.getByTestId(tid.dayForm.stat('rota'))).toContainText('9h scheduled · +0h variance');
  await page.getByTestId(tid.dayForm.field('finish')).fill('07:30');
  await expect(page.getByTestId(tid.dayForm.stat('rota'))).toContainText('9h scheduled · +0.5h variance');
  await page.getByTestId(tid.dayForm.save).click();
  await expect(info(page, /^Draft saved/)).toBeVisible();
  await expect(banner).toContainText('Recorded so far: 9.5h (+0.5h against the rota).');
  const day = await api.get('/api/v1/timesheets/CP-1042/weeks/2026-08-10');
  const thu = (day.body as { days: { date: string; state: string; minutes: number; record: { shift: string } | null }[] }).days.find(d => d.date === '2026-08-13');
  expect(thu).toMatchObject({ state: 'draft', minutes: 570, record: { shift: 'N' } });

  /* a rest day on the rota reads Rest day */
  await page.getByTestId(tid.ts.dayNext).click();
  await page.getByTestId(tid.ts.dayNext).click();
  await expect(page.getByTestId(tid.ts.dayLabel)).toContainText('Sat 15 Aug');
  await expect(page.getByTestId(tid.ts.dayState)).toContainText('Rest day');

  await page.getByTestId(tid.ts.view('week')).click();
  await page.getByTestId(tid.week.grid).waitFor();
  await expect(page.getByTestId(tid.ts.contracted)).toContainText('Rota’d 33h of 37.5h contracted');
  await page.getByTestId(tid.ts.fillRota).click();
  await expect(info(page, /^Filled from your rota · \d days · check and adjust before submitting/)).toBeVisible();
  await expect(page.getByTestId(tid.week.cell(0, 0, 'start'))).toHaveValue('07:00');
  await expect(page.getByTestId(tid.week.cell(0, 0, 'finish'))).toHaveValue('15:00');
  await expect(page.getByTestId(tid.week.cell(0, 5, 'start'))).toHaveValue('');
  await page.getByTestId(tid.ts.submitWeek).click();
  await expect(info(page, /^Week 33 submitted · 3 days/)).toBeVisible();
  const week = (await api.get('/api/v1/timesheets/CP-1042/weeks/2026-08-10')).body as { days: { date: string; state: string; record: { shift: string } | null }[] };
  const by = (d: string) => week.days.find(x => x.date === d);
  expect([by('2026-08-10')?.state, by('2026-08-11')?.state, by('2026-08-13')?.state, by('2026-08-14')?.state]).toEqual(['pend', 'pend', 'pend', 'none']);
  expect([by('2026-08-10')?.record?.shift, by('2026-08-13')?.record?.shift]).toEqual(['E', 'N']);
});

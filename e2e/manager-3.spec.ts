import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { auditOf, pick } from './support/read';
import { signInEmail } from './support/timesheet';
import { RACHEL, DEE, W33, W34, W35, lineOf, openRota, rotaWeek, shiftsOn, stored, type NoteRow } from './support/rota';

/* Module 3, the manager's journey on Team rota at Willow House (Review Focus
   2, 3 and 4): a refused assign says why and writes nothing; an assign by the
   picker on the published week becomes an amendment and is republished; the
   week is repeated forward, the next week published and the one after it
   cleared; a working pattern is generated with its summary; and the team
   matrix and proxy entry read the published rota. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });

test('a manager’s refused assign says why; an assign by the picker amends the published week, which is republished at v2', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  await openRota(page);
  await expect(page.getByTestId(tid.trota.state)).toContainText('Published · v1');
  await expect(page.getByTestId(tid.trota.publish)).toBeDisabled();
  await expect(page.getByTestId(tid.trota.gaps)).toContainText('1 shift uncovered · Fri 14 Aug');
  const before = await rotaWeek(api);

  /* Amara ends a night at 07:00 on Saturday, so an early that day breaks her rest */
  await page.getByTestId(tid.trota.add('CP-1042', 5)).click();
  await expect(page.getByTestId(tid.modal.title)).toContainText('Add a shift');
  await page.getByTestId(tid.trota.assignThis).click();
  await expect(page.getByTestId(tid.toast.error).filter({ hasText: 'Amara Okafor. Only 0 hours rest before or after.' })).toBeVisible();
  expect(await rotaWeek(api)).toEqual(before);
  await page.getByTestId(tid.trota.cancel).click();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);

  /* Rosa is free on Friday: the picker's own Assign fills the gap */
  await page.getByTestId(tid.trota.add('CP-1402', 4)).click();
  await page.getByTestId(tid.trota.sugTip).waitFor();
  await page.getByTestId(tid.trota.assignThis).click();
  await expect(info(page, 'Early → Rosa Mendes · Fri 14 · 07:00–15:00')).toBeVisible();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
  await expect(page.getByTestId(tid.trota.state)).toContainText('Amended · v1');
  await expect(page.getByTestId(tid.trota.amended)).toContainText('1 unpublished change');
  await expect(page.getByTestId(tid.trota.change(0))).toContainText('Rosa Mendes');
  await expect(page.getByTestId(tid.trota.change(0))).toContainText('published v1');
  await expect(page.getByTestId(tid.trota.covered)).toBeVisible();
  const amended = await rotaWeek(api);
  expect(amended).toMatchObject({ state: 'amendment', publishVersion: 1, version: before.version + 1, gapDays: [] });
  expect(lineOf(amended, 'CP-1402')[4]).toBe('E');
  expect(amended.changes[0]).toMatchObject({ personCode: 'CP-1402', to: 'E', afterPublish: true, version: 1 });
  const notes = await stored<NoteRow>(page, 'notifications');
  /* the one new Rota item (1c seeds each person's inbox with a few more, ntf_seed_*) */
  expect(notes.filter(n => n.personId === 'CP-1402' && n.area === 'Rota' && !n.id.startsWith('ntf_seed_')).map(n => n.title)).toEqual(['Rota amended']);

  await expect(page.getByTestId(tid.trota.publish)).toContainText('Republish');
  await page.getByTestId(tid.trota.publish).click();
  await expect(info(page, 'Rota republished · v2 · 10 colleagues notified · 1 amendment(s) included')).toBeVisible();
  await expect(page.getByTestId(tid.trota.state)).toContainText('Republished · v2');
  expect(await rotaWeek(api)).toMatchObject({ state: 'republished', publishVersion: 2 });
  expect((await stored<NoteRow>(page, 'notifications')).filter(n => n.title === 'Rota republished')).toHaveLength(10);

  /* the amendment and the republication are audited separately */
  await signInEmail(page, DEE);
  expect((await auditOf(api, 'rotaWeek')).map(a => a.act).sort()).toEqual(['Published rota amended', 'Rota republished']);
});

test('a manager repeats the week forward, publishes the next week, and clears the draft week after it', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  await openRota(page);
  /* fill Friday first, so the repeated weeks have no gap */
  await page.getByTestId(tid.trota.add('CP-1402', 4)).click();
  await page.getByTestId(tid.trota.assignThis).click();
  await expect(info(page, 'Early → Rosa Mendes · Fri 14')).toBeVisible();

  await page.getByTestId(tid.trota.repeat).click();
  await expect(page.getByTestId(tid.modal.title)).toContainText('Repeat week 33 forward');
  await pick(page, tid.trota.repeatWeeks, '2');
  await page.getByTestId(tid.trota.repeatConfirm).click();
  await expect(info(page, /^\d+ shift\(s\) written across 2 week\(s\)/)).toBeVisible();
  const w33 = await rotaWeek(api, W33), w34 = await rotaWeek(api, W34), w35 = await rotaWeek(api, W35);
  expect(shiftsOn(w34)).toBe(shiftsOn(w33));
  expect(shiftsOn(w35)).toBe(shiftsOn(w33));
  expect(lineOf(w34, 'CP-1042')).toEqual(['E', 'E', '', 'N', 'N', '', '']);
  /* leave is not repeated: Marcus's two days of leave stay on week 33 only */
  expect(lineOf(w34, 'CP-1088').slice(0, 2)).toEqual(['', '']);

  /* week 34: a draft with no gaps is published at v1 */
  await page.getByTestId(tid.trota.weekNext).click();
  await expect(page.getByTestId(tid.trota.weekLabel)).toContainText('17/08/2026 – 23/08/2026');
  await expect(page.getByTestId(tid.trota.state)).toContainText('Draft');
  await expect(page.getByTestId(tid.trota.publish)).toBeEnabled();
  await page.getByTestId(tid.trota.publish).click();
  await expect(info(page, /^Rota published · v1 · \d+ colleagues notified$/)).toBeVisible();
  await expect(page.getByTestId(tid.trota.state)).toContainText('Published · v1');
  await expect(page.getByTestId(tid.trota.clear)).toBeDisabled();
  expect(await rotaWeek(api, W34)).toMatchObject({ state: 'published', publishVersion: 1 });

  /* week 35: still a draft, so it can be cleared after a confirmation with the counts */
  await page.getByTestId(tid.trota.weekNext).click();
  await expect(page.getByTestId(tid.trota.weekLabel)).toContainText('24/08/2026 – 30/08/2026');
  await expect(page.getByTestId(tid.trota.state)).toContainText('Draft');
  const n = shiftsOn(w35);
  await page.getByTestId(tid.trota.clear).click();
  await expect(page.getByTestId(tid.modal.title)).toContainText('Clear week 35?');
  await expect(page.getByTestId(tid.trota.fact('clear-shifts'))).toContainText(String(n));
  await page.getByTestId(tid.trota.clearConfirm).click();
  await expect(info(page, `${n} shift(s) cleared · week 35 · drag from the palette or generate from a pattern to rebuild it`)).toBeVisible();
  const cleared = await rotaWeek(api, W35);
  expect([shiftsOn(cleared), cleared.state]).toEqual([0, 'draft']);
  expect(await rotaWeek(api, W34)).toMatchObject({ state: 'published', publishVersion: 1 });

  /* one audit row per request, not per cell */
  await signInEmail(page, DEE);
  expect((await auditOf(api, 'rotaWeek')).map(a => a.act).sort()).toEqual(['Published rota amended', 'Rota published', 'Rota week cleared', 'Rota week repeated']);
});

test('a manager generates the rota from a working pattern; the summary counts what was written and skipped, and a second run writes nothing', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  expect(shiftsOn(await rotaWeek(api, W34))).toBe(0);
  await page.goto('/team/tpat');
  await page.getByTestId(tid.tpat.list).waitFor();
  await page.getByTestId(tid.tpat.open('WP-02')).click();
  await page.getByTestId(tid.tpat.editor).waitFor();
  await page.getByTestId(tid.tpat.gen).selectOption('4w');
  await expect(page.getByTestId(tid.tpat.range)).toContainText('This run covers 13/08/2026 – 09/09/2026');
  await page.getByTestId(tid.tpat.save).click();
  await expect(info(page, 'Early / Late, 5 over 7 saved')).toBeVisible();
  await expect(page.getByTestId(tid.tpat.run)).toBeEnabled();
  await page.getByTestId(tid.tpat.run).click();
  const summary = info(page, /^\d+ shift\(s\) written · 13\/08\/2026 – 09\/09\/2026 · \d+ week\(s\) · 5 people/);
  await expect(summary).toBeVisible();
  await expect(info(page, '1 published week(s) skipped. Amend those individually')).toBeVisible();
  const written = Number(/^(\d+)/.exec((await summary.first().textContent()) ?? '')?.[1] ?? 0);
  expect(written).toBeGreaterThan(0);
  /* the published week is not rewritten, the next one now holds the pattern */
  expect((await rotaWeek(api, W33)).state).toBe('published');
  expect(lineOf(await rotaWeek(api, W33), 'CP-1402')[4]).toBe('');
  expect(shiftsOn(await rotaWeek(api, W34))).toBeGreaterThan(0);

  /* run again: every target cell is already filled, so nothing is written or duplicated */
  const after = await rotaWeek(api, W34);
  await page.getByTestId(tid.tpat.run).click();
  await expect(info(page, /^Nothing written · every target cell was already filled/)).toBeVisible();
  expect((await rotaWeek(api, W34)).rows).toEqual(after.rows);

  /* the shifts are on the rota grid */
  await page.keyboard.press('Escape');
  await openRota(page, 1);
  await expect(page.getByTestId(tid.trota.state)).toContainText('Draft');
  await expect(page.locator(`[data-testid^="trota-chip-CP-1042-"]`).first()).toBeVisible();

  await signInEmail(page, DEE);
  const gen = (await auditOf(api, 'pattern')).filter(a => a.act === 'Working pattern generated');
  expect(gen).toHaveLength(1);
});

test('the team matrix shows the published rota as scheduled hours and leave, and proxy entry seeds a night worker’s week from their rota', async ({ page }) => {
  await signInEmail(page, RACHEL);
  await page.goto('/team/tteam');
  await page.getByTestId(tid.tteam.view('week')).click();
  await page.getByTestId(tid.tteam.matrix).waitFor();
  await expect(page.getByTestId(tid.tteam.pip('CP-1042', 3))).toHaveAttribute('data-state', 'sched');
  await expect(page.getByTestId(tid.tteam.pip('CP-1042', 3))).toContainText('9');
  await expect(page.getByTestId(tid.tteam.pip('CP-1042', 0))).toContainText('7.5');
  await expect(page.getByTestId(tid.tteam.pip('CP-1088', 0))).toContainText('AL');
  await expect(page.getByTestId(tid.tteam.pip('CP-1088', 0))).toHaveAttribute('data-state', 'off');
  await expect(page.getByText('Scheduled, not yet worked')).toBeVisible();

  await page.goto('/team/tpeople');
  await page.getByTestId(tid.people.open('CP-1266')).click();
  await page.getByTestId(tid.proxy.open).click();
  await expect(page.getByTestId(tid.proxy.banner)).toBeVisible();
  await page.getByTestId(tid.proxy.view('week')).click();
  await page.getByTestId(tid.week.grid).waitFor();
  await expect(page.getByTestId(tid.tsRota.seeded)).toContainText('Seeded from Daniel’s rota, not yours.');
  await expect(page.getByTestId(tid.week.cell(0, 2, 'start'))).toHaveValue('22:00');
  await expect(page.getByTestId(tid.week.grid)).not.toContainText(/your rota/i);
});

import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { auditOf, pick } from './support/read';
import { sendVersioned, signInEmail } from './support/timesheet';
import { DEE, RACHEL, W33, openRota, rotaWeek, stored, weekPath, type NoteRow } from './support/rota';

/* Module 3, the admin's journey (D3, D12, Review Focus 2): "Coverage gaps
   block publishing" on Rota setup applies on Save, with one audit row holding
   the before and after. With it off, the manager republishes Willow House's
   week 33 with Friday still short; with it back on, the next republish is
   refused with COVERAGE_GAPS, on screen and by the server, and nothing
   changes: no state, no version, no notification, no audit row. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });

async function setBlockOnGap(page: import('@playwright/test').Page, on: boolean) {
  await signInEmail(page, DEE);
  await page.goto('/setup/mrota');
  await page.getByTestId(tid.mrota.card('staffing')).waitFor();
  const toggle = page.getByTestId(tid.mrota.toggle('publishBlockOnGap'));
  await expect(toggle).toHaveAttribute('aria-checked', String(!on));
  await toggle.click();
  await expect(page.getByTestId(tid.mrota.dirty)).toBeVisible();
  await page.getByTestId(tid.mrota.save).click();
  await expect(info(page, 'Rota setup saved. It applies across the tenant straight away.')).toBeVisible();
  await expect(page.getByTestId(tid.mrota.dirty)).toHaveCount(0);
}
/* Amara's Tuesday early becomes a late (or back): a change to the live week that leaves Friday short */
async function changeTuesday(page: import('@playwright/test').Page, to: 'L' | 'E') {
  await page.getByTestId(tid.trota.chip('CP-1042', 1)).click();
  await page.getByTestId(tid.trota.changeShift).waitFor();
  await pick(page, tid.trota.changeShift, to);
  await expect(page.getByTestId(tid.trota.state)).toContainText('Amended');
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
}

test('an admin turns off “Coverage gaps block publishing” and a week with a gap republishes; turned back on, the republish is refused and nothing changes', async ({ page, api }) => {
  test.setTimeout(90_000);
  await setBlockOnGap(page, false);
  expect(((await api.get('/api/v1/rota/config')).body as { config: { publishBlockOnGap: boolean } }).config.publishBlockOnGap).toBe(false);
  const saved = await auditOf(api, 'rotaConfig');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ act: 'Rota setup saved', before: { publishBlockOnGap: true }, after: { publishBlockOnGap: false } });

  await signInEmail(page, RACHEL);
  await openRota(page);
  await expect(page.getByTestId(tid.trota.gaps)).toContainText('1 shift uncovered · Fri 14 Aug');
  await expect(page.getByTestId(tid.trota.gaps)).not.toContainText('This rota cannot be published.');
  await changeTuesday(page, 'L');
  await expect(page.getByTestId(tid.trota.publish)).toBeEnabled();
  await page.getByTestId(tid.trota.publish).click();
  await expect(info(page, 'Rota republished · v2 · 10 colleagues notified · 1 amendment(s) included')).toBeVisible();
  expect(await rotaWeek(api, W33)).toMatchObject({ state: 'republished', publishVersion: 2, gapDays: [4] });

  await setBlockOnGap(page, true);
  expect(await auditOf(api, 'rotaConfig')).toHaveLength(2);

  await signInEmail(page, RACHEL);
  await openRota(page);
  await changeTuesday(page, 'E');
  await expect(page.getByTestId(tid.trota.gaps)).toContainText('This rota cannot be published.');
  await expect(page.getByTestId(tid.trota.publish)).toBeDisabled();
  await expect(page.getByTestId(tid.trota.publish)).toHaveAttribute('title', 'Coverage gaps block publishing');

  /* the server owns the rule: the republish sent straight to it is refused */
  const before = await rotaWeek(api, W33), notes = await stored<NoteRow>(page, 'notifications');
  expect(before).toMatchObject({ state: 'amendment', publishVersion: 2 });
  const refused = await sendVersioned(page, 'POST', `${weekPath(W33)}/transition`, before.version, { to: 'published' });
  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ code: 'COVERAGE_GAPS', next: 'Fill the days below the minimum first, or turn off "Coverage gaps block publishing" in Rota setup.' });
  expect(await rotaWeek(api, W33)).toEqual(before);
  expect(await stored<NoteRow>(page, 'notifications')).toEqual(notes);

  await signInEmail(page, DEE);
  expect((await auditOf(api, 'rotaWeek')).map(a => a.act).sort()).toEqual(['Published rota amended', 'Published rota amended', 'Rota republished']);
});

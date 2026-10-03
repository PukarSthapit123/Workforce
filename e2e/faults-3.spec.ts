import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { auditOf } from './support/read';
import { signInEmail } from './support/timesheet';
import { DEE, RACHEL, SANA, W33, W34, openRota, rotaWeek, shiftsOn, stored, weekPath, type NoteRow } from './support/rota';

/* Module 3 Review Focus 6: a 500 on any rota write shows the refusal, keeps
   the screen as it was, and leaves no change to the week, no notification
   and no audit row. One journey across the writes: a cell, a repeat, an
   accepted plan, a copy, a transition and a clear on Team rota; a generate on
   Working patterns; an assign and a confirm on Cover requests; a claim on My
   shifts; and a save on Rota setup. A fault is registered after signing in,
   because signing in reloads the page and faults live in the page
   (fixtures.ts). */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

test('a fault on any rota write shows the refusal, keeps the screen, and leaves no week change, notification or audit row', async ({ page, api }) => {
  test.setTimeout(180_000);
  const refused = async () => { await expect(page.getByTestId(tid.toast.error).filter({ hasText: 'Nothing has been changed' }).first()).toBeVisible(); };
  const escape = async () => { await page.keyboard.press('Escape'); await expect(page.getByTestId(tid.modal.root)).toHaveCount(0); };
  const notes = (p: Page) => stored<NoteRow>(p, 'notifications');
  const board = async () => (await api.get('/api/v1/rota/cover')).body;
  const W = weekPath(W33), N = weekPath(W34);

  await signInEmail(page, RACHEL);
  await openRota(page);
  const w33 = await rotaWeek(api, W33), w34 = await rotaWeek(api, W34), cover = await board(), sent = await notes(page);

  /* a cell: the picker stays open on the same shift */
  await page.getByTestId(tid.trota.add('CP-1402', 4)).click();
  await api.fault('PUT', `${W}/cells`, 500);
  await page.getByTestId(tid.trota.assignThis).click();
  await refused();
  await expect(page.getByTestId(tid.modal.title)).toContainText('Add a shift');
  await escape();

  /* repeat forward */
  await page.getByTestId(tid.trota.repeat).click();
  await api.fault('POST', `${W}/repeat`, 500);
  await page.getByTestId(tid.trota.repeatConfirm).click();
  await refused();
  await expect(page.getByTestId(tid.trota.repeatConfirm)).toBeVisible();
  await escape();

  /* the suggested plan: it stays on screen to accept again */
  await page.getByTestId(tid.trota.suggest).click();
  await page.getByTestId(tid.trota.plan).waitFor();
  await api.fault('POST', `${W}/plan/accept`, 500);
  await page.getByTestId(tid.trota.planAcceptAll).click();
  await refused();
  await expect(page.getByTestId(tid.trota.plan)).toContainText('1 shift could be filled now');
  await page.getByTestId(tid.trota.planDismiss).click();
  await expect(page.getByTestId(tid.trota.state)).toContainText('Published · v1');

  /* week 34: copy and send for review */
  await page.getByTestId(tid.trota.weekNext).click();
  await expect(page.getByTestId(tid.trota.state)).toContainText('Draft');
  await api.fault('POST', `${N}/copy`, 500);
  await page.getByTestId(tid.trota.copy).click();
  await refused();
  await api.fault('POST', `${N}/transition`, 500);
  await page.getByTestId(tid.trota.review).click();
  await refused();
  await expect(page.getByTestId(tid.trota.state)).toContainText('Draft');
  expect(await rotaWeek(api, W33)).toEqual(w33);
  expect(await rotaWeek(api, W34)).toEqual(w34);

  /* clear needs shifts on a draft week: copy for real, then fault the clear */
  await page.getByTestId(tid.trota.copy).click();
  await expect(page.getByTestId(tid.toast.info).filter({ hasText: /shift\(s\) copied from 10\/08\/2026/ })).toBeVisible();
  const copied = await rotaWeek(api, W34);
  expect(shiftsOn(copied)).toBeGreaterThan(0);
  await page.getByTestId(tid.trota.clear).click();
  await api.fault('POST', `${N}/clear`, 500);
  await page.getByTestId(tid.trota.clearConfirm).click();
  await refused();
  await expect(page.getByTestId(tid.trota.clearConfirm)).toBeVisible();
  await escape();
  expect(await rotaWeek(api, W34)).toEqual(copied);

  /* generate a working pattern */
  await page.goto('/team/tpat');
  await page.getByTestId(tid.tpat.open('WP-02')).click();
  await page.getByTestId(tid.tpat.editor).waitFor();
  await api.fault('POST', '/api/v1/rota/patterns/WP-02/generate', 500);
  await page.getByTestId(tid.tpat.run).click();
  await refused();
  await expect(page.getByTestId(tid.tpat.editor)).toBeVisible();
  await escape();

  /* assign a cover request and confirm a filled shift */
  await page.goto('/team/tcover');
  const assign = page.getByTestId(tid.tcover.request('cov_2')).locator(`[data-testid^="${tid.tcover.assign('cov_2', '')}"]`).first();
  await expect(assign).toBeVisible();
  await api.fault('POST', '/api/v1/rota/cover/cov_2/assign', 500);
  await assign.click();
  await refused();
  await expect(page.getByTestId(tid.tcover.request('cov_2'))).toBeVisible();
  await api.fault('POST', '/api/v1/rota/filled/fil_1/confirm', 500);
  await page.getByTestId(tid.tcover.confirm('fil_1')).click();
  await refused();
  await expect(page.getByTestId(tid.tcover.confirm('fil_1'))).toBeVisible();
  expect(await board()).toEqual(cover);

  /* claim an open shift */
  await signInEmail(page, SANA);
  await page.goto('/work/shifts');
  await page.getByTestId(tid.shifts.claim('cov_2')).waitFor();
  await api.fault('POST', '/api/v1/rota/cover/cov_2/claim', 500);
  await page.getByTestId(tid.shifts.claim('cov_2')).click();
  await refused();
  await expect(page.getByTestId(tid.shifts.offer('cov_2'))).toBeVisible();

  /* save Rota setup: the draft stays */
  await signInEmail(page, DEE);
  await page.goto('/setup/mrota');
  await page.getByTestId(tid.mrota.card('staffing')).waitFor();
  const config = (await api.get('/api/v1/rota/config')).body;
  await page.getByTestId(tid.mrota.toggle('publishBlockOnGap')).click();
  await api.fault('PATCH', '/api/v1/rota/config', 500);
  await page.getByTestId(tid.mrota.save).click();
  await refused();
  await expect(page.getByTestId(tid.mrota.dirty)).toBeVisible();
  expect((await api.get('/api/v1/rota/config')).body).toEqual(config);

  /* nothing written anywhere but the one real copy */
  expect(await notes(page)).toEqual(sent);
  expect((await auditOf(api, 'rotaWeek')).map(a => a.act)).toEqual(['Rota week copied']);
  for (const entity of ['pattern', 'coverRequest', 'filledShift', 'rotaConfig']) expect(await auditOf(api, entity), entity).toEqual([]);
  await signInEmail(page, RACHEL);
  expect(await rotaWeek(api, W33)).toEqual(w33);
  expect(await board()).toEqual(cover);
});

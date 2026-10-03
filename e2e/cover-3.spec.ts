import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { auditOf, pick } from './support/read';
import { signInEmail } from './support/timesheet';
import { DEE, RACHEL, W33, lineOf, openRota, rotaWeek, stored, type NoteRow } from './support/rota';

/* Module 3, the cover journey (D7, D15, Review Focus 5): the manager
   advertises Willow House's short Friday from Team rota, which opens a cover
   request with no reason; on Cover requests the reason moves it on a stage and
   brings up suggestions; assigning one writes the shift onto the published
   week as an amendment and closes the request; confirming it raises an IT
   access request, because ITACCESS is on. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });
interface Board { requests: { id: string; date: string; shift: string; reason: string; stage: number; open: boolean }[]; filled: { id: string; coverId: string; personCode: string; name: string; confirmed: boolean; itRequest: string }[] }

test('a manager opens cover for a short day, gives the reason, assigns a suggested colleague, and confirms the shift, which raises an IT request', async ({ page, api }) => {
  test.setTimeout(90_000);
  await signInEmail(page, RACHEL);
  await openRota(page);
  await page.getByTestId(tid.trota.add('CP-1402', 4)).click();
  await page.getByTestId(tid.trota.advertise).click();
  await expect(info(page, /^Cover request opened for/)).toBeVisible();
  const board = async () => (await api.get('/api/v1/rota/cover')).body as Board;
  const opened = (await board()).requests.find(r => r.date === '2026-08-14' && r.shift === 'E');
  if (!opened) throw new Error('no cover request for the Friday early');
  expect(opened).toMatchObject({ reason: '', open: true });
  const id = opened.id;

  await page.goto('/team/tcover');
  const card = page.getByTestId(tid.tcover.request(id));
  await expect(card.getByTestId(tid.tcover.noReason(id))).toContainText('Choose a reason to see suggestions.');
  /* no request closes without a reason */
  await card.getByTestId(tid.tcover.fill(id)).click();
  await expect(page.getByTestId(tid.toast.error).filter({ hasText: 'Add a reason before closing the request.' })).toBeVisible();

  await pick(page, tid.tcover.reason(id), 'Sickness');
  await expect(info(page, 'Reason saved. Eligible colleagues at Willow House are asked first.')).toBeVisible();
  expect((await board()).requests.find(r => r.id === id)).toMatchObject({ reason: 'Sickness', stage: 2, open: true });

  const assign = card.locator(`[data-testid^="${tid.tcover.assign(id, '')}"]`).first();
  await expect(assign).toBeVisible();
  const person = ((await assign.getAttribute('data-testid')) ?? '').slice(tid.tcover.assign(id, '').length);
  await assign.click();
  await expect(info(page, /assigned and added to the rota\. Confirm it once worked\./)).toBeVisible();
  const after = await board();
  expect(after.requests.find(r => r.id === id)).toBeUndefined();
  const filled = after.filled.find(f => f.coverId === id);
  if (!filled) throw new Error('no filled shift for the request');
  expect(filled.personCode.replace(/[^A-Za-z0-9-]+/g, '-')).toBe(person);
  const week = await rotaWeek(api, W33);
  expect(lineOf(week, filled.personCode)[4]).toBe('E');
  expect(week).toMatchObject({ state: 'amendment', gapDays: [] });
  expect(week.changes[0]).toMatchObject({ personCode: filled.personCode, to: 'E', afterPublish: true });

  await page.getByTestId(tid.tcover.confirm(filled.id)).click();
  await expect(info(page, /^Confirmed\. IT access request ITR-\d+ raised\./)).toBeVisible();
  await expect(page.getByTestId(tid.tcover.confirmed(filled.id))).toContainText('Confirmed');
  await expect(page.getByTestId(tid.tcover.it(filled.id))).toContainText(/IT access request ITR-\d+/);
  const done = (await board()).filled.find(f => f.id === filled.id);
  expect(done).toMatchObject({ confirmed: true, itRequest: expect.stringMatching(/^ITR-\d+$/) });
  expect(await stored(page, 'itRequests')).toEqual([expect.objectContaining({ ref: done?.itRequest, personCode: filled.personCode, date: '2026-08-14', status: 'Raised' })]);
  const notes = await stored<NoteRow>(page, 'notifications');
  expect(notes.filter(n => n.personId === filled.personCode).length).toBeGreaterThan(0);

  await signInEmail(page, DEE);
  expect((await auditOf(api, 'coverRequest')).map(a => a.act).sort()).toEqual(['Cover reason set', 'Cover request filled', 'Cover request opened']);
  expect((await auditOf(api, 'filledShift')).map(a => a.act)).toEqual(['Filled shift confirmed']);
});

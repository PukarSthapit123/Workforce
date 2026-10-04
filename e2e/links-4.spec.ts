import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { pick } from './support/read';
import { sendVersioned, signInEmail } from './support/timesheet';
import { AMARA, RACHEL, W33, lineOf, openRota, rotaWeek, stored, weekPath, type NoteRow } from './support/rota';
import { askFor, leaveAudit } from './support/leave';

/* Module 4, the links on social, where Rota, FULFIL and LV_ROTA are on
   (brief D7, D9, D10; Review Focus 4 and 6). Approving leave writes V onto
   every day of it through the week path: the published week becomes an
   amendment with change rows, the colleague is told, and a day that falls
   below the minimum opens a cover request. Recording sickness writes S the
   same way; a return to work is asked for once; days of leave a sickness
   covered are given back, which turns those V cells to S. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });
interface CoverRead { requests: { id: string; date: string; shift: string; reason: string }[] }
const coverOn = async (api: { get(p: string): Promise<{ body: unknown }> }, date: string, reason: string) =>
  ((await api.get('/api/v1/rota/cover')).body as CoverRead).requests.filter(c => c.date === date && c.reason === reason);

test('approving leave puts it on the published rota as an amendment, tells the colleague, and opens cover below the minimum', async ({ page, api }) => {
  /* Amara asks for Thursday and Friday of week 33; she works nights on both */
  await signInEmail(page, AMARA);
  const asked = await askFor(api, '2026-08-13', '2026-08-14');

  await signInEmail(page, RACHEL);
  const before = await rotaWeek(api, W33);
  expect(await coverOn(api, '2026-08-13', 'Annual leave cover')).toEqual([]);
  await page.goto('/team/tleave');
  const card = page.getByTestId(tid.tleave.card(asked.id));
  await expect(card).toContainText('Amara Okafor');
  await expect(page.getByTestId(tid.tleave.cover(asked.id))).toContainText('13 Aug drops to 3 of 4. Cover needed.');
  await expect(page.getByTestId(tid.tleave.rota(asked.id))).toHaveAttribute('href', '/team/trota');
  await page.getByTestId(tid.tleave.approve(asked.id)).click();
  await expect(info(page, 'Amara’s leave approved. The rota now shows them unavailable and a cover request has opened.')).toBeVisible();
  await expect(card).toHaveCount(0);

  /* the week: V on both days, through the week path, so the live week is now an amendment with its change rows */
  const after = await rotaWeek(api, W33);
  expect(after).toMatchObject({ state: 'amendment', publishVersion: 1, version: before.version + 1 });
  expect(lineOf(after, 'CP-1042')).toEqual(['E', 'E', '', 'V', 'V', '', '']);
  expect(after.changes.filter(c => c.personCode === 'CP-1042').map(c => [c.from, c.to, c.afterPublish])).toEqual([['N', 'V', true], ['N', 'V', true]]);
  expect(await coverOn(api, '2026-08-13', 'Annual leave cover')).toHaveLength(1);
  const notes = (await stored<NoteRow>(page, 'notifications')).filter(n => n.personId === 'CP-1042');
  expect(notes.filter(n => n.title === 'Rota amended')).toHaveLength(1);
  /* the rota still will not take a manual shift on a day of leave */
  const manual = await sendVersioned(page, 'PUT', `${weekPath(W33)}/cells`, after.version, { personCode: 'CP-1042', day: 3, code: 'E' });
  expect([manual.status, (manual.body as { code: string }).code]).toEqual([409, 'ON_LEAVE']);

  /* on Team rota: annual leave on both days, and the week shows as amended */
  await page.getByTestId(tid.tleave.count).waitFor();
  await openRota(page);
  await expect(page.getByTestId(tid.trota.state)).toContainText('Amended · v1');
  for (const day of [3, 4]) {
    await expect(page.getByTestId(tid.trota.chip('CP-1042', day))).toContainText('AL');
    await expect(page.getByTestId(tid.trota.chip('CP-1042', day))).toHaveAttribute('aria-label', /Annual leave/);
  }
  /* one audit row for the decision, carrying what reached the rota */
  const rows = await leaveAudit(page);
  expect(rows.map(a => a.act)).toEqual(['Leave requested', 'Leave approved']);
  expect(rows[1]?.after).toMatchObject({ state: 'approved', cells: 2, rotaWeeks: ['rw_WH_2026-08-10'] });
});

test('recording sickness puts S on the rota and opens cover; a return to work is asked for once; days of leave are given back and turn to sickness', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  await page.goto('/team/tsick');
  await page.getByTestId(tid.tsick.table).waitFor();

  /* Jo works a late on Thursday, which has exactly the minimum on shift */
  await pick(page, tid.tsick.who, 'CP-1153');
  await page.getByTestId(tid.tsick.from).fill('2026-08-13');
  await page.getByTestId(tid.tsick.to).fill('2026-08-13');
  await pick(page, tid.tsick.reason, 'Cold or flu');
  await page.getByTestId(tid.tsick.save).click();
  await expect(info(page, 'Sickness recorded. Shift removed from the rota and a cover request opened.')).toBeVisible();
  /* two spells of a day each: 2² × 2 */
  await expect(page.getByTestId(tid.tsick.score('CP-1153'))).toContainText('8');
  expect(lineOf(await rotaWeek(api, W33), 'CP-1153')[3]).toBe('S');
  expect(await coverOn(api, '2026-08-13', 'Sickness')).toHaveLength(1);

  /* Marcus is over the trigger: ask for his return-to-work meeting */
  await expect(page.getByTestId(tid.tsick.banner)).toContainText('Marcus Reilly');
  await page.getByTestId(tid.tsick.arrange).click();
  await expect(info(page, 'Return-to-work meeting requested. The colleague and HR have been notified.')).toBeVisible();
  await expect(page.getByTestId(tid.tsick.arranged)).toContainText('Return-to-work meeting requested');
  await expect(page.getByTestId(tid.tsick.arrange)).toHaveCount(0);
  const board = (await api.get('/api/v1/leave/sickness')).body as { rows: { personCode: string; episode: { id: string; rtw: unknown } }[] };
  expect(board.rows.find(r => r.personCode === 'CP-1088')?.episode).toMatchObject({ id: 'sk_004', rtw: { by: { personCode: 'CP-1001' } } });

  /* his sickness on Tuesday fell on a day of his approved leave: give it back */
  const ent = async () => ((await api.get('/api/v1/leave/entitlement/CP-1088')).body as { balance: { leftD: number } }).balance.leftD;
  const left = await ent();
  expect(lineOf(await rotaWeek(api, W33), 'CP-1088').slice(0, 2)).toEqual(['V', 'V']);
  await page.getByTestId(tid.tsick.giveBack).click();
  await expect(page.getByTestId(tid.tsick.gbDay('2026-08-11'))).toBeChecked();
  await page.getByTestId(tid.tsick.gbConfirm).click();
  await expect(info(page, '1 day returned to Marcus Reilly’s annual leave balance')).toBeVisible();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
  await expect(page.getByTestId(tid.tsick.onLeaveDay('CP-1088', '2026-08-11'))).toHaveCount(0);
  expect(await ent()).toBe(left + 1);
  expect(lineOf(await rotaWeek(api, W33), 'CP-1088').slice(0, 2)).toEqual(['V', 'S']);

  /* on Team rota: sickness where it was recorded and where the leave was given back */
  await openRota(page);
  await expect(page.getByTestId(tid.trota.chip('CP-1153', 3))).toHaveAttribute('aria-label', /Sickness/);
  await expect(page.getByTestId(tid.trota.chip('CP-1088', 1))).toHaveAttribute('aria-label', /Sickness/);
  await expect(page.getByTestId(tid.trota.chip('CP-1088', 0))).toHaveAttribute('aria-label', /Annual leave/);
  expect((await leaveAudit(page)).map(a => a.act)).toEqual(['Sickness recorded', 'Return-to-work meeting requested', 'Days returned']);
});

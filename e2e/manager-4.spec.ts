import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { PUKAR, signInEmail } from './support/timesheet';
import { stored, type NoteRow } from './support/rota';
import { leaveAudit, type LeaveReq } from './support/leave';

/* Module 4, the manager's journey on Team leave on qnipay (brief D14): an
   approval with its toast that moves the balance exactly once; a decline
   without a reason refused on the field, then with one, which the colleague
   is told (D4, Review Focus 2 and 3); and team balances with how a
   colleague's entitlement was worked out. Rota is off here, so nothing
   reaches a rota and the card offers no rota link. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });
interface EntRead { balance: { takenD: number; pending: number; leftD: number } }

test('a manager approves a request, declines another only with a reason, and reads a colleague’s entitlement from team balances', async ({ page, api }) => {
  await signInEmail(page, PUKAR);
  await page.goto('/team/tleave');
  await page.getByTestId(tid.tleave.count).waitFor();
  await expect(page.getByTestId(tid.tleave.count)).toContainText('3 waiting on you');
  const card = page.getByTestId(tid.tleave.card('lr_3'));
  await expect(card).toContainText('Bigyan Poudel');
  await expect(card).toContainText('Annual leave · 03/09/2026 – 04/09/2026 · 2 days');
  await expect(page.getByTestId(tid.tleave.cover('lr_3'))).toContainText('Cover is not checked. This tenant does not use Rota.');
  await expect(page.getByTestId(tid.tleave.rota('lr_3'))).toHaveCount(0);
  const ent = async () => ((await api.get('/api/v1/leave/entitlement/EMP004')).body as EntRead).balance;
  const was = await ent();

  /* approve: pending becomes taken, the days left do not move a second time */
  await page.getByTestId(tid.tleave.approve('lr_3')).click();
  await expect(info(page, 'Bigyan’s leave approved')).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId(tid.tleave.count)).toContainText('2 waiting on you');
  expect(await ent()).toMatchObject({ takenD: was.takenD + 2, pending: was.pending - 2, leftD: was.leftD });
  const approved = (await api.get('/api/v1/leave/team/requests')).body as { requests: LeaveReq[] };
  expect(approved.requests.map(r => r.id)).not.toContain('lr_3');

  /* decline Bijay's: no reason is refused on the field, and nothing is written */
  await page.getByTestId(tid.tleave.decline('lr_1')).click();
  await expect(page.getByTestId(tid.modal.root)).toBeVisible();
  await page.getByTestId(tid.tleave.declineConfirm).click();
  await expect(page.getByTestId(tid.field.root(tid.tleave.reason))).toContainText('Give a reason for declining. The colleague sees it.');
  await expect(page.getByTestId(tid.tleave.card('lr_1'))).toBeVisible();
  expect((await leaveAudit(page)).map(a => a.act)).toEqual(['Leave approved']);

  await page.getByTestId(tid.tleave.reason).fill('Two others are already off that week');
  await page.getByTestId(tid.tleave.declineConfirm).click();
  await expect(info(page, 'Bijay’s request declined. They have been told the reason.')).toBeVisible();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
  await expect(page.getByTestId(tid.tleave.card('lr_1'))).toHaveCount(0);
  const told = (await stored<NoteRow>(page, 'notifications')).filter(n => n.personId === 'EMP005' && n.area === 'Leave');
  expect(told.map(n => n.body).join(' ')).toContain('Two others are already off that week');

  /* team balances: Bigyan's row and how his entitlement was worked out */
  await page.getByTestId(tid.tleave.balances).waitFor();
  await expect(page.getByTestId(tid.tleave.balanceRow('EMP004'))).toContainText('Bigyan Poudel');
  await expect(page.getByTestId(tid.tleave.next('EMP004'))).toContainText('17/08/2026');
  await page.getByTestId(tid.tleave.ent('EMP004')).click();
  await expect(page.getByTestId(tid.modal.title)).toContainText('How Bigyan’s entitlement was worked out');
  await expect(page.getByTestId(tid.leave.entPolicy)).toContainText('Standard annual leave');
  await expect(page.getByTestId(tid.leave.entRemaining)).toContainText(`${was.leftD} days`);
  await expect(page.getByTestId(tid.leave.entTaken)).toContainText(`${was.takenD + 2} days`);
  await page.getByTestId(tid.leave.entClose).click();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);

  /* one audit row per decision, the decline with its reason */
  const rows = await leaveAudit(page);
  expect(rows.map(a => [a.act, a.entityId])).toEqual([['Leave approved', 'lr_3'], ['Leave declined', 'lr_1']]);
  expect(rows[1]?.reason).toBe('Two others are already off that week');
});

import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { pick } from './support/read';
import { signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL } from './support/rota';
import { leaveAudit, leaveStore, openRequest } from './support/leave';

/* Module 4 Review Focus 7: a 500 on any leave write shows the refusal, keeps
   the screen as it was, and leaves no request, ledger row, sickness episode,
   rota change, cover request, notification or audit row. One journey on
   social, where the decisions and sickness would reach the rota: a request
   and a cancel on My leave; an approve and a decline on Team leave; recording
   sickness, a return to work and giving days back on Sickness; and a save on
   Leave setup. A fault is registered after signing in, because signing in
   reloads the page and faults live in the page (fixtures.ts). */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

test('a fault on any leave write shows the refusal, keeps the screen, and writes no request, ledger row, rota change, notification or audit row', async ({ page, api }) => {
  test.setTimeout(150_000);
  const refused = async () => { await expect(page.getByTestId(tid.toast.error).filter({ hasText: 'Nothing has been changed' }).first()).toBeVisible(); };
  const escape = async () => { await page.keyboard.press('Escape'); await expect(page.getByTestId(tid.modal.root)).toHaveCount(0); };

  await signInEmail(page, AMARA);
  const before = await leaveStore(page);
  await page.goto('/work/leave');
  await page.getByTestId(tid.leave.cards).waitFor();

  /* ask for leave: the dialog stays open with what was typed */
  await openRequest(page, '2026-09-14', '2026-09-15');
  await api.fault('POST', '/api/v1/leave/requests', 500);
  await page.getByTestId(tid.leave.send).click();
  await refused();
  await expect(page.getByTestId(tid.leave.from)).toHaveValue('2026-09-14');
  await expect(page.getByTestId(tid.leave.qty)).toHaveValue(/^2 days/);
  await escape();

  /* cancel her waiting request: it stays waiting */
  await api.fault('POST', '/api/v1/leave/requests/lr_3/cancel', 500);
  await page.getByTestId(tid.leave.cancel('lr_3')).click();
  await refused();
  await expect(page.getByTestId(tid.leave.state('lr_3'))).toContainText('Waiting');
  await expect(page.getByTestId(tid.leave.cancel('lr_3'))).toBeVisible();

  /* approve and decline Priya's request: the card stays, the decline keeps its reason */
  await signInEmail(page, RACHEL);
  await page.goto('/team/tleave');
  await page.getByTestId(tid.tleave.card('lr_1')).waitFor();
  await api.fault('POST', '/api/v1/leave/requests/lr_1/approve', 500);
  await page.getByTestId(tid.tleave.approve('lr_1')).click();
  await refused();
  await expect(page.getByTestId(tid.tleave.approve('lr_1'))).toBeEnabled();
  await page.getByTestId(tid.tleave.decline('lr_1')).click();
  await page.getByTestId(tid.tleave.reason).fill('Cover is too thin that week');
  await api.fault('POST', '/api/v1/leave/requests/lr_1/decline', 500);
  await page.getByTestId(tid.tleave.declineConfirm).click();
  await refused();
  await expect(page.getByTestId(tid.tleave.reason)).toHaveValue('Cover is too thin that week');
  await escape();
  await expect(page.getByTestId(tid.tleave.card('lr_1'))).toBeVisible();

  /* record sickness, arrange a return to work, give days back */
  await page.goto('/team/tsick');
  await page.getByTestId(tid.tsick.table).waitFor();
  await pick(page, tid.tsick.who, 'CP-1153');
  await page.getByTestId(tid.tsick.from).fill('2026-08-13');
  await page.getByTestId(tid.tsick.to).fill('2026-08-13');
  await api.fault('POST', '/api/v1/leave/sickness', 500);
  await page.getByTestId(tid.tsick.save).click();
  await refused();
  await expect(page.getByTestId(tid.tsick.from)).toHaveValue('2026-08-13');
  await expect(page.getByTestId(tid.tsick.score('CP-1153'))).toContainText('1');
  await api.fault('POST', '/api/v1/leave/sickness/sk_004/rtw', 500);
  await page.getByTestId(tid.tsick.arrange).click();
  await refused();
  await expect(page.getByTestId(tid.tsick.arrange)).toBeVisible();
  await page.getByTestId(tid.tsick.giveBack).click();
  await expect(page.getByTestId(tid.tsick.gbDay('2026-08-11'))).toBeChecked();
  await api.fault('POST', '/api/v1/leave/give-back', 500);
  await page.getByTestId(tid.tsick.gbConfirm).click();
  await refused();
  await expect(page.getByTestId(tid.tsick.gbConfirm)).toBeVisible();
  await escape();
  await expect(page.getByTestId(tid.tsick.onLeaveDay('CP-1088', '2026-08-11'))).toBeVisible();

  /* save Leave setup: the draft stays */
  await signInEmail(page, DEE);
  await page.goto('/setup/mleave');
  await page.getByTestId(tid.mleave.card('rota')).waitFor();
  await page.getByTestId(tid.mleave.toggle('blocksTimesheet')).click();
  await api.fault('PATCH', '/api/v1/leave/config', 500);
  await page.getByTestId(tid.mleave.save).click();
  await refused();
  await expect(page.getByTestId(tid.mleave.dirty)).toBeVisible();
  await expect(page.getByTestId(tid.mleave.toggle('blocksTimesheet'))).toHaveAttribute('aria-checked', 'false');

  /* nothing written anywhere */
  expect(await leaveStore(page)).toEqual(before);
  expect(await leaveAudit(page)).toEqual([]);
});

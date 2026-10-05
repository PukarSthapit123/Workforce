import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { answered } from './support/read';
import { signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL, openModule, wholeStore } from './support/config';

/* 1c Review Focus 7: a 500 on any 1c write shows the refusal, keeps the
   screen as it was, and leaves no partial change, notification or audit row.
   One journey on social across the writes: a feature and a module switch, the
   rota horizon, saving and applying a template, renaming the roles, the
   notification matrix, an approval chain and a delegation, posting and
   withdrawing a notice, acknowledging one, and marking a notification read.
   A fault is registered after signing in, because signing in reloads the
   page and faults live in the page (fixtures.ts). Signing in is audited, so
   those rows are set aside when the store is compared. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const settled = async (page: Page) => {
  const db = await wholeStore(page) as { audit?: Record<string, { entity: string }> };
  return { ...db, audit: Object.fromEntries(Object.entries(db.audit ?? {}).filter(([, a]) => a.entity !== 'session')) };
};

test('a fault on any 1c write shows the refusal, keeps the screen, and changes nothing, tells nobody and audits nothing', async ({ page, api }) => {
  test.setTimeout(180_000);
  /* the request reached the server, failed, and the refusal is on screen */
  const fails = async (method: string, path: string, act: () => Promise<unknown>) => {
    await api.fault(method, path, 500);
    const reply = answered(page, method, new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await act();
    expect((await reply).status(), `${method} ${path}`).toBe(500);
    await expect(page.getByTestId(tid.toast.error).filter({ hasText: 'Nothing has been changed' }).first()).toBeVisible();
  };
  const escape = async () => { await page.keyboard.press('Escape'); await expect(page.getByTestId(tid.modal.root)).toHaveCount(0); };
  const box = page.getByTestId(tid.modal.root);

  await signInEmail(page, DEE);
  const before = await settled(page);

  /* a feature switch, and a module switch through its confirm */
  await openModule(page, 'CORE');
  await fails('PATCH', '/api/v1/tenant/flags/NOTICES', () => page.getByTestId(tid.amods.flag('NOTICES')).click());
  await expect(page.getByTestId(tid.amods.flag('NOTICES'))).toHaveAttribute('aria-checked', 'true');
  await openModule(page, 'R');
  await page.getByTestId(tid.amods.mod('R')).click();
  await fails('PATCH', '/api/v1/tenant/modules/R', () => box.getByTestId(tid.modal.confirm).click());
  await expect(box.getByTestId(tid.modal.confirm)).toBeEnabled();
  await escape();
  await expect(page.getByTestId(tid.amods.mod('R'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId(tid.amods.offBanner)).toHaveCount(0);

  /* the rota horizon */
  await page.goto('/setup/acal');
  await page.getByTestId(tid.acal.horizon).waitFor();
  await fails('PATCH', '/api/v1/tenant/settings', () => page.getByTestId(tid.acal.horizon).selectOption('6'));
  await expect(page.getByTestId(tid.acal.horizon)).toHaveValue('12');

  /* saving a template keeps the dialog and its name; applying one keeps its preview */
  await page.goto('/setup/aorg');
  await page.getByTestId(tid.aorg.template('mne')).waitFor();
  await page.getByTestId(tid.aorg.saveOpen).click();
  await box.getByTestId(tid.aorg.saveName).fill('Brightpath as it runs');
  await fails('POST', '/api/v1/templates', () => box.getByTestId(tid.aorg.save).click());
  await expect(box.getByTestId(tid.aorg.saveName)).toHaveValue('Brightpath as it runs');
  await escape();
  await expect(page.getByTestId(tid.aorg.noSaved)).toBeVisible();
  await page.getByTestId(tid.aorg.template('mne')).click();
  await box.getByTestId(tid.aorg.plan('changes')).waitFor();
  await fails('POST', '/api/v1/templates/mne/apply', () => box.getByTestId(tid.aorg.apply).click());
  await expect(box.getByTestId(tid.aorg.plan('changes'))).toBeVisible();
  await escape();
  await expect(page.getByTestId(tid.aorg.template('social'))).toHaveAttribute('aria-pressed', 'true');

  /* renaming the roles */
  await page.goto('/setup/aperm');
  await page.getByTestId(tid.access.table).waitFor();
  await page.getByTestId(tid.roleNames.open).click();
  await box.getByTestId(tid.roleNames.field('employee')).fill('Support Worker');
  await fails('PATCH', '/api/v1/user-types/employee', () => box.getByTestId(tid.roleNames.save).click());
  await expect(box.getByTestId(tid.roleNames.field('employee'))).toHaveValue('Support Worker');
  await escape();
  await expect(page.getByTestId(tid.access.userTypeName('employee'))).toContainText('Employee');

  /* the notification matrix keeps the change held, ready to save again */
  await page.goto('/setup/anotif');
  await page.getByTestId(tid.anotif.table).waitFor();
  await page.getByTestId(tid.anotif.cell('lv_ok', 'employee')).selectOption('Off');
  await fails('PATCH', '/api/v1/notifications/matrix', () => page.getByTestId(tid.anotif.save).click());
  await expect(page.getByTestId(tid.anotif.cell('lv_ok', 'employee'))).toHaveValue('Off');
  await expect(page.getByTestId(tid.anotif.save)).toBeEnabled();

  /* an approval chain and a delegation keep their dialogs */
  await page.goto('/setup/aappr');
  await page.getByTestId(tid.aappr.delegTable).waitFor();
  await page.getByTestId(tid.aappr.edit('Timesheet')).click();
  await box.getByTestId(tid.aappr.when(1)).selectOption('Every timesheet');
  await fails('PUT', '/api/v1/approvals/chains/Timesheet', () => box.getByTestId(tid.aappr.chainSave).click());
  await expect(box.getByTestId(tid.aappr.when(1))).toHaveValue('Every timesheet');
  await escape();
  await page.getByTestId(tid.aappr.delegAdd).click();
  await box.getByTestId(tid.aappr.who).selectOption('CP-1002');
  await box.getByTestId(tid.aappr.to).selectOption('CP-1001');
  await box.getByTestId(tid.aappr.from).fill('2026-09-01');
  await box.getByTestId(tid.aappr.until).fill('2026-09-07');
  await fails('POST', '/api/v1/approvals/delegations', () => box.getByTestId(tid.aappr.delegSave).click());
  await expect(box.getByTestId(tid.aappr.from)).toHaveValue('2026-09-01');
  await escape();
  await expect(page.getByTestId(tid.aappr.delegRow('dlg_2'))).toHaveCount(0);

  /* posting and withdrawing a notice */
  await signInEmail(page, RACHEL);
  await page.goto('/team/tnotices');
  await page.getByTestId(tid.tnotices.table).waitFor();
  await page.getByTestId(tid.tnotices.add).click();
  await box.getByTestId(tid.tnotices.title).fill('Hand hygiene audit next week');
  await box.getByTestId(tid.tnotices.body).fill('Every sink will be checked on Tuesday.');
  await fails('POST', '/api/v1/notices', () => box.getByTestId(tid.tnotices.postNow).click());
  await expect(box.getByTestId(tid.tnotices.title)).toHaveValue('Hand hygiene audit next week');
  await escape();
  await expect(page.getByTestId(tid.tnotices.row('NTC-0005'))).toHaveCount(0);
  await page.getByTestId(tid.tnotices.open('NTC-0002')).click();
  await box.getByTestId(tid.tnotices.trackWithdraw).click();
  await box.getByTestId(tid.tnotices.reason).fill('Drill moved to next month');
  await fails('POST', '/api/v1/notices/NTC-0002/withdraw', () => box.getByTestId(tid.tnotices.withdrawOk).click());
  await expect(box.getByTestId(tid.tnotices.reason)).toHaveValue('Drill moved to next month');
  await escape();
  await expect(page.getByTestId(tid.tnotices.state('NTC-0002'))).not.toContainText('Withdrawn');

  /* opening a notification goes where it points, but it stays unread */
  await expect(page.getByTestId(tid.shell.bellCount)).toHaveText('5');
  await page.getByTestId(tid.shell.bell).click();
  await fails('POST', '/api/v1/notifications/ntf_seed_0006/read', () => page.getByTestId(tid.inbox.item('ntf_seed_0006')).click());
  await expect(page.getByTestId(tid.shell.bellCount)).toHaveText('5');

  /* acknowledging a notice */
  await signInEmail(page, AMARA);
  await page.goto('/work/notices');
  await page.getByTestId(tid.notices.table).waitFor();
  await page.getByTestId(tid.notices.read('NTC-0002')).click();
  await fails('POST', '/api/v1/notices/NTC-0002/acknowledge', () => box.getByTestId(tid.notices.readAck).click());
  await escape();
  await expect(page.getByTestId(tid.notices.you('NTC-0002'))).toContainText('Acknowledge');
  await expect(page.getByTestId(tid.notices.you('NTC-0002'))).not.toContainText('Acknowledged');

  /* nothing written anywhere: no change, no notification, no audit row */
  expect(await settled(page)).toEqual(before);
});

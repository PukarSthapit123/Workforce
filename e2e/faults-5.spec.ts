import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { EDDIE, PUKAR, TOM, completeMine, onbAudit, onbStore, openPortal, openTracker, pdf, uploadDoc } from './support/onboarding';

/* Module 5 Review Focus 5: a 500 on any onboarding write shows the refusal,
   keeps the screen as it was, and leaves no case change, notification or
   audit row. One journey on qnipay. Tom has done every step but the review:
   a step save, a document upload, taking a policy tick back and the
   submission; Pukar verifying and rejecting a document, inviting Priya and
   chasing Tom; Eddie saving Onboarding setup and uploading a new policy. A
   fault is registered after the page it fires on has loaded, because faults
   live in the page (fixtures.ts). */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
/* every collection a write could touch, the audit log read as onboarding's own rows (signing in writes its own) */
const held = async (page: Page) => {
  const s = await onbStore(page);
  delete s.audit;
  return { ...s, audit: await onbAudit(page) };
};

test('a fault on any onboarding write shows the refusal, keeps the screen, and writes no case change, notification or audit row', async ({ page, api }) => {
  test.setTimeout(180_000);
  const refused = async () => { await expect(page.getByTestId(tid.toast.error).filter({ hasText: 'Nothing has been changed' }).first()).toBeVisible(); };
  const escape = async () => { await page.keyboard.press('Escape'); await expect(page.getByTestId(tid.modal.root)).toHaveCount(0); };

  await signInEmail(page, TOM);
  await completeMine(page, api, { submit: false });
  const before = await held(page);

  /* a step save: the value typed stays on screen */
  await openPortal(page);
  await page.getByTestId(tid.onb.field('nat')).fill('Dutch and British');
  await api.fault('PUT', '/api/v1/onboarding/me/steps/personal', 500);
  await page.getByTestId(tid.onb.next).click();
  await refused();
  await expect(page.getByTestId(tid.onb.field('nat'))).toHaveValue('Dutch and British');
  await expect(page.getByTestId(tid.onb.body('personal'))).toBeVisible();

  /* a document upload: the file on record stays */
  await openPortal(page);
  await page.getByTestId(tid.onb.step('documents')).click();
  await page.getByTestId(tid.onb.body('documents')).waitFor();
  await api.fault('POST', '/api/v1/onboarding/me/documents/rtw', 500);
  await uploadDoc(page, 'rtw', pdf('another.pdf'));
  await refused();
  await expect(page.getByTestId(tid.onb.docFile('rtw'))).toContainText('rtw.pdf');

  /* taking a policy tick back: it stays ticked */
  await page.getByTestId(tid.onb.step('policies')).click();
  await page.getByTestId(tid.onb.body('policies')).waitFor();
  await api.fault('POST', '/api/v1/onboarding/me/policies/pol_conduct/ack', 500);
  await page.getByTestId(tid.onb.polAck('pol_conduct')).click();
  await refused();
  await expect(page.getByTestId(tid.onb.polAck('pol_conduct'))).toHaveAttribute('aria-checked', 'true');

  /* the submission: still on the review, the signature kept */
  await page.getByTestId(tid.onb.step('review')).click();
  await page.getByTestId(tid.onb.body('review')).waitFor();
  await page.getByTestId(tid.onb.sign).fill('Tom Achterberg');
  await page.getByTestId(tid.onb.consent).click();
  await api.fault('POST', '/api/v1/onboarding/me/submit', 500);
  await page.getByTestId(tid.onb.submit).click();
  await refused();
  await expect(page.getByTestId(tid.onb.sign)).toHaveValue('Tom Achterberg');
  await expect(page.getByTestId(tid.onb.submitted)).toHaveCount(0);

  /* verify and reject: the dialog stays with its reason; invite and chase */
  await signInEmail(page, PUKAR);
  await openTracker(page);
  await page.getByTestId(tid.tonb.check('EMP003', 'addr')).click();
  await api.fault('POST', '/api/v1/onboarding/team/EMP003/documents/addr/verify', 500);
  await page.getByTestId(tid.tonb.verify).click();
  await refused();
  await page.getByTestId(tid.tonb.reason).fill('The bill is older than three months.');
  await api.fault('POST', '/api/v1/onboarding/team/EMP003/documents/addr/reject', 500);
  await page.getByTestId(tid.tonb.reject).click();
  await refused();
  await expect(page.getByTestId(tid.tonb.reason)).toHaveValue('The bill is older than three months.');
  await escape();
  await expect(page.getByTestId(tid.tonb.queueRow('EMP003', 'addr'))).toBeVisible();
  await api.fault('POST', '/api/v1/onboarding/team/EMP002/invite', 500);
  await page.getByTestId(tid.tonb.invite('EMP002')).click();
  await refused();
  await expect(page.getByTestId(tid.tonb.state('EMP002'))).toContainText('Candidate');
  await page.getByTestId(tid.tonb.start('EMP003')).click();
  await page.getByTestId(tid.tonb.notReady).waitFor();
  await api.fault('POST', '/api/v1/onboarding/team/EMP003/chase', 500);
  await page.getByTestId(tid.tonb.chase).click();
  await refused();
  await expect(page.getByTestId(tid.tonb.chase)).toBeVisible();
  await escape();

  /* Onboarding setup: the draft stays; a policy keeps its version */
  await signInEmail(page, EDDIE);
  await page.goto('/setup/monb');
  await page.getByTestId(tid.monb.policies).waitFor();
  await page.getByTestId(tid.monb.stepSwitch('emergency')).click();
  await api.fault('PUT', '/api/v1/onboarding/config', 500);
  await page.getByTestId(tid.monb.save).click();
  await refused();
  await expect(page.getByTestId(tid.monb.dirty)).toBeVisible();
  await expect(page.getByTestId(tid.monb.stepSwitch('emergency'))).toHaveAttribute('aria-checked', 'false');
  await api.fault('POST', '/api/v1/onboarding/policies/pol_handbook/file', 500);
  await page.getByTestId(tid.monb.polUpload('pol_handbook')).click();
  await page.getByTestId(tid.monb.filePick).setInputFiles(pdf('handbook-2026.pdf'));
  await refused();
  await expect(page.getByTestId(tid.monb.polVer('pol_handbook'))).toHaveText('v7.3');
  await expect(page.getByTestId(tid.monb.polAcks('pol_handbook'))).toHaveText('1');

  /* nothing written anywhere */
  expect(await held(page)).toEqual(before);
});

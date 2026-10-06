import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { personByCode } from './support/read';
import { signInEmail } from './support/timesheet';
import { PRIYA, PUKAR, TOM, completeMine, myCase, onbAudit, onbNotes, openTracker, pdf, teamOf, uploadDoc } from './support/onboarding';

/* Module 5, the manager's journey on Team onboarding on qnipay (brief group
   6, D4, D6): Tom has submitted everything. Pukar checks a document and
   verifies it, rejects the right to work with a reason; Tom sees the reason
   and the reopened step and uploads again; Pukar verifies the new upload.
   Start them while the right to work is unverified opens the not-ready
   dialog, from which he chases; once nothing blocks, Start them makes Tom
   active and the tracker drops him. Invite moves Priya from candidate to
   preboarding, saying no email is sent; Add a new starter opens the person
   form set to candidate. Sessions switch by signing in again, as module 4. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });

test('a manager checks documents, rejects one with a reason the starter acts on, chases, and starts them only once nothing blocks', async ({ page, api }) => {
  test.setTimeout(150_000);
  await signInEmail(page, TOM);
  await completeMine(page, api);

  await signInEmail(page, PUKAR);
  await openTracker(page);
  await expect(page.getByTestId(tid.tonb.toVerify)).toHaveText('3 to verify');
  await expect(page.getByTestId(tid.tonb.blocking('EMP003'))).toHaveText('Right to work not verified');

  /* Start them with something outstanding: the not-ready dialog, then Chase */
  await page.getByTestId(tid.tonb.start('EMP003')).click();
  await expect(page.getByTestId(tid.modal.title)).toContainText('Tom Achterberg is not ready to start');
  await expect(page.getByTestId(tid.tonb.blocker(0))).toHaveText('Right to work not verified');
  await page.getByTestId(tid.tonb.chase).click();
  await expect(info(page, 'Tom Achterberg reminded. 1 outstanding.')).toBeVisible();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
  expect((await personByCode(api, 'EMP003')).state).toBe('preboard');

  /* proof of address is verified */
  await page.getByTestId(tid.tonb.check('EMP003', 'addr')).click();
  await expect(page.getByTestId(tid.tonb.checkNoPreview)).toBeVisible();
  await page.getByTestId(tid.tonb.verify).click();
  await expect(info(page, 'Proof of address verified.')).toBeVisible();
  await expect(page.getByTestId(tid.tonb.queueRow('EMP003', 'addr'))).toHaveCount(0);

  /* the right to work is rejected: not without a reason, then with one */
  await page.getByTestId(tid.tonb.check('EMP003', 'rtw')).click();
  await page.getByTestId(tid.tonb.reject).click();
  await expect(page.getByTestId(tid.field.root(tid.tonb.reason))).toContainText('Give a reason, so they know what to send instead.');
  await page.getByTestId(tid.tonb.reason).fill('The passport page is cut off. Send the whole photo page.');
  await page.getByTestId(tid.tonb.reject).click();
  await expect(info(page, 'Right to work rejected. Tom Achterberg has been told.')).toBeVisible();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
  await expect(page.getByTestId(tid.tonb.blocking('EMP003'))).toContainText('Documents not completed');

  /* Tom sees the reason and the reopened step, and uploads again */
  await signInEmail(page, TOM);
  await page.goto('/work/onb');
  await page.getByTestId(tid.onb.submitted).waitFor();
  const back = page.getByTestId(tid.onb.sentBack);
  await expect(back.getByTestId(tid.onb.docReason('rtw'))).toHaveText('Reason: The passport page is cut off. Send the whole photo page.');
  await expect(back.getByTestId(tid.onb.docState('rtw'))).toContainText('Rejected');
  expect((await onbNotes(page)).filter(n => n.personId === 'EMP003').map(n => n.body).join(' ')).toContain('The passport page is cut off.');
  await uploadDoc(page, 'rtw', pdf('passport-full.pdf'));
  await expect(info(page, 'Right to work: passport-full.pdf is waiting to be checked.')).toBeVisible();
  await back.getByTestId(tid.onb.next).click();
  await expect(info(page, 'Documents saved.')).toBeVisible();
  await expect(page.getByTestId(tid.onb.sentBack)).toHaveCount(0);
  expect((await myCase(api)).case).toMatchObject({ steps: { documents: 'done' }, docs: { rtw: 'done' }, rejections: {} });

  /* Pukar verifies the new upload; nothing blocks; Start them makes Tom active */
  await signInEmail(page, PUKAR);
  await openTracker(page);
  await page.getByTestId(tid.tonb.check('EMP003', 'rtw')).click();
  await expect(page.getByTestId(tid.modal.root)).toContainText('passport-full.pdf');
  await page.getByTestId(tid.tonb.verify).click();
  await expect(info(page, 'Right to work verified.')).toBeVisible();
  await expect(page.getByTestId(tid.tonb.blocking('EMP003'))).toHaveText('Nothing');
  await page.getByTestId(tid.tonb.start('EMP003')).click();
  await expect(info(page, 'Tom Achterberg is active. They can now be scheduled and paid.')).toBeVisible();
  await expect(page.getByTestId(tid.tonb.row('EMP003'))).toHaveCount(0);
  expect((await personByCode(api, 'EMP003')).state).toBe('active');
  expect((await teamOf(api)).rows.map(r => r.person.code)).not.toContain('EMP003');
  const rows = await onbAudit(page);
  expect(rows.find(a => a.act === 'Employee active')).toMatchObject({ entityId: 'EMP003', reason: 'Onboarding complete' });
  expect(rows.filter(a => a.act === 'Onboarding chased')).toHaveLength(1);
});

test('Invite moves a candidate to preboarding and says no email is sent; Add a new starter opens the person form set to candidate', async ({ page, api }) => {
  await signInEmail(page, PUKAR);
  await openTracker(page);
  await expect(page.getByTestId(tid.tonb.state('EMP002'))).toContainText('Candidate');
  await expect(page.getByTestId(tid.tonb.invite('EMP003'))).toHaveCount(0);
  await page.getByTestId(tid.tonb.invite('EMP002')).click();
  await expect(info(page, `Priya Raman is invited. They sign in with ${PRIYA}. No email is sent in this build.`)).toBeVisible();
  await expect(page.getByTestId(tid.tonb.state('EMP002'))).toContainText('Preboarding');
  await expect(page.getByTestId(tid.tonb.invite('EMP002'))).toHaveCount(0);
  expect((await personByCode(api, 'EMP002')).state).toBe('preboard');
  expect((await onbAudit(page)).find(a => a.act === 'Onboarding invited')).toMatchObject({ entityId: 'EMP002', reason: 'Invited to complete onboarding' });
  expect((await onbNotes(page)).filter(n => n.personId === 'EMP002').map(n => n.title)).toEqual(['Onboarding invitation']);

  /* Add a new starter: the 1b person form, starting as a candidate */
  await page.getByTestId(tid.tonb.add).click();
  await page.getByTestId(tid.personForm.root).waitFor();
  await expect(page.getByTestId(tid.personForm.field('state'))).toContainText('Candidate');
  await page.getByTestId(tid.personForm.field('name')).fill('Sarah Lindqvist');
  await page.getByTestId(tid.personForm.field('email')).fill('sarah.lindqvist@dogmagroup.co.uk');
  await page.getByTestId(tid.personForm.save).click();
  await expect(info(page, /Sarah Lindqvist created/)).toBeVisible();
  await expect(page.getByTestId(tid.personForm.root)).toHaveCount(0);
  const added = (await teamOf(api)).rows.find(r => r.person.code !== 'EMP002' && r.person.code !== 'EMP003');
  expect(added?.person.state).toBe('candidate');
  await expect(page.getByTestId(tid.tonb.row(added?.person.code ?? ''))).toContainText('Sarah Lindqvist');
});

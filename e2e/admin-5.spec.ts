import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { EDDIE, TOM, completeMine, myCase, onbAudit, openPortal, pdf } from './support/onboarding';

/* Module 5, the administrator on Onboarding setup on qnipay (brief group 6,
   D2, D10, D11): Tom has completed every step but the review, every policy
   acknowledged. Eddie switches Emergency contacts off and saves (the toast is
   the prototype's: people part-way through keep what they gave); makes proof
   of address stop a start and saves, one audit row per save with before and
   after; then uploads a new Employee handbook, which goes to v7.4 and asks the
   one person who acknowledged it again. Tom then sees six steps and the
   handbook unticked at its new version. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });

test('an administrator switches a step off, changes a document setting and uploads a new policy version; the starter is asked again', async ({ page, api }) => {
  test.setTimeout(120_000);
  await signInEmail(page, TOM);
  await completeMine(page, api, { submit: false });

  await signInEmail(page, EDDIE);
  await page.goto('/setup/monb');
  await page.getByTestId(tid.monb.card('steps')).waitFor();
  await page.getByTestId(tid.monb.policies).waitFor();
  await expect(page.getByTestId(tid.monb.save)).toBeDisabled();
  await expect(page.getByTestId(tid.monb.polAcks('pol_handbook'))).toHaveText('1');

  /* a step switched off, applied only on Save */
  const sw = page.getByTestId(tid.monb.stepSwitch('emergency'));
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(page.getByTestId(tid.monb.dirty)).toBeVisible();
  const was = ((await api.get('/api/v1/onboarding/config')).body as { config: { version: number } }).config.version;
  await page.getByTestId(tid.monb.save).click();
  await expect(info(page, 'Emergency contacts will not be asked for. People part-way through keep what they have already given.')).toBeVisible();
  await expect(page.getByTestId(tid.monb.dirty)).toHaveCount(0);
  await expect(page.getByTestId(tid.monb.stepSwitch('emergency'))).toHaveAttribute('aria-checked', 'false');

  /* a document setting: proof of address now stops a start */
  await page.getByTestId(tid.monb.docBlocks('addr')).click();
  await page.getByTestId(tid.monb.save).click();
  await expect(info(page, 'Document settings saved.')).toBeVisible();
  const cfg = ((await api.get('/api/v1/onboarding/config')).body as { config: { version: number; steps: { id: string; on: boolean }[]; documents: { id: string; blocks: boolean }[] } }).config;
  expect(cfg.version).toBe(was + 2);
  expect(cfg.steps.find(s => s.id === 'emergency')?.on).toBe(false);
  expect(cfg.documents.find(d => d.id === 'addr')?.blocks).toBe(true);
  const saves = (await onbAudit(page)).filter(a => a.act === 'Onboarding setup saved');
  expect(saves).toHaveLength(2);
  expect(saves[0]).toMatchObject({ before: expect.objectContaining({ steps: expect.anything() }), after: expect.objectContaining({ steps: expect.anything() }) });

  /* a new handbook: the version goes up and the one person who acknowledged it is asked again */
  await page.getByTestId(tid.monb.polUpload('pol_handbook')).click();
  await page.getByTestId(tid.monb.filePick).setInputFiles(pdf('handbook-2026.pdf'));
  await expect(info(page, 'Employee handbook is now v7.4. 1 person will be asked again.')).toBeVisible();
  await expect(page.getByTestId(tid.monb.polVer('pol_handbook'))).toHaveText('v7.4');
  await expect(page.getByTestId(tid.monb.polAcks('pol_handbook'))).toHaveText('0');
  await expect(page.getByTestId(tid.monb.polFile('pol_handbook'))).toContainText('handbook-2026.pdf');
  expect((await onbAudit(page)).filter(a => a.act === 'Policy document uploaded').map(a => a.entityId)).toEqual(['pol_handbook']);

  /* Tom: six steps, and the handbook unticked at v7.4 */
  await signInEmail(page, TOM);
  await openPortal(page);
  await expect(page.getByTestId(tid.onb.step('emergency'))).toHaveCount(0);
  await expect(page.getByTestId(tid.onb.rail).getByRole('button')).toHaveCount(6);
  await page.getByTestId(tid.onb.step('policies')).click();
  await page.getByTestId(tid.onb.body('policies')).waitFor();
  await expect(page.getByTestId(tid.onb.polVer('pol_handbook'))).toHaveText('v7.4');
  await expect(page.getByTestId(tid.onb.polAck('pol_handbook'))).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId(tid.onb.polAck('pol_conduct'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId(tid.onb.polCount)).toHaveText('3 of 4');
  const mine = await myCase(api);
  expect(mine.case.acks).toEqual({ pol_conduct: 'v4.1', pol_privacy: 'v2.0', pol_itsec: 'v3.2' });
  /* what he gave for the step now switched off is kept */
  expect(mine.case.steps.emergency).toBe('done');
});

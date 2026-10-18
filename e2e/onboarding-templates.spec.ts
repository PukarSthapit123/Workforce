import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { sendVersioned, signInEmail } from './support/timesheet';
import { EDDIE, TOM, openPortal } from './support/onboarding';

/* Onboarding templates chosen by the starter's job profile, on qnipay at the
   frozen clock: Tom (EMP003) and Priya (EMP002) are both Consultants (CONS).
   Eddie, the administrator, makes a template for CONS with proof of address
   switched off; the starters on that profile are no longer asked for it, and
   a starter on any other profile still is. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });

type Api = { get(path: string): Promise<{ status: number; body: unknown }> };
const docIds = async (api: Api, code: string) =>
  ((await api.get(`/api/v1/onboarding/team/${code}`)).body as { documents: { id: string }[] }).documents.map(d => d.id);
async function setProfile(page: Page, api: Api, id: string, jobProfile: string) {
  const emp = (await api.get(`/api/v1/employees/${id}`)).body as { version: number };
  expect((await sendVersioned(page, 'PATCH', `/api/v1/employees/${id}`, emp.version, { jobProfile })).status).toBe(200);
}
/* A template for CONS with proof of address off, written straight to the server as the signed-in administrator. */
async function consultantsWithoutAddress(page: Page, api: Api) {
  const made = await sendVersioned(page, 'POST', '/api/v1/onboarding/templates', 0, { name: 'Consultants' });
  expect(made.status).toBe(200);
  const row = (made.body as { record: { id: string; version: number; steps: unknown; documents: { id: string; on: boolean }[]; policies: unknown } }).record;
  const put = await sendVersioned(page, 'PUT', `/api/v1/onboarding/templates/${row.id}`, row.version, {
    name: 'Consultants', jobProfiles: ['CONS'], steps: row.steps, policies: row.policies,
    documents: row.documents.map(d => (d.id === 'addr' ? { ...d, on: false } : d)),
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  return row.id;
}
const portalDocs = async (page: Page) => {
  await openPortal(page);
  await page.getByTestId(tid.onb.step('documents')).click();
  await page.getByTestId(tid.onb.docs).waitFor();
};

test('OT an admin makes a template for a job profile and switches a document off; its starters are not asked for it, and others are', async ({ page, api }) => {
  test.setTimeout(120_000);
  await signInEmail(page, EDDIE);
  await page.goto('/setup/monb');
  await page.getByTestId(tid.monb.card('steps')).waitFor();
  await page.getByTestId(tid.monb.docs).waitFor();
  await page.getByTestId(tid.monb.templateNew).click();
  await page.getByTestId(tid.monb.newName).fill('Consultants');
  await page.getByTestId(tid.monb.newCreate).click();
  await expect(page).toHaveURL(/template=onbt-consultants/);
  await page.getByTestId(tid.monb.profileAdd).click();
  await page.getByTestId(`${tid.monb.profileAdd}-option-CONS`).click();
  await expect(page.getByTestId(tid.monb.profile('CONS'))).toBeVisible();
  await page.getByTestId(tid.monb.docOn('addr')).click();
  await page.getByTestId(tid.monb.save).click();
  await expect(page.getByTestId(tid.monb.dirty)).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/template=onbt-consultants/);
  await expect(page.getByTestId(tid.monb.template)).toContainText('Consultants');
  await expect(page.getByTestId(tid.monb.profile('CONS'))).toBeVisible();
  await expect(page.getByTestId(tid.monb.docOn('addr'))).toHaveAttribute('aria-checked', 'false');

  await setProfile(page, api, 'emp_EMP002', 'PM');
  expect(await docIds(api, 'EMP003')).not.toContain('addr');
  expect(await docIds(api, 'EMP002')).toContain('addr');

  await signInEmail(page, TOM);
  await portalDocs(page);
  await expect(page.getByTestId(tid.onb.doc('rtw'))).toBeVisible();
  await expect(page.getByTestId(tid.onb.doc('addr'))).toHaveCount(0);
});

test('OT a job profile change before submission switches what is asked, and deleting the template falls back to the default', async ({ page, api }) => {
  test.setTimeout(120_000);
  await signInEmail(page, EDDIE);
  await consultantsWithoutAddress(page, api);

  await signInEmail(page, TOM);
  await portalDocs(page);
  await expect(page.getByTestId(tid.onb.doc('addr'))).toHaveCount(0);

  await signInEmail(page, EDDIE);
  await setProfile(page, api, 'emp_EMP003', 'PM');
  await signInEmail(page, TOM);
  await portalDocs(page);
  await expect(page.getByTestId(tid.onb.doc('addr'))).toBeVisible();

  await signInEmail(page, EDDIE);
  await setProfile(page, api, 'emp_EMP003', 'CONS');
  await signInEmail(page, TOM);
  await portalDocs(page);
  await expect(page.getByTestId(tid.onb.doc('addr'))).toHaveCount(0);

  await signInEmail(page, EDDIE);
  await page.goto('/setup/monb?template=onbt-consultants');
  await page.getByTestId(tid.monb.card('applies')).waitFor();
  await page.getByTestId(tid.monb.templateDelete).click();
  await page.getByTestId(tid.modal.confirm).click();
  await expect(page.getByTestId(tid.monb.card('applies'))).toHaveCount(0);
  await signInEmail(page, TOM);
  await portalDocs(page);
  await expect(page.getByTestId(tid.onb.doc('addr'))).toBeVisible();
});

test('OT the template bar fits a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInEmail(page, EDDIE);
  await page.goto('/setup/monb?template=onbt-senior-consultants');
  await page.getByTestId(tid.monb.card('applies')).waitFor();
  await expect(page.getByTestId(tid.monb.template)).toBeVisible();
  await expect(page.getByTestId(tid.monb.templateNew)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

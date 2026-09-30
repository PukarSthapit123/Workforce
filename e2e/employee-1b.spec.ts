import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';

/* Plan 1b, the employee's journey: my own record, and a proposed change that
   changes nothing until it is approved. */
test.beforeEach(async ({ api }) => { await api.reset(); await api.setClock(FROZEN); });
interface Profile { person: { code: string; phone: string; bankAccount: string }; pending: { field: string; to: string }[] }

test('an employee reads their own profile, proposes a phone and a bank change that change nothing yet, and cannot propose the same field twice', async ({ page, api, signInAs }) => {
  await signInAs('employee');
  await page.goto('/work/profile');
  await page.getByTestId(tid.profile.state).waitFor();
  const before = (await api.get('/api/v1/profile')).body as Profile;
  await expect(page.getByTestId(tid.profile.fact('code'))).toHaveText(before.person.code);
  await expect(page.getByTestId(tid.profile.value('bankAccount'))).toContainText('****');

  await page.getByTestId(tid.profile.propose).click();
  await expect(page.getByTestId(tid.profile.payroll('bankAccount'))).toBeVisible();
  await page.getByTestId(tid.profile.field('phone')).fill('07700 900999');
  await page.getByTestId(tid.profile.field('bankAccount')).fill('87654321');
  await page.getByTestId(tid.profile.note).fill('New phone and bank');
  await page.getByTestId(tid.profile.send).click();
  await expect(page.getByTestId(tid.toast.info)).toContainText('Sent for approval');
  await expect(page.getByTestId(tid.profile.pending('phone'))).toContainText('07700 900999 awaiting approval');

  const after = (await api.get('/api/v1/profile')).body as Profile;
  expect(after.person).toMatchObject({ phone: before.person.phone, bankAccount: before.person.bankAccount });
  expect(after.pending.map(c => c.field).sort()).toEqual(['bankAccount', 'phone']);

  await page.getByTestId(tid.profile.propose).click();
  await expect(page.getByTestId(tid.profile.field('phone'))).toBeDisabled();
  await expect(page.getByTestId(tid.profile.field('bankAccount'))).toBeDisabled();
});

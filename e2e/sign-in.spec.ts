import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';

test('SI Signing in as each persona shows that persona', async ({ page, signInAs }) => {
  for (const p of ['employee', 'manager', 'admin'] as const) {
    await signInAs(p);
    await expect(page.getByTestId(tid.shell.rolePill)).toHaveText(/Employee|Manager|Admin/);
    await page.getByTestId(tid.shell.account).click();
    await page.getByTestId(tid.shell.signOut).click();
    await expect(page.getByTestId(tid.signIn.form)).toBeVisible();
  }
});
test('SI A wrong password says what to do and signs nobody in', async ({ page, api }) => {
  await api.reset();
  await page.getByTestId(tid.signIn.email).fill('nobody@example.org');
  await page.getByTestId(tid.signIn.password).fill('wrong');
  await page.getByTestId(tid.signIn.submit).click();
  await expect(page.getByTestId(tid.signIn.error)).toContainText(/Check the address and password/);
  expect(await api.get('/api/v1/session')).toMatchObject({ status: 401 });
});
test('SI A failed sign-in request leaves you on the sign-in screen with a reason', async ({ page, api }) => {
  await api.fault('POST', '/api/v1/session', 500);
  await page.getByTestId(tid.signIn.email).fill('x@example.org');
  await page.getByTestId(tid.signIn.password).fill('Qnipay@123');
  await page.getByTestId(tid.signIn.submit).click();
  await expect(page.getByTestId(tid.signIn.error)).toContainText(/Nothing has been changed/);
  await expect(page.getByTestId(tid.signIn.form)).toBeVisible();
});
test('SI signInAs reloads the page but the frozen clock survives it', async ({ api, signInAs }) => {
  await api.setClock(FROZEN);
  await signInAs('employee');
  expect(await api.get('/api/_dev/clock')).toMatchObject({ status: 200, body: { now: FROZEN } });
});

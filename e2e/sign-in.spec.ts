import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';

test('SI Signing in as each persona shows that persona', async ({ page, signInAs }) => {
  const roleName = { employee: 'Employee', manager: 'Manager', admin: 'Admin' } as const;
  /* Employee and manager both hold own_home (a manager is an employee record
     with extra capabilities, per the seed), so both land on My Work's Home.
     Admin holds no own_* capability at all, so 'work' never exists for it;
     its only "My Team" tab is Onboarding (onb_track, independent of the
     team_* capabilities that gate My Team's other pages and its own Team
     Home landing tab), so admin lands there first, before Qnipay setup
     (src/domain/nav.ts: groups keep 'work'/'team'/'setup' order, and drop
     any group left with no tabs at all). */
  const landingPath = { employee: '/work/home', manager: '/work/home', admin: '/team/tonb' } as const;
  for (const p of ['employee', 'manager', 'admin'] as const) {
    await signInAs(p);
    await expect(page.getByTestId(tid.shell.rolePill)).toHaveText(roleName[p]);
    expect(new URL(page.url()).pathname, `${p} lands on their own surface`).toBe(landingPath[p]);
    await page.getByTestId(tid.shell.account).click();
    await page.getByTestId(tid.shell.signOut).click();
    await expect(page.getByTestId(tid.signIn.form)).toBeVisible();
    await expect(page.getByTestId(tid.shell.account)).toHaveCount(0);
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

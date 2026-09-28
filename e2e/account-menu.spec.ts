import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

/* I5: the account menu names the account and, for a holder of perm_cfg,
   offers one person per role to look at the app as. */
test('ID The menu names the account you are on, and an admin can look at the app as a manager and come back', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  const accounts = (await api.get('/api/v1/session/accounts')).body as { email: string; userType: string; personCode: string; name: string }[];
  const admin = accounts.find(a => a.userType === 'admin'), manager = accounts.find(a => a.userType === 'manager');
  if (!admin || !manager) throw new Error('no seeded admin or manager');

  await page.getByTestId(tid.shell.account).click();
  await expect(page.getByTestId(tid.shell.menuAccount)).toContainText(admin.name);
  await expect(page.getByTestId(tid.shell.menuAccount)).toContainText(admin.email);
  await expect(page.getByTestId(tid.shell.menuAccount)).toContainText(admin.personCode);
  await expect(page.getByText('Your account')).toBeVisible();
  await page.getByTestId(tid.shell.viewAs(manager.personCode)).click();

  await expect(page.getByTestId(tid.shell.viewAsEnd)).toBeVisible();
  await expect(page.getByTestId(tid.shell.rolePill)).toHaveText('Manager');
  await page.getByTestId(tid.shell.account).click();
  await expect(page.getByTestId(tid.shell.menuAccount)).toContainText(admin.name);
  await page.getByTestId(tid.shell.menuViewAsEnd).click();
  await expect(page.getByTestId(tid.shell.viewAsEnd)).toHaveCount(0);
  await expect(page.getByTestId(tid.shell.rolePill)).toHaveText('Admin');
});

test('ID An employee is offered nobody to view as', async ({ page, signInAs }) => {
  await signInAs('employee');
  await page.getByTestId(tid.shell.account).click();
  await expect(page.getByTestId(tid.shell.menuAccount)).toBeVisible();
  await expect(page.locator('[data-testid^="shell-view-as-"]')).toHaveCount(0);
  await expect(page.getByText('Look at the app as somebody else')).toHaveCount(0);
});

/* I4: view-as is a preview; a write made while viewing is refused and changes nothing. */
test('SV While viewing as someone, a change is refused and the store is unchanged', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  const accounts = (await api.get('/api/v1/session/accounts')).body as { userType: string; personCode: string }[];
  const manager = accounts.find(a => a.userType === 'manager');
  if (!manager) throw new Error('no seeded manager');
  const before = (await api.get('/api/v1/user-types')).body as { id: string; version: number }[];
  const employeeType = before.find(t => t.id === 'employee');
  if (!employeeType) throw new Error('no employee user type');
  expect((await api.send('POST', '/api/v1/session/view-as', { personCode: manager.personCode })).status).toBe(200);
  const refused = await page.evaluate(async version => {
    const token = sessionStorage.getItem('qnipay.session');
    const r = await fetch('/api/v1/user-types/employee/capabilities/proxy', { method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}`, 'If-Match': String(version) }, body: JSON.stringify({ granted: true }) });
    return { status: r.status, body: await r.json() as { code: string; next: string } };
  }, employeeType.version);
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({ code: 'viewing-as', next: expect.stringContaining('Return to your own account') });
  expect((await api.send('DELETE', '/api/v1/session/view-as')).status).toBe(200);
  expect((await api.get('/api/v1/user-types')).body).toEqual(before);
});

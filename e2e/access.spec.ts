import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

test('Permissions: granting a capability to a template is saved and audited', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  const cell = page.getByTestId(tid.access.cell('proxy', 'employee'));
  await expect(cell).toBeVisible();
  const was = await cell.getAttribute('aria-pressed');
  const saved = page.waitForResponse(r => r.url().includes('/user-types/employee/capabilities/proxy') && r.status() === 200);
  await cell.click();
  await saved;
  await expect(cell).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true');
  const types = (await api.get('/api/v1/user-types')).body as { id: string; capabilities: string[] }[];
  const employeeType = types.find(t => t.id === 'employee');
  if (!employeeType) throw new Error('no "employee" user type in the response');
  expect(employeeType.capabilities.includes('proxy')).toBe(was !== 'true');
  const audit = (await api.get('/api/v1/audit?entity=userType')).body as { items: { act: string }[] };
  expect(audit.items[0]?.act).toBe('Permission changed');
});

test('Permissions: the locked cell cannot be changed', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  await expect(page.getByTestId(tid.access.cell('perm_cfg', 'admin'))).toBeDisabled();
});

test('Permissions: a fault leaves the matrix and the store unchanged', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  /* Wait for the page's own fetch to land before driving one through
     api.get: right after navigation, MSW's service worker can still be
     re-registering, and a manual fetch too soon falls through to Vite's SPA
     fallback (HTML, not JSON) instead of being intercepted. */
  await expect(page.getByTestId(tid.access.table)).toBeVisible();
  const before = (await api.get('/api/v1/user-types')).body;
  await api.fault('PUT', '/api/v1/user-types/employee/capabilities/proxy', 500);
  const cell = page.getByTestId(tid.access.cell('proxy', 'employee'));
  const was = await cell.getAttribute('aria-pressed');
  if (was === null) throw new Error('cell has no aria-pressed attribute');
  await cell.click();
  await expect(page.getByTestId(tid.toast.error)).toContainText('Nothing has been changed');
  await expect(cell).toHaveAttribute('aria-pressed', was);
  expect((await api.get('/api/v1/user-types')).body).toEqual(before);
});

test('Permissions: a per-user exception needs a reason and shows on the row', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  const users = (await api.get('/api/v1/users')).body as { email: string; userType: string }[];
  const emp = users.find(u => u.userType === 'employee');
  if (!emp) throw new Error('no seeded "employee" account');
  await page.goto('/setup/aperm');
  await page.getByTestId(tid.access.exceptionAdd(emp.email)).click();
  await page.getByTestId(tid.access.exceptionCap).click();
  await page.getByTestId(`${tid.access.exceptionCap}-option-proxy`).click();
  await page.getByTestId(tid.access.exceptionSave).click();
  await expect(page.getByTestId(tid.toast.error)).toContainText('Give a reason');
  await page.getByTestId(tid.access.exceptionReason).fill('Covers the rota lead on Fridays');
  await page.getByTestId(tid.access.exceptionSave).click();
  await expect(page.getByTestId(tid.access.exceptions(emp.email))).toHaveText(/Employee \+ 1 exception/);
  const after = ((await api.get('/api/v1/users')).body as { email: string; grants: string[] }[]).find(u => u.email === emp.email);
  if (!after) throw new Error('the employee account disappeared from /api/v1/users');
  expect(after.grants).toContain('proxy');
});

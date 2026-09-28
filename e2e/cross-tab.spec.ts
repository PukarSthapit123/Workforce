import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

/* Review Focus 1: the fake server runs once per tab, each with its own copy of
   the database. A second tab working from an older copy must meet the newer
   version and be refused, never overwrite the first tab's change. */
test('a stale write from a second tab is refused with 412, and the first tab\'s change and audit row survive', async ({ page, context, api, signInAs }) => {
  await signInAs('admin');
  const accounts = (await api.get('/api/v1/session/accounts')).body as { email: string; userType: string }[];
  const admin = accounts.find(a => a.userType === 'admin');
  if (!admin) throw new Error('no seeded admin account');

  const tabB = await context.newPage();
  await tabB.goto('/');
  await tabB.getByTestId(tid.signIn.email).fill(admin.email);
  await tabB.getByTestId(tid.signIn.password).fill('Qnipay@123');
  await tabB.getByTestId(tid.signIn.submit).click();
  await expect(tabB.getByTestId(tid.shell.account)).toBeVisible();

  await page.goto('/setup/aperm');
  await tabB.goto('/setup/aperm');
  const cellA = page.getByTestId(tid.access.cell('proxy', 'employee'));
  const cellB = tabB.getByTestId(tid.access.cell('proxy', 'employee'));
  await expect(cellA).toBeVisible();
  await expect(cellB).toBeVisible();
  const was = await cellA.getAttribute('aria-pressed');
  await expect(cellB).toHaveAttribute('aria-pressed', was ?? 'false');

  const savedA = page.waitForResponse(r => r.url().includes('/user-types/employee/capabilities/proxy') && r.request().method() === 'PUT');
  await cellA.click();
  expect((await savedA).status()).toBe(200);
  await expect(cellA).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true');

  /* Tab B still shows the old state, so its click is a write based on the old version. */
  await expect(cellB).toHaveAttribute('aria-pressed', was ?? 'false');
  const savedB = tabB.waitForResponse(r => r.url().includes('/user-types/employee/capabilities/proxy') && r.request().method() === 'PUT');
  await cellB.click();
  expect((await savedB).status()).toBe(412);
  await expect(tabB.getByTestId(tid.toast.error)).toContainText('Reload and apply your change again');

  const types = (await api.get('/api/v1/user-types')).body as { id: string; capabilities: string[] }[];
  expect(types.find(t => t.id === 'employee')?.capabilities.includes('proxy')).toBe(was !== 'true');
  const audit = (await api.get('/api/v1/audit?entity=userType')).body as { items: { act: string; entityId: string }[] };
  expect(audit.items.filter(i => i.act === 'Permission changed' && i.entityId === 'employee')).toHaveLength(1);
  await tabB.close();
});

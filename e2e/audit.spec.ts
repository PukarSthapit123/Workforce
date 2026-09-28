import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

test('Audit: a permission change appears at the top with who and before -> after', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  await expect(page.getByTestId(tid.access.table)).toBeVisible();
  const saved = page.waitForResponse(r => r.url().includes('/capabilities/proxy') && r.ok());
  await page.getByTestId(tid.access.cell('proxy', 'employee')).click(); await saved;
  await page.goto('/setup/iaudit');
  const first = page.getByTestId(tid.audit.table).locator('tbody tr').first();
  await expect(first).toContainText('Permission changed');
  await expect(first).toContainText('13/08/2026 15:30');   // 14:30 UTC is 15:30 in London in August
  await expect(first).toContainText(/proxy: (no → yes|yes → no)/);
});

test('Audit: a failed load says so and shows no stale rows as current', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/iaudit');
  await expect(page.getByTestId(tid.page('iaudit'))).toBeVisible();
  /* A fault registered here (same document) rather than before this goto: a
     goto is a real browser navigation, which would reload the page and throw
     away the in-memory fault array (see support/fixtures.ts on signInAs and
     the same reload). Typing into a filter changes the query key and issues a
     fresh same-document request, which the fault above can still catch. */
  await api.fault('GET', '/api/v1/audit', 500);
  await page.getByTestId(tid.audit.filterText).fill('x');
  await expect(page.getByTestId(tid.audit.error)).toContainText('The audit log could not be loaded');
  await expect(page.getByTestId(tid.audit.table)).toHaveCount(0);
});

/* I6: SIGN IN / SIGN OUT "Sign in and sign out are audited". */
test('SI Sign in and sign out are audited', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.getByTestId(tid.shell.account).click();
  await page.getByTestId(tid.shell.signOut).click();
  await expect(page.getByTestId(tid.signIn.form)).toBeVisible();
  await signInAs('admin');
  await page.goto('/setup/iaudit');
  const table = page.getByTestId(tid.audit.table);
  await expect(table).toContainText('Signed in');
  await expect(table).toContainText('Signed out');
});

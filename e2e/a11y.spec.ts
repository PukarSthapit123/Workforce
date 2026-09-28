import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

/* Every built page beyond sign-in, keyed to the one extra piece of its own
   data (besides the page container itself) that means it is actually ready:
   the permissions matrix or the audit table. Running axe or the overflow
   check the instant after goto() risks catching the page mid-fetch (its
   loading state, or nothing yet), rather than the page as a person would
   actually see it. */
const READY: Record<string, string> = { '/setup/aperm': tid.access.table, '/setup/iaudit': tid.audit.table };

async function waitUntilReady(page: Page, path: string) {
  const view = path.split('/').pop() ?? '';
  await page.getByTestId(tid.page(view)).waitFor();
  const extra = READY[path];
  if (extra) await page.getByTestId(extra).waitFor();
}

/* A fresh admin session starts with an empty audit log (the seed carries no
   audit rows), and the log's own empty state carries no test id to wait on.
   Toggling one capability while on /setup/aperm (visited before /setup/iaudit
   in the loop below) gives /setup/iaudit a real row, so waitUntilReady's wait
   for tid.audit.table below does not hang forever on an empty log. */
async function seedOneAuditRow(page: Page) {
  const saved = page.waitForResponse(r => r.url().includes('/capabilities/proxy') && r.ok());
  await page.getByTestId(tid.access.cell('proxy', 'employee')).click();
  await saved;
}

for (const theme of ['light', 'dark'] as const) {
  test(`axe: sign-in, permissions and audit have no serious issues (${theme})`, async ({ page, signInAs }) => {
    const check = async () => {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    };
    await page.getByTestId(tid.signIn.form).waitFor();
    await check();
    await signInAs('admin');
    for (const path of ['/setup/asetup', '/setup/aperm', '/setup/iaudit']) {
      await page.goto(path);
      await waitUntilReady(page, path);
      if (path === '/setup/aperm') await seedOneAuditRow(page);
      await check();
    }
  });
}
test('phone: no horizontal overflow on built pages at 390px', async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs('admin');
  for (const path of ['/setup/asetup', '/setup/aperm', '/setup/iaudit']) {
    await page.goto(path);
    await waitUntilReady(page, path);
    if (path === '/setup/aperm') await seedOneAuditRow(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './support/fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`axe: sign-in, permissions and audit have no serious issues (${theme})`, async ({ page, signInAs }) => {
    const check = async () => {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    };
    await check();
    await signInAs('admin');
    for (const path of ['/setup/asetup', '/setup/aperm', '/setup/iaudit']) { await page.goto(path); await check(); }
  });
}
test('phone: no horizontal overflow on built pages at 390px', async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs('admin');
  for (const path of ['/setup/asetup', '/setup/aperm', '/setup/iaudit']) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});

import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';

/* Spec §10.3 visual baselines: the six key plan-1a screens at desktop (1440)
   and phone (390) widths, in light and dark, against a frozen clock. The
   baselines were taken once the frame matched the prototype side by side
   (.superpowers/sdd/ui-fidelity-report.md), so a diff here is drift from
   that agreed look. Refresh them deliberately, with --update-snapshots,
   only after comparing the change against the prototype again. */

const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0); // no hover state left over from a click
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the six key screens at ${w}px, ${theme}`, async ({ page, signInAs }) => {
      test.setTimeout(60_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set below */ } }, theme);
      const shot = async (name: string, fullPage = true) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage });
      };

      await page.goto('/');
      await page.getByTestId(tid.signIn.showAccounts).click();
      await page.locator('[data-testid^="sign-in-account-"]').first().waitFor();
      await shot('sign-in');

      await signInAs('admin');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      /* the admin's first tab is Team onboarding (tonb), built in module 5 */
      await page.getByTestId(tid.page('tonb')).waitFor();
      await page.getByTestId(tid.tonb.list).waitFor();
      await shot('landing', false);

      await page.goto('/setup/asetup');
      await page.getByTestId(tid.setup.card('gov')).waitFor();
      await shot('setup-index');

      await page.goto('/setup/aperm');
      await page.getByTestId(tid.access.table).waitFor();
      await page.getByTestId(tid.access.reach).waitFor();
      await shot('permissions');

      await page.goto('/setup/iaudit');
      await page.getByTestId(tid.audit.table).waitFor();
      await shot('audit');

      await page.getByTestId(tid.shell.account).click();
      await page.getByTestId(tid.shell.menuAccount).waitFor();
      await page.locator('[data-testid^="shell-view-as-"]').first().waitFor();
      await shot('account-menu', false);
    });
  }
}

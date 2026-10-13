import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL } from './support/rota';

/* Spec §10.3 visual baselines for module 6's six screens: My hours for Amara
   Okafor; Hours position and Exceptions for Rachel Hussain; Pay codes,
   Payroll readiness (NOT READY, with its blockers) and Business Central (its
   failed posting) for Dee Fitzgerald. At desktop (1440) and phone (390)
   widths, in light and dark, on the social seed against the frozen clock.
   Refresh them deliberately, with --update-snapshots, only after comparing a
   change against the prototype. */
const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the module 6 screens at ${w}px, ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set on the html element */ } }, theme);
      const shot = async (name: string) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage: true });
      };

      await signInEmail(page, AMARA);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.goto('/work/hours');
      await page.getByTestId(tid.hours.days).waitFor();
      await shot('hours');

      await signInEmail(page, RACHEL);
      await page.goto('/team/thours');
      await page.getByTestId(tid.thours.table).waitFor();
      await shot('thours');
      await page.goto('/team/texc');
      await page.getByTestId(tid.texc.list).waitFor();
      await shot('texc');

      await signInEmail(page, DEE);
      await page.goto('/setup/mpay');
      await page.getByTestId(tid.mpay.table).waitFor();
      await shot('mpay');
      await page.goto('/setup/ipay');
      await page.getByTestId(tid.ipay.blockers).waitFor();
      await shot('ipay');
      await page.goto('/setup/ibc');
      await page.getByTestId(tid.ibc.retry('int_a1f3')).waitFor();
      await page.getByTestId(tid.ibc.mapping).waitFor();
      await shot('ibc');
    });
  }
}

import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { DEE } from './support/rota';
import { AMARA_DAY, PRIYA_REQUEST, waitingOnDee } from './support/approvals';

/* Spec §10.3 visual baselines for what module 8 added to screens whose own
   baselines never show it: a second layer on the Timesheet, Leave and Rota
   approval chains (support/approvals.ts), seen by Dee Fitzgerald, who decides
   it. Team rota with the weeks waiting on her sign-off, Team timesheets
   waiting on payroll, and Team leave at its second layer, at desktop (1440)
   and phone (390) widths, in light and dark, on the social seed against the
   frozen clock. Refresh them deliberately, with --update-snapshots, only
   after comparing a change against the prototype. */
const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the approval chain states at ${w}px, ${theme}`, async ({ page, api }) => {
      test.setTimeout(120_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await waitingOnDee(page, api);
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set on the html element */ } }, theme);
      const shot = async (name: string) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage: true });
      };

      await signInEmail(page, DEE);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.goto('/team/trota');
      await page.getByTestId(tid.trota.awaiting).getByTestId(tid.trota.awaitingWeek('rw_WH_2026-08-17')).click();
      await page.getByTestId(tid.trota.signOff).waitFor();
      await page.getByTestId(tid.trota.dayview).waitFor();
      if (w > 400) await page.getByTestId(tid.trota.grid).waitFor();
      await shot('trota-signoff');

      await page.goto('/team/tteam');
      await page.getByTestId(tid.tteam.filter('mgrok')).click();
      await page.getByTestId(tid.tteam.approve(AMARA_DAY)).waitFor();
      await shot('tteam-payroll');

      await page.goto('/team/tleave');
      await page.getByTestId(tid.tleave.layer(PRIYA_REQUEST)).waitFor();
      await page.getByTestId(tid.tleave.balances).waitFor();
      await shot('tleave-layer');
    });
  }
}

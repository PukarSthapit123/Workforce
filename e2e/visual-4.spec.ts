import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL } from './support/rota';

/* Spec §10.3 visual baselines for module 4's screens, at desktop (1440) and
   phone (390) widths, in light and dark, on the social seed against the
   frozen clock, where Leave, Rota and every LV_* flag are on: My leave for
   Amara Okafor, Team leave (with the escalated banner and the rota link) and
   Sickness (the trigger banner, Bradford table and sickness during booked
   leave) for Rachel Hussain, and Leave setup for Dee Fitzgerald. These record
   the screens as ported; refresh them deliberately, with --update-snapshots,
   only after comparing a change against the prototype. */
const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the module 4 screens at ${w}px, ${theme}`, async ({ page }) => {
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
      await page.goto('/work/leave');
      await page.getByTestId(tid.leave.cards).waitFor();
      await page.getByTestId(tid.leave.history).waitFor();
      await shot('leave');

      await signInEmail(page, RACHEL);
      await page.goto('/team/tleave');
      await page.getByTestId(tid.tleave.card('lr_1')).waitFor();
      await page.getByTestId(tid.tleave.balances).waitFor();
      await shot('tleave');

      await page.goto('/team/tsick');
      await page.getByTestId(tid.tsick.table).waitFor();
      await page.getByTestId(tid.tsick.banner).waitFor();
      await shot('tsick');

      await signInEmail(page, DEE);
      await page.goto('/setup/mleave');
      await page.getByTestId(tid.mleave.card('rota')).waitFor();
      await page.getByTestId(tid.mleave.leavers).waitFor();
      await shot('mleave');
    });
  }
}

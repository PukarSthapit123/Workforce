import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { AMARA, clockMove, london, openMyDay } from './support/clock';

/* Spec §10.3 visual baselines for module 2b's clock card on My timesheet's
   day view, at desktop (1440) and phone (390) widths, in light and dark, on
   the social seed: Amara Okafor clocked in at 14:30 and an hour into her
   shift at the frozen 15:30, then clocked out at 16:00. The browser's clock is
   frozen too, so the timer shows the server's elapsed time and does not tick.
   These record the card as ported against P's .clockcard; refresh them
   deliberately, with --update-snapshots, only after comparing a change
   against the prototype. */
const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the clock card running and clocked out at ${w}px, ${theme}`, async ({ page, api }) => {
      test.setTimeout(90_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set on the html element */ } }, theme);
      const shot = async (name: string) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage: true });
      };

      await signInEmail(page, AMARA);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await api.setClock(london('14:30'));
      expect((await clockMove(page, api, 'in')).status).toBe(200);
      await api.setClock(FROZEN);
      await openMyDay(page);
      await expect(page.getByTestId(tid.clock.timer)).toHaveText('1:00:00');
      await shot('clock-running');

      await api.setClock(london('16:00'));
      expect((await clockMove(page, api, 'out')).status).toBe(200);
      await openMyDay(page);
      await expect(page.getByTestId(tid.clock.again)).toBeVisible();
      await expect(page.getByTestId(tid.dayForm.field('finish'))).toHaveValue('16:00');
      await shot('clock-out');
    });
  }
}

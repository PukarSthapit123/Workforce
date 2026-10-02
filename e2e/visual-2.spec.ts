import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { BIGYAN, EDDIE, PUKAR, signInEmail } from './support/timesheet';

/* Spec §10.3 visual baselines for module 2's screens, at desktop (1440) and
   phone (390) widths, in light and dark, on the qnipay seed against the
   frozen clock: My timesheet (week and day), Team timesheets (the day queue
   and the week matrix) and Timesheet setup. These record the screens as
   ported; the fidelity gaps open in report.md are in them. Refresh them
   deliberately, with --update-snapshots, only after comparing a change
   against the prototype. */
const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the module 2 screens at ${w}px, ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set on the html element */ } }, theme);
      const shot = async (name: string) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage: true });
      };

      await signInEmail(page, BIGYAN);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.goto('/work/ts');
      await page.getByTestId(tid.week.grid).waitFor();
      await page.getByTestId(tid.ts.multiweek).waitFor();
      await shot('ts-week');
      await page.getByTestId(tid.ts.view('day')).click();
      await page.getByTestId(tid.dayForm.field('start')).waitFor();
      await shot('ts-day');

      await signInEmail(page, PUKAR);
      await page.goto('/team/tteam');
      await page.getByTestId(tid.tteam.table).waitFor();
      await shot('tteam-queue');
      await page.getByTestId(tid.tteam.view('week')).click();
      await expect(page.getByTestId(tid.tteam.pip('EMP004', 2))).toHaveAttribute('data-state', 'pend');
      await shot('tteam-week');

      await signInEmail(page, EDDIE);
      await page.goto('/setup/mts');
      await page.getByTestId(tid.mts.card('rules')).waitFor();
      await page.getByTestId(tid.mts.card('boundary')).waitFor();
      await shot('mts');
    });
  }
}

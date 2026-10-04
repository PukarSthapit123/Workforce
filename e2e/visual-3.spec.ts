import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL } from './support/rota';

/* Spec §10.3 visual baselines for module 3's screens, at desktop (1440) and
   phone (390) widths, in light and dark, on the social seed against the
   frozen clock: Team rota (the week grid at 1440, the day view at 390), Shift
   catalogue, Working patterns, Cover requests, My shifts, Rota setup, and My
   timesheet's day with the rota banner. These record the screens as ported;
   the fidelity gaps open in report.md are in them. Refresh them deliberately,
   with --update-snapshots, only after comparing a change against the
   prototype. */
const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the module 3 screens at ${w}px, ${theme}`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set on the html element */ } }, theme);
      const shot = async (name: string) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage: true });
      };

      await signInEmail(page, RACHEL);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.goto('/team/trota');
      await page.getByTestId(tid.trota.dayview).waitFor();
      await page.getByTestId(tid.trota.history).waitFor();
      if (w > 400) await page.getByTestId(tid.trota.grid).waitFor();
      await shot(w > 400 ? 'trota-week' : 'trota-day');

      await page.goto('/team/tshifts');
      await page.getByTestId(tid.tshifts.catalogue).waitFor();
      await shot('tshifts');

      await page.goto('/team/tpat');
      await page.getByTestId(tid.tpat.row('WP-02')).waitFor();
      await shot('tpat');

      await page.goto('/team/tcover');
      await page.getByTestId(tid.tcover.request('cov_2')).waitFor();
      await page.getByTestId(tid.tcover.filled('fil_1')).waitFor();
      await expect(page.locator('[data-testid^="tcover-sug-cov-2-"], [data-testid="tcover-nobody-cov-2"]').first()).toBeVisible();
      await shot('tcover');

      await signInEmail(page, AMARA);
      await page.goto('/work/shifts');
      await page.getByTestId(tid.shifts.cards).waitFor();
      await shot('shifts');
      await page.goto('/work/ts');
      await page.getByTestId(tid.ts.view('day')).click();
      await page.getByTestId(tid.ts.banner('rota')).waitFor();
      await shot('ts-day-rota');

      await signInEmail(page, DEE);
      await page.goto('/setup/mrota');
      await page.getByTestId(tid.mrota.card('staffing')).waitFor();
      await page.getByTestId(tid.tshifts.catalogue).waitFor();
      await page.getByTestId(tid.mrota.patterns).waitFor();
      await shot('mrota');
    });
  }
}

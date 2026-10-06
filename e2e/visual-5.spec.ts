import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { EDDIE, PUKAR, TOM, completeMine, openPortal, openTracker } from './support/onboarding';

/* Spec §10.3 visual baselines for module 5's screens, at desktop (1440) and
   phone (390) widths, in light and dark, on the qnipay seed against the
   frozen clock, where Onboarding and every ONB_* feature are on: Tom
   Achterberg's portal on its first step, then (once he has sent everything
   through the server) his submitted page; Team onboarding for Pukar Sthapit
   with Tom's three documents waiting on a check; and Onboarding setup for
   Eddie Harford. These record the screens as ported; refresh them
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
    test(`visual: the module 5 screens at ${w}px, ${theme}`, async ({ page, api }) => {
      test.setTimeout(120_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set on the html element */ } }, theme);
      const shot = async (name: string) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage: true });
      };

      await signInEmail(page, TOM);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await openPortal(page);
      await page.getByTestId(tid.onb.body('personal')).waitFor();
      await shot('onb-step');

      await completeMine(page, api);
      await page.goto('/work/onb');
      await page.getByTestId(tid.onb.submitted).waitFor();
      await shot('onb-submitted');

      await signInEmail(page, PUKAR);
      await openTracker(page);
      await page.getByTestId(tid.tonb.queue).waitFor();
      await page.getByTestId(tid.tonb.table).waitFor();
      await shot('tonb');

      await signInEmail(page, EDDIE);
      await page.goto('/setup/monb');
      await page.getByTestId(tid.monb.card('steps')).waitFor();
      await page.getByTestId(tid.monb.policies).waitFor();
      await shot('monb');
    });
  }
}

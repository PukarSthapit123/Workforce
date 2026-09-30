import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';

/* Spec §10.3 visual baselines for the main plan 1b screens, at desktop
   (1440) and phone (390) widths, in light and dark, against the frozen
   clock. Taken once each screen had been compared side by side with the
   prototype (module-report.md, Task 18). Refresh them deliberately, with
   --update-snapshots, only after comparing a change against the prototype. */
const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the plan 1b screens at ${w}px, ${theme}`, async ({ page, signInAs }) => {
      test.setTimeout(120_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set on the html element */ } }, theme);
      const shot = async (name: string, fullPage = true) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage });
      };
      const at = async (path: string, ready: string) => { await page.goto(path); await page.getByTestId(ready).waitFor(); };

      await signInAs('admin');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await at('/setup/apeople', tid.people.table);
      await shot('people');
      await page.getByTestId(tid.people.add).click();
      await expect(page.getByTestId(tid.personForm.field('code'))).not.toHaveValue('');
      await shot('person-form', false);
      await page.keyboard.press('Escape');
      await at('/setup/aloc', tid.dims.card('projects'));
      await shot('dimensions');
      await at('/setup/aloc?d=locations', tid.dims.table);
      await shot('locations');
      await at('/setup/acon', tid.contracts.table);
      await shot('contracts');
      await at('/setup/atypes', tid.types.detail);
      await page.getByTestId(tid.types.cap('vehicle')).waitFor();
      await shot('employee-types');

      await signInAs('manager');
      await at('/team/tpeople', tid.people.table);
      await page.getByTestId(tid.queue.root('manager')).waitFor();
      await shot('team-people');

      await signInAs('employee');
      await at('/work/profile', tid.profile.state);
      await shot('profile');
    });
  }
}

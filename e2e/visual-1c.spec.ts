import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL } from './support/rota';

/* Spec §10.3 visual baselines for 1c's screens, at desktop (1440) and phone
   (390) widths, in light and dark, on the social seed against the frozen
   clock: My home (the month calendar, its key and the notices card), My
   documents and Notices for Amara Okafor; Team Home and team Notices for
   Rachel Hussain; Organisation, Calendar and saved data, Modules & features
   (the list and Timesheet's drill-in), Notifications and Approvals for Dee
   Fitzgerald; and the page-unavailable page. These record the screens as
   ported; refresh them deliberately, with --update-snapshots, only after
   comparing a change against the prototype. */
const WIDTHS = [{ w: 1440, h: 1000 }, { w: 390, h: 844 }] as const;
const THEMES = ['light', 'dark'] as const;
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

for (const { w, h } of WIDTHS) {
  for (const theme of THEMES) {
    test(`visual: the 1c screens at ${w}px, ${theme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.clock.setFixedTime(new Date(FROZEN));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(t => { try { localStorage.setItem('qnipay.theme', t); } catch { /* the theme is also set on the html element */ } }, theme);
      const shot = async (name: string) => {
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, { fullPage: true });
      };
      const visit = async (path: string, ...ready: string[]) => {
        await page.goto(path);
        for (const r of ready) await page.getByTestId(r).waitFor();
      };

      await signInEmail(page, AMARA);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await visit('/work/home', tid.home.grid, tid.home.key, tid.noticeHome.card);
      await shot('home');
      await visit('/work/docs', tid.docs.card, tid.docs.payroll);
      await shot('docs');
      await visit('/work/notices', tid.notices.table);
      await shot('notices');

      await signInEmail(page, RACHEL);
      await visit('/team/thome', tid.thome.grid);
      await expect(page.getByTestId(tid.thome.grid).locator('[data-testid^="thome-count-"]').first()).not.toBeEmpty();
      await shot('thome');
      await visit('/team/tnotices', tid.tnotices.table);
      await shot('tnotices');
      await visit('/team/no-such-page', tid.unavailable.root);
      await shot('unavailable');

      await signInEmail(page, DEE);
      await visit('/setup/aorg', tid.aorg.spine, tid.aorg.noSaved, tid.aorg.live);
      await expect(page.getByTestId(tid.aorg.live)).toContainText('is applied to');
      await shot('aorg');
      await visit('/setup/acal', tid.acal.holidays, tid.acal.card('saved'), tid.acal.size);
      await expect(page.getByTestId(tid.acal.size)).toContainText('KB held');
      await shot('acal');
      await visit('/setup/amods', tid.amods.card('TS'));
      await shot('amods');
      await visit('/setup/amods?m=TS', tid.amods.features);
      await shot('amods-ts');
      await visit('/setup/anotif', tid.anotif.table, tid.anotif.evidence);
      await shot('anotif');
      await visit('/setup/aappr', tid.aappr.chainTable, tid.aappr.delegTable);
      await shot('aappr');
    });
  }
}

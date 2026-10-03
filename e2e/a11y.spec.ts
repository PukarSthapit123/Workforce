import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { BIGYAN, EDDIE, PUKAR, signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL } from './support/rota';
import { tid } from '../src/testids';

/* Flip the theme, then let the colour transitions it starts finish: axe reads
   computed colours, and a chip caught mid-transition reads as low contrast. */
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(async t => {
    document.documentElement.setAttribute('data-theme', t);
    await Promise.all(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => undefined)));
  }, theme);
}

/* Every built page beyond sign-in, keyed to the one extra piece of its own
   data (besides the page container itself) that means it is actually ready:
   the permissions matrix or the audit table. Running axe or the overflow
   check the instant after goto() risks catching the page mid-fetch (its
   loading state, or nothing yet), rather than the page as a person would
   actually see it. */
const READY: Record<string, string> = { '/setup/aperm': tid.access.table, '/setup/iaudit': tid.audit.table };

async function waitUntilReady(page: Page, path: string) {
  const view = path.split('/').pop() ?? '';
  await page.getByTestId(tid.page(view)).waitFor();
  const extra = READY[path];
  if (extra) await page.getByTestId(extra).waitFor();
}

/* A fresh admin session starts with an empty audit log (the seed carries no
   audit rows), and the log's own empty state carries no test id to wait on.
   Toggling one capability while on /setup/aperm (visited before /setup/iaudit
   in the loop below) gives /setup/iaudit a real row, so waitUntilReady's wait
   for tid.audit.table below does not hang forever on an empty log. */
async function seedOneAuditRow(page: Page) {
  const saved = page.waitForResponse(r => r.url().includes('/capabilities/proxy') && r.ok());
  await page.getByTestId(tid.access.cell('proxy', 'employee')).click();
  await saved;
}

for (const theme of ['light', 'dark'] as const) {
  test(`axe: sign-in, permissions and audit have no serious issues (${theme})`, async ({ page, signInAs }) => {
    const check = async () => {
      await setTheme(page, theme);
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    };
    await page.getByTestId(tid.signIn.form).waitFor();
    await check();
    await signInAs('admin');
    for (const path of ['/setup/asetup', '/setup/aperm', '/setup/iaudit']) {
      await page.goto(path);
      await waitUntilReady(page, path);
      if (path === '/setup/aperm') await seedOneAuditRow(page);
      await check();
    }
  });
}
test('phone: no horizontal overflow on built pages at 390px', async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs('admin');
  for (const path of ['/setup/asetup', '/setup/aperm', '/setup/iaudit']) {
    await page.goto(path);
    await waitUntilReady(page, path);
    if (path === '/setup/aperm') await seedOneAuditRow(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});

/* Plan 1b's pages, each read once its own data is on screen, for the
   persona that reaches it; the person form and the proposal dialog too. */
const PAGES_1B: Record<'admin' | 'manager' | 'employee', [string, string][]> = {
  admin: [['/setup/apeople', tid.people.table], ['/setup/aloc', tid.dims.card('locations')], ['/setup/aloc?d=locations', tid.dims.table],
    ['/setup/aloc?d=projects', tid.dims.table], ['/setup/acon', tid.contracts.table], ['/setup/atypes', tid.types.detail]],
  manager: [['/team/tpeople', tid.people.table]],
  employee: [['/work/profile', tid.profile.state]],
};
const DIALOGS_1B: Record<string, [string, string]> = { '/setup/apeople': [tid.people.add, tid.personForm.root], '/work/profile': [tid.profile.propose, tid.profile.send] };
for (const theme of ['light', 'dark'] as const) {
  for (const persona of ['admin', 'manager', 'employee'] as const) {
    test(`axe: plan 1b pages for the ${persona} have no serious issues (${theme})`, async ({ page, signInAs }) => {
      test.setTimeout(90_000); // six admin pages, a dialog and an axe run on each
      const check = async (where: string) => {
        await setTheme(page, theme);
        const r = await new AxeBuilder({ page }).analyze();
        expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${where} ${v.id}: ${v.nodes.length}`)).toEqual([]);
      };
      await signInAs(persona);
      for (const [path, ready] of PAGES_1B[persona]) {
        await page.goto(path);
        await page.getByTestId(ready).waitFor();
        await check(path);
        const dialog = DIALOGS_1B[path];
        if (dialog) {
          await page.getByTestId(dialog[0]).click();
          await page.getByTestId(dialog[1]).waitFor();
          await check(`${path} dialog`);
          await page.keyboard.press('Escape');
        }
      }
    });
  }
}
test('phone: plan 1b pages have no horizontal overflow at 390px', async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const persona of ['admin', 'manager', 'employee'] as const) {
    await signInAs(persona);
    for (const [path, ready] of PAGES_1B[persona]) {
      await page.goto(path);
      await page.getByTestId(ready).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }
  }
});

/* Module 2's pages on the qnipay seed, where the timesheet data is: My
   timesheet (week and day) for Bigyan Poudel, Team timesheets (queue, week
   matrix, return and bulk dialogs) and proxy entry for Pukar Sthapit, and
   Timesheet setup with its Add allowance dialog for Eddie Harford. Each step
   is one state of the screen, read once its own data is on screen. */
type Step = [where: string, go: (page: Page) => Promise<void>];
const open = (path: string, ready: string) => async (page: Page) => { await page.goto(path); await page.getByTestId(ready).waitFor(); };
const click = (testId: string, ready: string) => async (page: Page) => { await page.getByTestId(testId).click(); await page.getByTestId(ready).waitFor(); };
const escape = async (page: Page) => { await page.keyboard.press('Escape'); await expect(page.getByTestId(tid.modal.root)).toHaveCount(0); };
const PAGES_2: [string, Step[]][] = [
  [BIGYAN, [
    ['/work/ts week', open('/work/ts', tid.week.grid)],
    ['/work/ts day', click(tid.ts.view('day'), tid.dayForm.field('start'))],
  ]],
  [PUKAR, [
    ['/team/tteam queue', open('/team/tteam', tid.tteam.table)],
    ['return dialog', click(tid.tteam.ret('tsd_EMP005_2026-08-11'), tid.tteam.returnReason)],
    ['bulk dialog', async page => { await escape(page); await click(tid.tteam.approveAll, tid.tteam.bulkAck)(page); }],
    ['/team/tteam week', async page => { await escape(page); await click(tid.tteam.view('week'), tid.tteam.matrix)(page); }],
    ['proxy dialog day', async page => { await open('/team/tpeople', tid.people.table)(page); await page.getByTestId(tid.people.open('EMP005')).click();
      await click(tid.proxy.open, tid.dayForm.field('start'))(page); }],
    ['proxy dialog week', click(tid.proxy.view('week'), tid.week.grid)],
  ]],
  [EDDIE, [
    ['/setup/mts', open('/setup/mts', tid.mts.card('rules'))],
    ['add allowance dialog', click(tid.mts.allowAdd, tid.mts.allowName)],
  ]],
];
test.describe('module 2 pages', () => {
  test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
  for (const theme of ['light', 'dark'] as const) {
    test(`axe: timesheet pages and dialogs have no serious issues (${theme})`, async ({ page }) => {
      test.setTimeout(120_000);
      for (const [email, steps] of PAGES_2) {
        await signInEmail(page, email);
        for (const [where, go] of steps) {
          await go(page);
          await setTheme(page, theme);
          const r = await new AxeBuilder({ page }).analyze();
          expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${where} ${v.id}: ${v.nodes.length}`)).toEqual([]);
        }
      }
    });
  }
  test('phone: timesheet pages and dialogs have no horizontal overflow at 390px', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [email, steps] of PAGES_2) {
      await signInEmail(page, email);
      for (const [where, go] of steps) {
        await go(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true);
      }
    }
  });
});

/* Module 3's pages on the social seed, where Rota is on: Team rota (the week
   grid, its day view and the Add a shift dialog), Shift catalogue, Working
   patterns with its editor, and Cover requests for Rachel Hussain; My shifts
   and My timesheet's day with the rota banner for Amara Okafor; Rota setup
   with its upload dialog for Dee Fitzgerald. */
const PAGES_3: [string, Step[]][] = [
  [RACHEL, [
    ['/team/trota', open('/team/trota', tid.trota.dayview)],
    ['add a shift dialog', click(tid.trota.add('CP-1402', 4), tid.trota.sugTip)],
    ['/team/tshifts', async page => { await escape(page); await open('/team/tshifts', tid.tshifts.catalogue)(page); }],
    ['/team/tpat', open('/team/tpat', tid.tpat.list)],
    ['pattern editor', click(tid.tpat.open('WP-02'), tid.tpat.editor)],
    ['/team/tcover', async page => { await escape(page); await open('/team/tcover', tid.tcover.stages)(page); await page.getByTestId(tid.tcover.request('cov_2')).waitFor(); }],
  ]],
  [AMARA, [
    ['/work/shifts', open('/work/shifts', tid.shifts.cards)],
    ['/work/ts day with the rota banner', async page => { await open('/work/ts', tid.ts.view('day'))(page); await click(tid.ts.view('day'), tid.ts.banner('rota'))(page); }],
  ]],
  [DEE, [
    ['/setup/mrota', async page => { await open('/setup/mrota', tid.mrota.card('staffing'))(page); await page.getByTestId(tid.tshifts.catalogue).waitFor(); await page.getByTestId(tid.mrota.patterns).waitFor(); }],
    ['pattern upload dialog', click(tid.patUpload.open, tid.patUpload.import)],
  ]],
];
test.describe('module 3 pages', () => {
  test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
  const serious = async (page: Page, where: string, theme: 'light' | 'dark') => {
    await setTheme(page, theme);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${where} ${v.id}: ${v.nodes.length}`)).toEqual([]);
  };
  for (const theme of ['light', 'dark'] as const) {
    test(`axe: rota pages and dialogs have no serious issues (${theme})`, async ({ page }) => {
      test.setTimeout(150_000);
      for (const [email, steps] of PAGES_3) {
        await signInEmail(page, email);
        for (const [where, go] of steps) {
          await go(page);
          await serious(page, where, theme);
        }
      }
    });
    test(`axe: the rota's day view at 390px has no serious issues (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await signInEmail(page, RACHEL);
      await open('/team/trota', tid.trota.dayview)(page);
      await expect(page.getByTestId(tid.trota.grid)).toBeHidden();
      await serious(page, '/team/trota day view', theme);
    });
  }
  test('phone: rota pages and dialogs have no horizontal overflow at 390px', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [email, steps] of PAGES_3) {
      await signInEmail(page, email);
      /* a phone has the day view, not the grid, so no empty cell to add a shift on */
      for (const [where, go] of steps.filter(([w]) => w !== 'add a shift dialog')) {
        await go(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true);
      }
    }
  });
});

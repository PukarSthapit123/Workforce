import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { BIGYAN, EDDIE, PUKAR, signInEmail } from './support/timesheet';
import { AMARA, DEE, RACHEL } from './support/rota';
import { forgetClock, london } from './support/clock';
import { TOM, completeMine } from './support/onboarding';
import { CLOCK_STATUS } from '../src/domain/clock';
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

/* Module 4's pages on the social seed, where Leave, Rota and every LV_* flag
   are on: My leave with its request and entitlement dialogs for Amara Okafor;
   Team leave (with the escalated banner) with its decline, entitlement and
   pro-rata simulation dialogs, and Sickness with its give-back dialog, for
   Rachel Hussain; Leave setup for Dee Fitzgerald. */
const PAGES_4: [string, Step[]][] = [
  [AMARA, [
    ['/work/leave', open('/work/leave', tid.leave.cards)],
    ['request dialog', click(tid.leave.requestOpen, tid.leave.send)],
    ['entitlement dialog', async page => { await escape(page); await click(tid.leave.entShow, tid.leave.entRemaining)(page); }],
  ]],
  [RACHEL, [
    ['/team/tleave', async page => { await open('/team/tleave', tid.tleave.balances)(page); await page.getByTestId(tid.tleave.card('lr_1')).waitFor(); }],
    ['decline dialog', click(tid.tleave.decline('lr_1'), tid.tleave.reason)],
    ['colleague entitlement dialog', async page => { await escape(page); await click(tid.tleave.ent('CP-1042'), tid.leave.entRemaining)(page); }],
    ['simulation dialog', click(tid.leave.simulate, tid.leave.simAfter)],
    ['/team/tsick', open('/team/tsick', tid.tsick.table)],
    ['give-back dialog', click(tid.tsick.giveBack, tid.tsick.gbConfirm)],
  ]],
  [DEE, [
    ['/setup/mleave', async page => { await open('/setup/mleave', tid.mleave.card('rota'))(page); await page.getByTestId(tid.mleave.leavers).waitFor(); }],
  ]],
];
test.describe('module 4 pages', () => {
  test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
  for (const theme of ['light', 'dark'] as const) {
    test(`axe: leave pages and dialogs have no serious issues (${theme})`, async ({ page }) => {
      test.setTimeout(150_000);
      for (const [email, steps] of PAGES_4) {
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
  test('phone: leave pages and dialogs have no horizontal overflow at 390px', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [email, steps] of PAGES_4) {
      await signInEmail(page, email);
      for (const [where, go] of steps) {
        await go(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true);
      }
    }
  });
});

/* 1c's pages on the social seed, each with its dialogs: Organisation with
   the template apply preview, the save dialog, a file imported and the remove
   confirm; Calendar and saved data with the reset confirm; Modules & features
   (the list, and Rota's drill-in with its impact confirm); Notifications;
   Approvals with the chain and delegation editors; the Rename roles dialog
   and a guide on Permissions, for Dee Fitzgerald. Team Home, team Notices
   with the notice editor, tracker and withdraw dialog, the inbox panel and
   the page-unavailable page for Rachel Hussain. My home with its day dialog,
   Notices with the read dialog, and Documents for Amara Okafor. */
const TEMPLATE_FILE = JSON.stringify({ kind: 'qnipay.template', v: 1, key: 'tpl_x', template: {
  name: 'From a file', description: 'Brought in', scope: 'config', modules: { R: true }, flags: {}, extras: {}, labels: {}, employeeTypes: [] } });
const PAGES_1C: [string, Step[]][] = [
  [DEE, [
    ['/setup/aorg', async page => { await open('/setup/aorg', tid.aorg.spine)(page); await page.getByTestId(tid.aorg.noSaved).waitFor(); }],
    ['template apply dialog', click(tid.aorg.template('mne'), tid.aorg.plan('changes'))],
    ['template save dialog', async page => { await escape(page); await click(tid.aorg.saveOpen, tid.aorg.saveName)(page); }],
    ['template imported', async page => {
      await escape(page);
      await page.getByTestId(tid.aorg.importFile).setInputFiles({ name: 'from-a-file.json', mimeType: 'application/json', buffer: Buffer.from(TEMPLATE_FILE) });
      await page.getByTestId(tid.aorg.savedRow('tpl_from_a_file')).waitFor();
    }],
    ['template remove confirm', click(tid.aorg.remove('tpl_from_a_file'), tid.modal.confirm)],
    ['/setup/acal', async page => { await escape(page); await open('/setup/acal', tid.acal.card('saved'))(page); await page.getByTestId(tid.acal.holidays).waitFor(); }],
    ['saved data reset confirm', click(tid.acal.reset, tid.modal.confirm)],
    ['/setup/amods', async page => { await escape(page); await open('/setup/amods', tid.amods.card('TS'))(page); }],
    ['/setup/amods?m=R', open('/setup/amods?m=R', tid.amods.features)],
    ['module impact confirm', click(tid.amods.mod('R'), tid.modal.confirm)],
    ['/setup/anotif', async page => { await escape(page); await open('/setup/anotif', tid.anotif.table)(page); }],
    ['/setup/aappr', async page => { await open('/setup/aappr', tid.aappr.chainTable)(page); await page.getByTestId(tid.aappr.delegTable).waitFor(); }],
    ['chain editor', click(tid.aappr.edit('Leave'), tid.aappr.chainSave)],
    ['delegation editor', async page => { await escape(page); await click(tid.aappr.delegAdd, tid.aappr.delegSave)(page); }],
    ['rename roles dialog', async page => { await escape(page); await open('/setup/aperm', tid.access.table)(page); await click(tid.roleNames.open, tid.roleNames.save)(page); }],
    ['a guide dialog', async page => { await escape(page); await click(tid.guide.open('aperm'), tid.guide.close)(page); }],
  ]],
  [RACHEL, [
    ['/team/thome', async page => { await escape(page); await open('/team/thome', tid.thome.grid)(page); }],
    ['/team/tnotices', open('/team/tnotices', tid.tnotices.table)],
    ['notice editor', click(tid.tnotices.add, tid.tnotices.title)],
    ['notice tracker', async page => { await escape(page); await click(tid.tnotices.open('NTC-0002'), tid.tnotices.trackBody)(page); }],
    ['notice withdraw dialog', click(tid.tnotices.trackWithdraw, tid.tnotices.reason)],
    ['inbox panel', async page => { await escape(page); await click(tid.shell.bell, tid.inbox.item('ntf_seed_0006'))(page); }],
    ['page unavailable', async page => { await page.keyboard.press('Escape'); await open('/team/no-such-page', tid.unavailable.root)(page); }],
  ]],
  [AMARA, [
    ['/work/home', async page => { await open('/work/home', tid.home.grid)(page); await page.getByTestId(tid.noticeHome.card).waitFor(); }],
    ['home day dialog', click(tid.home.day('2026-08-13'), tid.home.dayClose)],
    ['/work/notices', async page => { await escape(page); await open('/work/notices', tid.notices.table)(page); }],
    ['notice read dialog', click(tid.notices.read('NTC-0002'), tid.notices.readAck)],
    ['/work/docs', async page => { await escape(page); await open('/work/docs', tid.docs.card)(page); }],
  ]],
];
test.describe('1c pages', () => {
  test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
  const serious = async (page: Page, where: string, theme: 'light' | 'dark') => {
    await setTheme(page, theme);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${where} ${v.id}: ${v.nodes.length}`)).toEqual([]);
  };
  for (const theme of ['light', 'dark'] as const) {
    test(`axe: 1c pages and dialogs have no serious issues (${theme})`, async ({ page }) => {
      test.setTimeout(240_000);
      for (const [email, steps] of PAGES_1C) {
        await signInEmail(page, email);
        for (const [where, go] of steps) {
          await go(page);
          await serious(page, where, theme);
        }
      }
    });
    /* the phone's Go to sheet behind More exists only below the md breakpoint */
    test(`axe: My home and the Go to sheet at 390px have no serious issues (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await signInEmail(page, AMARA);
      await open('/work/home', tid.home.grid)(page);
      await serious(page, '/work/home at 390px', theme);
      await click(tid.nav.more, tid.nav.goToList)(page);
      await serious(page, 'Go to sheet', theme);
    });
  }
  test('phone: 1c pages and dialogs have no horizontal overflow at 390px', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fits = async (where: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true);
    for (const [email, steps] of PAGES_1C) {
      await signInEmail(page, email);
      for (const [where, go] of steps) {
        await go(page);
        await fits(where);
      }
    }
    await click(tid.nav.more, tid.nav.goToList)(page);
    await fits('Go to sheet');
  });
});
/* Module 2b: the clock card on My timesheet's day view in each of its states,
   and the banner for a clock left running on an earlier day. Amara Okafor
   enters by clock on social; the server clock moves the shift on. */
test.describe('clock', () => {
  test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
  type ClockApi = Parameters<typeof forgetClock>[1];
  /* through every state of the card, calling `at` with a name for each */
  async function walkTheClock(page: Page, api: ClockApi, at: (where: string) => Promise<void>) {
    const status = page.getByTestId(tid.clock.status);
    await signInEmail(page, AMARA);
    await forgetClock(page, api, '2026-08-11', '06:55', FROZEN);
    await page.goto('/work/ts');
    await page.getByTestId(tid.clock.forgotten).waitFor();
    await expect(status).toHaveText(CLOCK_STATUS.idle);
    await at('the forgotten clock banner, the card idle');
    await page.getByTestId(tid.clock.finish).fill('15:00');
    await page.getByTestId(tid.clock.close).click();
    await expect(page.getByTestId(tid.clock.forgotten)).toHaveCount(0);
    await page.getByTestId(tid.clock.clockIn).click();
    await expect(status).toHaveText(CLOCK_STATUS.running);
    await at('the card running');
    await api.setClock(london('16:00'));
    await page.getByTestId(tid.clock.breakStart).click();
    await expect(status).toHaveText(CLOCK_STATUS.onBreak);
    await at('the card on a break');
    await api.setClock(london('18:00'));
    await page.getByTestId(tid.clock.clockOut).click();
    await expect(status).toHaveText(CLOCK_STATUS.clockedOut);
    await at('the card clocked out');
  }
  for (const theme of ['light', 'dark'] as const) {
    test(`axe: the clock card in every state and the forgotten clock banner have no serious issues (${theme})`, async ({ page, api }) => {
      test.setTimeout(90_000);
      await walkTheClock(page, api, async where => {
        await setTheme(page, theme);
        const r = await new AxeBuilder({ page }).analyze();
        expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${where} ${v.id}: ${v.nodes.length}`)).toEqual([]);
      });
    });
  }
  /* MOBILE-FOUNDATION#31: below md the card stacks (P's 1243-1249) and nothing scrolls sideways */
  test('phone: the clock card stacks and nothing overflows at 390px in any state', async ({ page, api }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await walkTheClock(page, api, async where => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true);
      const card = page.getByTestId(tid.clock.card);
      expect(await card.evaluate(e => getComputedStyle(e).flexDirection), where).toBe('column');
      const box = await card.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 390, `${where}: the card within the screen`).toBe(true);
    });
  });
});

/* Module 5 on the qnipay seed, where Onboarding and every ONB_* feature are
   on: Tom Achterberg's portal on its personal, documents, policies and review
   steps, with a policy's read dialog, then (once he has sent everything) his
   submitted page; Team onboarding for Pukar Sthapit with the check dialog,
   the not-ready dialog and Add a new starter; Onboarding setup for Eddie
   Harford with the add-policy dialog and the remove confirm. */
const pages5 = (api: Parameters<typeof completeMine>[1]): [string, Step[]][] => [
  [TOM, [
    ['/work/onb personal', open('/work/onb', tid.onb.body('personal'))],
    ['documents step', click(tid.onb.step('documents'), tid.onb.docs)],
    ['policies step', click(tid.onb.step('policies'), tid.onb.polCount)],
    ['policy read dialog', click(tid.onb.polRead('pol_conduct'), tid.onb.readBody)],
    ['review step', async page => { await escape(page); await click(tid.onb.step('review'), tid.onb.todo)(page); }],
    ['submitted page', async page => { await completeMine(page, api); await open('/work/onb', tid.onb.submitted)(page); }],
  ]],
  [PUKAR, [
    ['/team/tonb', async page => { await open('/team/tonb', tid.tonb.queue)(page); await page.getByTestId(tid.tonb.table).waitFor(); }],
    ['check dialog', click(tid.tonb.check('EMP003', 'rtw'), tid.tonb.reason)],
    ['not-ready dialog', async page => { await escape(page); await click(tid.tonb.start('EMP003'), tid.tonb.notReady)(page); }],
    ['add a new starter', async page => { await escape(page); await click(tid.tonb.add, tid.personForm.root)(page); }],
  ]],
  [EDDIE, [
    ['/setup/monb', async page => { await open('/setup/monb', tid.monb.card('steps'))(page); await page.getByTestId(tid.monb.policies).waitFor(); }],
    ['add policy dialog', click(tid.monb.polAdd, tid.monb.polName)],
    ['remove policy confirm', async page => { await escape(page); await click(tid.monb.polRemove('pol_itsec'), tid.modal.root)(page); }],
  ]],
];
test.describe('module 5 pages', () => {
  test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
  for (const theme of ['light', 'dark'] as const) {
    test(`axe: onboarding pages and dialogs have no serious issues (${theme})`, async ({ page, api }) => {
      test.setTimeout(150_000);
      for (const [email, steps] of pages5(api)) {
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
  test('phone: onboarding pages and dialogs have no horizontal overflow at 390px', async ({ page, api }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [email, steps] of pages5(api)) {
      await signInEmail(page, email);
      for (const [where, go] of steps) {
        await go(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true);
      }
    }
  });
});

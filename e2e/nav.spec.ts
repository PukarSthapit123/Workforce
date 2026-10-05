import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

test('NV Manager navigation has two primary areas', async ({ page, signInAs }) => {
  await signInAs('manager');
  await expect(page.getByTestId(tid.nav.group('work'))).toBeVisible();
  await expect(page.getByTestId(tid.nav.group('team'))).toBeVisible();
  await expect(page.getByTestId(tid.nav.group('setup'))).toHaveCount(0);
});
test('NV A view from a later sub-project says so and names it', async ({ page, signInAs }) => {
  await signInAs('employee');
  await page.getByTestId(tid.nav.tab('hours')).click();
  await expect(page.getByTestId(tid.notBuilt.subProject)).toHaveText('Timesheet');
});

/* Shared by every traversal test below: after any navigation, exactly one
   page-<view> container is present, no test id is duplicated anywhere on the
   page, and every button/link/input/select/textarea inside <main> carries
   one. */
const checkCurrentPage = async (page: import('@playwright/test').Page) => {
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(1);
  const result = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid'));
    const missing = [...document.querySelectorAll('main button, main a[href], main input, main select, main textarea')]
      .filter(e => !e.getAttribute('data-testid')).length;
    return { dup: ids.filter((x, i) => ids.indexOf(x) !== i), missing };
  });
  expect(result).toEqual({ dup: [], missing: 0 });
};

/* Visits every page an admin can reach: every plain tab in the strip, every
   item inside every grouped dropdown menu, and (setup being sectioned, not
   one flat strip) every section card from the index plus every page inside
   each section. Each page it lands on must carry its own page-<view>
   container and full test id coverage: no duplicate test id anywhere on the
   page, and no untagged button/link/input/select/textarea inside <main>. */
test('NV Every page an admin can reach has full test id coverage', async ({ page, signInAs }) => {
  test.setTimeout(60_000);
  await signInAs('admin');

  const stripTab = (excludeTestId?: string) =>
    excludeTestId
      ? `nav[aria-label="Pages"] a[data-testid^="nav-tab-"]:not([data-testid="${excludeTestId}"])`
      : 'nav[aria-label="Pages"] a[data-testid^="nav-tab-"]';

  const visitPlainTabs = async (excludeTestId?: string) => {
    const sel = stripTab(excludeTestId);
    const count = await page.locator(sel).count();
    for (let i = 0; i < count; i++) { await page.locator(sel).nth(i).click(); await checkCurrentPage(page); }
  };

  const visitMenus = async () => {
    const menuSel = '[data-testid^="nav-menu-"]';
    const itemSel = '[role="menuitem"] a[data-testid^="nav-tab-"]';
    const menuCount = await page.locator(menuSel).count();
    for (let m = 0; m < menuCount; m++) {
      await page.locator(menuSel).nth(m).click(); // open once, just to read how many items it has
      const itemCount = await page.locator(itemSel).count();
      await page.keyboard.press('Escape'); // close it: the loop below always starts from closed
      for (let i = 0; i < itemCount; i++) {
        await page.locator(menuSel).nth(m).click(); // each selection closes the menu; reopen for the next item
        await page.locator(itemSel).nth(i).click();
        await checkCurrentPage(page);
      }
    }
  };

  for (const g of ['work', 'team', 'setup']) {
    const group = page.getByTestId(tid.nav.group(g));
    if (!(await group.count())) continue;
    await group.click();
    await checkCurrentPage(page);

    if (g === 'setup') {
      const cardSel = '[data-testid^="setup-card-"]';
      const cardCount = await page.locator(cardSel).count();
      for (let c = 0; c < cardCount; c++) {
        await page.locator(cardSel).nth(c).click(); // -> the section's first page
        await checkCurrentPage(page);
        await visitPlainTabs(tid.nav.tab('asetup')); // the rest of that section, excluding "‹ All setup"
        await page.getByTestId(tid.nav.tab('asetup')).click(); // back to the index for the next section
        await checkCurrentPage(page);
      }
    } else {
      await visitPlainTabs();
      await visitMenus();
    }
  }
});

/* Spec §10.3: no horizontal overflow, touch targets at least 44px. Ported
   from the prototype's phone breakpoint (qnipay-workforce-v15.html:1552-1582,
   791-818): brand name and role pill hidden, the tab strip hidden in favour
   of the bottom bar, everything on one line that fits. */
test('NV At 390px the header and bottom bar fit with no horizontal overflow and 44px touch targets', async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs('admin');

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);

  const heights = await page.evaluate(() => {
    const els = [...document.querySelectorAll('header button, header a[href], nav[aria-label="Quick pages"] button, nav[aria-label="Quick pages"] a[href]')]
      .filter(e => (e as HTMLElement).offsetParent !== null); // visible only
    return els.map(e => e.getBoundingClientRect().height);
  });
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
});

/* A phone has no tab strip (hidden below md) and at most five bottom-bar
   destinations plus More. My Team (manager) and every setup section but
   Organisation (admin) have more than five pages, so this reaches every one
   of them using only the bottom bar and More's dialog, never the strip. For
   setup, the bottom bar follows stripTabsFor's current section (Shell.tsx),
   so entering a section still means a card on SetupIndex, exactly as on
   desktop; from there it is bottom bar and More alone. */
test('NV At 390px every destination is reachable from the bottom bar and More alone, for admin and manager', async ({ page, signInAs }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const directSel = (excludeTestId?: string) =>
    excludeTestId
      ? `nav[aria-label="Quick pages"] > a[data-testid^="nav-bottom-"]:not([data-testid="${excludeTestId}"])`
      : 'nav[aria-label="Quick pages"] > a[data-testid^="nav-bottom-"]';
  const moreButton = () => page.getByTestId(tid.nav.more);
  /* Go to lists every page of the strip; the way back to the setup index is left out, as it is from the bar walk */
  const moreItemSel = `[data-testid="${tid.modal.root}"] a[data-testid^="nav-goto-"]:not([data-testid="${tid.nav.goTo('asetup')}"])`;

  const visitBottomBar = async (excludeTestId?: string) => {
    const sel = directSel(excludeTestId);
    const count = await page.locator(sel).count();
    for (let i = 0; i < count; i++) { await page.locator(sel).nth(i).click(); await checkCurrentPage(page); }

    if (await moreButton().count()) {
      await moreButton().click();
      const itemCount = await page.locator(moreItemSel).count();
      for (let i = 0; i < itemCount; i++) {
        if (i > 0) await moreButton().click(); // selecting one closes the dialog; reopen for the next
        await page.locator(moreItemSel).nth(i).click();
        await checkCurrentPage(page);
      }
    }
  };

  for (const persona of ['admin', 'manager'] as const) {
    await signInAs(persona);
    for (const g of ['work', 'team', 'setup']) {
      const group = page.getByTestId(tid.nav.group(g));
      if (!(await group.count())) continue;
      await group.click();
      await checkCurrentPage(page);

      if (g === 'setup') {
        const cardSel = '[data-testid^="setup-card-"]';
        const cardCount = await page.locator(cardSel).count();
        for (let c = 0; c < cardCount; c++) {
          await page.locator(cardSel).nth(c).click(); // -> the section's first page; no bottom bar at the index itself
          await checkCurrentPage(page);
          await visitBottomBar(tid.nav.bottom('asetup')); // the rest of that section, excluding "‹ All setup"
          await page.getByTestId(tid.nav.group('setup')).click(); // back to the index for the next section
          await checkCurrentPage(page);
        }
      } else {
        await visitBottomBar();
      }
    }
  }
});

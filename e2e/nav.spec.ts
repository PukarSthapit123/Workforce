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
  await page.getByTestId(tid.nav.tab('ts')).click();
  await expect(page.getByTestId(tid.notBuilt.subProject)).toHaveText('Timesheet');
});

/* Visits every page an admin can reach: every plain tab in the strip, every
   item inside every grouped dropdown menu, and (setup being sectioned, not
   one flat strip) every section card from the index plus every page inside
   each section. Each page it lands on must carry its own page-<view>
   container and full test id coverage: no duplicate test id anywhere on the
   page, and no untagged button/link/input/select/textarea inside <main>. */
test('NV Every page an admin can reach has full test id coverage', async ({ page, signInAs }) => {
  test.setTimeout(60_000);
  await signInAs('admin');

  const checkCurrentPage = async () => {
    await expect(page.locator('[data-testid^="page-"]')).toHaveCount(1);
    const result = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid'));
      const missing = [...document.querySelectorAll('main button, main a[href], main input, main select, main textarea')]
        .filter(e => !e.getAttribute('data-testid')).length;
      return { dup: ids.filter((x, i) => ids.indexOf(x) !== i), missing };
    });
    expect(result).toEqual({ dup: [], missing: 0 });
  };

  const stripTab = (excludeTestId?: string) =>
    excludeTestId
      ? `nav[aria-label="Pages"] a[data-testid^="nav-tab-"]:not([data-testid="${excludeTestId}"])`
      : 'nav[aria-label="Pages"] a[data-testid^="nav-tab-"]';

  const visitPlainTabs = async (excludeTestId?: string) => {
    const sel = stripTab(excludeTestId);
    const count = await page.locator(sel).count();
    for (let i = 0; i < count; i++) { await page.locator(sel).nth(i).click(); await checkCurrentPage(); }
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
        await checkCurrentPage();
      }
    }
  };

  for (const g of ['work', 'team', 'setup']) {
    const group = page.getByTestId(tid.nav.group(g));
    if (!(await group.count())) continue;
    await group.click();
    await checkCurrentPage();

    if (g === 'setup') {
      const cardSel = '[data-testid^="setup-card-"]';
      const cardCount = await page.locator(cardSel).count();
      for (let c = 0; c < cardCount; c++) {
        await page.locator(cardSel).nth(c).click(); // -> the section's first page
        await checkCurrentPage();
        await visitPlainTabs(tid.nav.tab('asetup')); // the rest of that section, excluding "‹ All setup"
        await page.getByTestId(tid.nav.tab('asetup')).click(); // back to the index for the next section
        await checkCurrentPage();
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

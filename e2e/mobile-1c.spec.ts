import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

/* MOBILE FOUNDATION and REVIEW RUN, the rows only a real browser at phone
   width can answer (390 x 844, an iPhone 14): the CSS each rule depends on is
   checked through what the browser computes, not through class names. */
const PHONE = { width: 390, height: 844 };
test.beforeEach(async ({ page }) => { await page.setViewportSize(PHONE); });

/* every style rule the page has, @media and @layer blocks opened */
const rulesMatching = (page: Page, selector: string, needle: string) => page.evaluate(([sel, text]) => {
  const el = document.querySelector(sel);
  const out: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule && r.style.cssText.includes(text) && el?.matches(r.selectorText)) out.push(r.cssText);
      if ('cssRules' in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
    }
  };
  for (const s of Array.from(document.styleSheets)) { try { walk(s.cssRules); } catch { /* a sheet from elsewhere */ } }
  return out;
}, [selector, needle] as const);

test('MOB a viewport is declared, the tab strip gives way to the bottom bar, the area switcher scrolls, and the bar keeps clear of the home indicator', async ({ page, signInAs }) => {
  await signInAs('employee');
  await page.goto('/work/home');
  await page.getByTestId(tid.home.grid).waitFor();
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  await expect(page.getByRole('navigation', { name: 'Pages', exact: true })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Quick pages' })).toBeVisible();
  const areas = page.getByRole('navigation', { name: 'Areas' });
  await expect(areas).toHaveCSS('overflow-x', 'auto');
  await expect(areas).toHaveCSS('flex-wrap', 'nowrap');
  expect(await rulesMatching(page, 'nav[aria-label="Quick pages"]', 'safe-area-inset-bottom')).not.toEqual([]);
});

test('MOB a dialog becomes a bottom sheet, full width, its foot clear of the home indicator', async ({ page, signInAs }) => {
  await signInAs('employee');
  await page.goto('/work/home');
  await page.getByTestId(tid.nav.more).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(400); // the sheet's entrance
  const box = await sheet.boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.width).toBe(PHONE.width);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(PHONE.height);
});

test('MOB a switch keeps its shape and gains a 44px hit area; a grown button grows its padding too', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/amods?m=TS');
  const sw = page.getByTestId(tid.amods.flag('LATE_FINISH'));
  await expect(sw).toBeVisible();
  const box = await sw.boundingBox();
  expect([box?.width, box?.height]).toEqual([40, 23]);
  const hit = await sw.evaluate(el => { const s = getComputedStyle(el, '::before'); return [s.width, s.height, s.position]; });
  expect(hit).toEqual(['44px', '44px', 'absolute']);
  await page.goto('/setup/aperm');
  const rename = page.getByTestId(tid.roleNames.open);
  await expect(rename).toHaveCSS('min-height', '44px');
  await expect(rename).toHaveCSS('padding-left', '14px');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(rename).toHaveCSS('padding-left', '11px');
});

test('MOB every input, select and text box is 16px on a phone, so iOS does not zoom on focus', async ({ page, signInAs }) => {
  await signInAs('admin');
  const sizes: Record<string, string[]> = {};
  for (const [path, ready] of [['/setup/apeople', tid.people.table], ['/setup/aorg', tid.aorg.spine], ['/setup/amods?m=TS', tid.amods.features],
    ['/setup/mleave', tid.mleave.card('rota')]] as const) {
    await page.goto(path);
    await page.getByTestId(ready).waitFor();
    sizes[path] = await page.locator('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, textarea, [data-slot="select-trigger"]')
      .evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null).map(e => `${e.getAttribute('data-testid') ?? e.tagName}:${getComputedStyle(e).fontSize}`));
  }
  for (const [path, list] of Object.entries(sizes)) {
    expect(list.length, path).toBeGreaterThan(0);
    expect(list.filter(s => !s.endsWith(':16px')), path).toEqual([]);
  }
});

test('MOB a table pins its first column, a matrix keeps scrolling, and a record list keeps its headers for screen readers', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  const matrix = page.getByTestId(tid.access.table);
  await matrix.waitFor();
  await expect(matrix.locator('tbody td').first()).toHaveCSS('position', 'sticky');
  const scrolls = await matrix.evaluate(t => { const w = t.parentElement; return w ? w.scrollWidth > w.clientWidth : false; });
  expect(scrolls).toBe(true);
  await expect(matrix.locator('thead')).toBeVisible();

  const people = page.getByTestId(tid.access.usersTable);
  await expect(people.locator('thead')).toHaveCSS('position', 'absolute');
  await expect(people.locator('thead')).toHaveCSS('width', '1px');
  await expect(people.getByRole('columnheader', { name: 'Employee ID' })).toBeAttached();
  await expect(people.locator('tbody td[data-l="Employee ID"]').first()).toBeVisible();

  await page.goto('/setup/mleave');
  const plain = page.locator('[data-slot="table"][data-variant="plain"]').first();
  await plain.waitFor();
  await expect(plain.locator('tbody td').first()).toHaveCSS('position', 'sticky');
  await expect(plain.locator('thead th').first()).toHaveCSS('position', 'sticky');
  const even = await plain.locator('tbody tr:nth-child(2)').evaluate(tr => {
    const first = tr.querySelector('td');
    return [getComputedStyle(tr).backgroundColor, first ? getComputedStyle(first).backgroundColor : ''];
  });
  expect(even[1]).toBe(even[0]);
});

/* moved to the rota area (D15) */
test('MOB the rota week grid gives way to the day view on a phone, and says why', async ({ page, signInAs }) => {
  await signInAs('manager');
  await page.goto('/team/trota');
  await page.getByTestId(tid.trota.dayview).waitFor();
  await expect(page.getByTestId(tid.trota.grid)).toBeHidden();
  await expect(page.getByTestId(tid.trota.dayview)).toBeVisible();
  await expect(page.getByText('A week grid needs more width than a phone has, so this is the day view.')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId(tid.trota.grid)).toBeVisible();
  await expect(page.getByText('A week grid needs more width than a phone has, so this is the day view.')).toBeHidden();
});

test('MOB the employee cards are one column flow: one column on a phone, several on a desktop', async ({ page, signInAs }) => {
  await signInAs('employee');
  await page.goto('/work/shifts');
  const cards = page.getByTestId(tid.shifts.cards);
  await cards.waitFor();
  const lefts = () => cards.evaluate(c => [...new Set(Array.from(c.children).map(k => Math.round(k.getBoundingClientRect().left)))]);
  expect(await cards.evaluate(c => c.children.length)).toBeGreaterThan(1);
  expect(await lefts()).toHaveLength(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await lefts()).length).toBeGreaterThan(1);
});

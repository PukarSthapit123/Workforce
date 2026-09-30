import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

/* Generic interface rules from the prototype suite, checked on every page
   this build has actually built. Each test names the trace rows it ports. */
const BUILT = ['/setup/asetup', '/setup/aperm', '/setup/iaudit', '/setup/apeople', '/setup/aloc', '/setup/aloc?d=locations', '/setup/acon', '/setup/atypes'];
const READY: Record<string, string> = { '/setup/asetup': tid.page('asetup'), '/setup/aperm': tid.access.table, '/setup/iaudit': tid.page('iaudit'),
  '/setup/apeople': tid.people.table, '/setup/aloc': tid.dims.card('locations'), '/setup/aloc?d=locations': tid.dims.table,
  '/setup/acon': tid.contracts.table, '/setup/atypes': tid.types.detail };

async function eachBuiltPage(page: Page, check: (path: string) => Promise<void>) {
  await check('sign-in');
  for (const path of BUILT) {
    await page.goto(path);
    await page.getByTestId(READY[path] ?? tid.page('none')).waitFor();
    await check(path);
  }
}

/* GUIDE AFFORDANCE #5 "No ? appears where no guide is registered" and #6
   "Admin pages without a guide show no ?". No built page registers a guide
   yet, so none may show a hollow ?. */
test('G No built page shows a ? guide button, since none registers a guide', async ({ page, signInAs }) => {
  const helpButtons = () => page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === '?' || b.hasAttribute('data-guide')).length);
  await page.getByTestId(tid.signIn.form).waitFor();
  expect(await helpButtons()).toBe(0);
  await signInAs('admin');
  await eachBuiltPage(page, async path => { if (path !== 'sign-in') expect(await helpButtons(), path).toBe(0); });
});

/* ICONS, CRUMBS AND REDUNDANT COUNTS #2 "They come from the shared icon set,
   not emoji" and #3 "Every card in the system uses the icon set, no emoji
   left". */
test('IC Icons come from the shared icon set, and no built page renders an emoji', async ({ page, signInAs }) => {
  const emoji = () => page.evaluate(() => (document.body.innerText.match(/\p{Extended_Pictographic}/gu) ?? []).join(''));
  await page.getByTestId(tid.signIn.form).waitFor();
  expect(await emoji(), 'sign-in').toBe('');
  await signInAs('admin');
  await expect(page.getByTestId(tid.shell.bell).locator('svg.lucide')).toHaveCount(1);
  await eachBuiltPage(page, async path => { expect(await emoji(), path).toBe(''); });
  await page.goto('/setup/aperm');
  await expect(page.getByTestId(tid.access.caution).locator('svg.lucide')).toHaveCount(1);
});

/* SECTION LABELS ARE NOT SHOUTED #1 "Section labels are sentence case, not
   all capitals" and #3 "Form and menu labels follow". The prototype's own
   check (qnipay-regression-suite.js:3129-3139) is narrower than "no capitals
   anywhere": its section labels (.wtsub) are sentence case with no tracking,
   and capitals survive only on a short list of rules, the column headers
   (th), the role pill and the small badges among them. So: no heading, form
   label or section label is in capitals or wide tracking, and the only
   elements in capitals are table column headers and elements that declare
   themselves a capitals badge (data-caps: the role pill, a scope badge, the
   required marker). Checked on every built page, the account menu and the
   exceptions dialog. */
test('SL Nothing on a built page, its menu or its dialog, is set in capitals or wide tracking', async ({ page, api, signInAs }) => {
  const shouted = () => page.evaluate(() => [...document.body.querySelectorAll('*')].filter(el => {
    if (!(el as HTMLElement).innerText?.trim()) return false;
    const cs = getComputedStyle(el);
    const spacing = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize);
    const label = el.matches('h1, h2, h3, h4, h5, h6, label, legend');
    if (label) return cs.textTransform === 'uppercase' || spacing > 0.05;
    return cs.textTransform === 'uppercase' && !el.closest('th, [data-caps]');
  }).map(el => `${el.tagName.toLowerCase()} "${(el as HTMLElement).innerText.slice(0, 30)}"`));
  await page.getByTestId(tid.signIn.form).waitFor();
  expect(await shouted(), 'sign-in').toEqual([]);
  await signInAs('admin');
  await eachBuiltPage(page, async path => { expect(await shouted(), path).toEqual([]); });
  await page.getByTestId(tid.shell.account).click();
  await page.getByTestId(tid.shell.menuAccount).waitFor();
  expect(await shouted(), 'account menu').toEqual([]);
  await page.keyboard.press('Escape');
  await page.goto('/setup/aperm');
  await page.getByTestId(tid.access.table).waitFor(); // the worker is answering again after the navigation
  const users = (await api.get('/api/v1/users')).body as { email: string; userType: string }[];
  const emp = users.find(u => u.userType === 'employee');
  if (!emp) throw new Error('no seeded employee');
  await page.getByTestId(tid.access.exceptionAdd(emp.email)).click();
  await page.getByTestId(tid.modal.root).waitFor();
  expect(await shouted(), 'exceptions dialog').toEqual([]);
});

/* CONTROLS LOOK LIKE THEIR NEIGHBOURS #1 "A multi-select is given room and
   the shared border". No built page has one yet, so this places a native
   one on a real page and reads the compiled rule it gets. */
test('CT A multi-select is given room and the shared border', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId(tid.signIn.form).waitFor();
  const style = await page.evaluate(() => {
    const s = document.createElement('select');
    s.multiple = true;
    ['a', 'b', 'c', 'd'].forEach(v => s.add(new Option(v, v)));
    document.body.appendChild(s);
    const cs = getComputedStyle(s);
    const out = { minHeight: parseFloat(cs.minHeight), border: cs.borderTopStyle, radius: parseFloat(cs.borderTopLeftRadius), touch: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--qp-size-touch')) };
    s.remove();
    return out;
  });
  expect(style.minHeight).toBeGreaterThanOrEqual(style.touch * 2);
  expect(style.border).toBe('solid');
  expect(style.radius).toBeGreaterThan(0);
});

/* CONTROLS LOOK LIKE THEIR NEIGHBOURS #5 "A lone card keeps its column
   rather than stretching". The setup index is a fixed-column grid, so with
   only one section left its card stays one column wide. */
test('CT A lone setup card keeps its column rather than stretching', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/asetup');
  const first = page.locator('[data-testid^="setup-card-"]').first();
  await first.waitFor();
  const widths = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('a[data-testid^="setup-card-"]')];
    const grid = cards[0]?.closest('.grid');
    cards.slice(1).forEach(c => c.parentElement?.remove());
    return { card: cards[0]?.getBoundingClientRect().width ?? 0, grid: grid?.getBoundingClientRect().width ?? 0, left: document.querySelectorAll('a[data-testid^="setup-card-"]').length };
  });
  expect(widths.left).toBe(1);
  expect(widths.card).toBeGreaterThan(0);
  expect(widths.card).toBeLessThan(widths.grid / 2);
});

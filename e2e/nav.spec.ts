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
test('NV Every page an admin can reach has full test id coverage', async ({ page, signInAs }) => {
  await signInAs('admin');
  for (const g of ['work', 'team', 'setup']) {
    const group = page.getByTestId(tid.nav.group(g)); if (!(await group.count())) continue;
    await group.click();
    const dupes = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid'));
      const missing = [...document.querySelectorAll('main button, main a[href], main input, main select, main textarea')].filter(e => !e.getAttribute('data-testid')).length;
      return { dup: ids.filter((x, i) => ids.indexOf(x) !== i), missing };
    });
    expect(dupes).toEqual({ dup: [], missing: 0 });
  }
});

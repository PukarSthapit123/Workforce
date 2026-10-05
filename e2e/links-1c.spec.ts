import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { DEE, RACHEL, auditRows, inboxOf, openModule } from './support/config';

/* 1c, the bell's inbox and its deep links (D9) on social. Rachel Hussain has
   five unread items; "Leave approval overdue" opens Team leave. Opening it
   goes there and marks it read, on the server and on the bell. A link to a
   page that does not exist, or to one this person cannot open, lands on the
   page-unavailable page with a way home, never somewhere else quietly. While
   a module is off its items are hidden, not deleted, and not counted. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

test('a notification opens the page it points at and is marked read; an unknown or unreachable address lands on the page-unavailable page', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  const before = await inboxOf(api);
  expect(before.unread).toBe(5);
  await expect(page.getByTestId(tid.shell.bellCount)).toHaveText('5');
  await page.getByTestId(tid.shell.bell).click();
  const item = page.getByTestId(tid.inbox.item('ntf_seed_0006'));
  await expect(item).toContainText('Leave approval overdue');
  await expect(page.getByTestId(tid.inbox.dest('ntf_seed_0006'))).toContainText('Requests');
  await expect(page.getByTestId(tid.inbox.dot('ntf_seed_0006'))).toHaveAttribute('data-unread', 'true');
  await item.click();
  await expect(page).toHaveURL(/\/team\/tleave$/);
  await page.getByTestId(tid.page('tleave')).waitFor();
  await expect(page.getByTestId(tid.inbox.panel)).toHaveCount(0);
  await expect(page.getByTestId(tid.shell.bellCount)).toHaveText('4');
  const after = await inboxOf(api);
  expect([after.unread, after.items.find(n => n.id === 'ntf_seed_0006')?.read]).toEqual([4, true]);
  expect((await auditRows(page, 'notification')).map(a => [a.act, a.entityId])).toEqual([['Notification read', 'ntf_seed_0006']]);

  /* an address no page has */
  await page.goto('/team/no-such-page');
  await expect(page.getByTestId(tid.unavailable.root)).toHaveAttribute('data-known', 'false');
  await expect(page.getByTestId(tid.unavailable.root)).toContainText('There is no page at /team/no-such-page.');
  /* a real page, but not hers */
  await page.goto('/setup/amods');
  await expect(page.getByTestId(tid.unavailable.root)).toHaveAttribute('data-known', 'true');
  await expect(page.getByTestId(tid.unavailable.root)).toContainText('Modules & features is not available to you.');
  await page.getByTestId(tid.unavailable.home).click();
  await expect(page.getByTestId(tid.unavailable.root)).toHaveCount(0);
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(1);
});

test('while Rota is off its notifications are hidden and not counted, then come back unchanged when it is on again', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  const all = await inboxOf(api);
  const rota = all.items.filter(n => n.area === 'Rota');
  expect(rota.length).toBeGreaterThan(0);

  await signInEmail(page, DEE);
  await openModule(page, 'R');
  await page.getByTestId(tid.amods.mod('R')).click();
  await page.getByTestId(tid.modal.confirm).click();
  await expect(page.getByTestId(tid.amods.offBanner)).toBeVisible();

  await signInEmail(page, RACHEL);
  const off = await inboxOf(api);
  expect(off.items.filter(n => n.area === 'Rota')).toEqual([]);
  expect(off.unread).toBe(all.unread - rota.filter(n => !n.read).length);
  await expect(page.getByTestId(tid.shell.bellCount)).toHaveText(String(off.unread));

  await signInEmail(page, DEE);
  await openModule(page, 'R');
  await page.getByTestId(tid.amods.mod('R')).click();
  await expect(page.getByTestId(tid.amods.offBanner)).toHaveCount(0);
  await signInEmail(page, RACHEL);
  expect(await inboxOf(api)).toEqual(all);
});

import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { auditOf } from './support/read';
import { sendVersioned, signInEmail } from './support/timesheet';
import { AMARA, DEE, GRACE, RACHEL, W33, rotaWeek, weekPath } from './support/rota';

/* Module 3 Review Focus 1, straight to the server: a manager cannot read or
   write another location's week, patterns or cover; "Admins only" on Rota
   setup withholds patterns and shift types from a manager whatever the
   permission matrix says, and restoring it gives them back; an employee
   cannot write the rota; and a claim is for an open shift at your own
   location only. Each refusal leaves the rota as it was. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const code = (r: { body: unknown }) => (r.body as { code: string }).code;
const message = (r: { body: unknown }) => (r.body as { message: string }).message;

test('a manager cannot read or write another location’s week, patterns or cover', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  await page.goto('/team/trota');
  await page.getByTestId(tid.trota.grid).waitFor();
  /* only their own location is offered */
  expect(((await api.get('/api/v1/rota/home')).body as { locations: { code: string }[] }).locations.map(l => l.code)).toEqual(['WH']);

  const read = await api.get(weekPath(W33, 'BC'));
  expect([read.status, code(read), message(read)]).toEqual([403, 'scope', 'You can manage the rota at Willow House only.']);
  const write = await sendVersioned(page, 'PUT', `${weekPath(W33, 'BC')}/cells`, 0, { personCode: 'CP-1288', day: 0, code: 'E' });
  expect([write.status, code(write)]).toEqual([403, 'scope']);
  const publish = await sendVersioned(page, 'POST', `${weekPath(W33, 'FS')}/transition`, 1, { to: 'published' });
  expect([publish.status, code(publish)]).toEqual([403, 'scope']);
  const cover = await api.send('POST', '/api/v1/rota/cover', { location: 'BC', date: '2026-08-14', shift: 'E', reason: 'Sickness', urgent: false });
  expect([cover.status, code(cover)]).toEqual([403, 'scope']);

  /* WP-03 runs at Beacon Court and Floating Support, not Willow House */
  const listed = ((await api.get('/api/v1/rota/patterns')).body as { items: { code: string }[] }).items.map(p => p.code);
  expect(listed).not.toContain('WP-03');
  const pat = await sendVersioned(page, 'PATCH', '/api/v1/rota/patterns/WP-03', 1, { name: 'Taken over' });
  expect([pat.status, code(pat)]).toEqual([403, 'scope']);
  const gen = await sendVersioned(page, 'POST', '/api/v1/rota/patterns/WP-03/generate', 1, {});
  expect([gen.status, code(gen)]).toEqual([403, 'scope']);

  /* the admin has no team rota rights in this tenant, so the record of nothing written is the audit log */
  await signInEmail(page, DEE);
  const weekRows = await auditOf(api, 'rotaWeek'), patternRows = await auditOf(api, 'pattern'), coverRows = await auditOf(api, 'coverRequest');
  expect([weekRows, patternRows, coverRows]).toEqual([[], [], []]);
});

test('“Admins only” on Rota setup withholds patterns and shift types from a manager on the server, and restoring it gives them back', async ({ page, api }) => {
  test.setTimeout(90_000);
  const builtBy = async (to: string) => {
    await signInEmail(page, DEE);
    await page.goto('/setup/mrota');
    await page.getByTestId(tid.mrota.card('staffing')).waitFor();
    await page.getByTestId(tid.mrota.builtBy).selectOption(to);
    await page.getByTestId(tid.mrota.save).click();
    await expect(page.getByTestId(tid.toast.info).filter({ hasText: 'Rota setup saved' })).toBeVisible();
  };
  await builtBy('Admins only');
  const saved = await auditOf(api, 'rotaConfig');
  expect(saved[0]).toMatchObject({ before: { rotaBuiltBy: 'Admins and managers' }, after: { rotaBuiltBy: 'Admins only' } });
  /* the policy sits above the permission matrix, which still lists the capability */
  await page.goto('/setup/aperm');
  await expect(page.getByTestId(tid.access.capRow('rota_pattern'))).toBeVisible();

  await signInEmail(page, RACHEL);
  await page.goto('/team/tpat');
  await expect(page.getByTestId(tid.tpat.error)).toContainText('Rota setup says only administrators build working patterns.');
  const list = await api.get('/api/v1/rota/patterns');
  expect([list.status, code(list)]).toEqual([403, 'rota-policy']);
  const gen = await sendVersioned(page, 'POST', '/api/v1/rota/patterns/WP-02/generate', 1, {});
  expect([gen.status, code(gen)]).toEqual([403, 'rota-policy']);
  const add = await api.send('POST', '/api/v1/rota/shift-types', { code: 'T', name: 'Twilight', from: '18:00', to: '23:00', breakMinutes: 0, night: false });
  expect([add.status, code(add), message(add)]).toEqual([403, 'rota-policy', 'Rota setup says only administrators build shift types.']);
  const edit = await sendVersioned(page, 'PATCH', '/api/v1/rota/shift-types/E', 1, { name: 'Morning' });
  expect([edit.status, code(edit)]).toEqual([403, 'rota-policy']);
  /* the manager still runs the rota itself */
  expect((await api.get(weekPath(W33))).status).toBe(200);

  await builtBy('Admins and managers');
  const types = ((await api.get('/api/v1/rota/shift-types')).body as { items: { code: string; name: string }[] }).items;
  expect(types.map(t => [t.code, t.name])).toEqual([['E', 'Early'], ['L', 'Late'], ['N', 'Night']]);
  expect(await auditOf(api, 'pattern')).toEqual([]);

  await signInEmail(page, RACHEL);
  expect((await api.get('/api/v1/rota/patterns')).status).toBe(200);
  await page.goto('/team/tpat');
  await expect(page.getByTestId(tid.tpat.row('WP-02'))).toBeVisible();
});

test('an employee cannot write the rota, and cannot claim an open shift at another location', async ({ page, api }) => {
  await signInEmail(page, AMARA);
  await page.goto('/work/shifts');
  await page.getByTestId(tid.shifts.cards).waitFor();
  const cell = await sendVersioned(page, 'PUT', `${weekPath(W33)}/cells`, 1, { personCode: 'CP-1042', day: 5, code: 'E' });
  expect([cell.status, code(cell)]).toEqual([403, 'capability']);
  const publish = await sendVersioned(page, 'POST', `${weekPath(W33)}/transition`, 1, { to: 'published' });
  expect([publish.status, code(publish)]).toEqual([403, 'capability']);
  const clear = await sendVersioned(page, 'POST', `${weekPath('2026-08-17')}/clear`, 0);
  expect([clear.status, code(clear)]).toEqual([403, 'capability']);
  const cover = await sendVersioned(page, 'POST', '/api/v1/rota/cover/cov_1/assign', 1, { personCode: 'CP-1042' });
  expect([cover.status, code(cover)]).toEqual([403, 'capability']);

  /* Grace works at Beacon Court: Willow House's open shift is not hers to claim */
  await signInEmail(page, GRACE);
  const claim = await sendVersioned(page, 'POST', '/api/v1/rota/cover/cov_2/claim', 1);
  expect([claim.status, code(claim), message(claim)]).toEqual([403, 'scope', 'This open shift is not at your location.']);

  await signInEmail(page, RACHEL);
  const w = await rotaWeek(api, W33);
  expect(w).toMatchObject({ state: 'published', publishVersion: 1, changes: [] });
  const board = (await api.get('/api/v1/rota/cover')).body as { requests: { id: string; open: boolean }[] };
  expect(board.requests.map(r => r.id).sort()).toEqual(['cov_1', 'cov_2']);
});

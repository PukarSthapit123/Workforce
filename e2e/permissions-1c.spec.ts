import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { sendVersioned, signInEmail } from './support/timesheet';
import { stored } from './support/rota';
import { AMARA, DEE, RACHEL, auditRows, tenantOf, wholeStore } from './support/config';

/* 1c Review Focus 1, straight to the server on social: every 1c write asks
   for its capability itself, whatever the screen offers. Module, feature and
   template writes need mod_cfg (a template with structure needs master_data
   too); company and calendar settings need master_data; the notification
   matrix, approval chains and delegations need framework; renaming roles
   needs perm_cfg; posting needs notice_post, and posting beyond your own
   location and its departments needs notice_org. Each refusal names the
   capability in the permissions page's words and writes nothing. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
type R = { status: number; body: unknown };
const said = (r: R) => [r.status, (r.body as { code: string }).code, (r.body as { message: string }).message];
const labels = async (page: Page) => Object.fromEntries((await stored<{ id: string; label: string }>(page, 'capabilities')).map(c => [c.id, c.label]));
const needs = (label: string) => `This needs "${label}", which your access does not include.`;
const NOTICE = { title: 'Visitors this week', body: 'Sign every visitor in at reception.', from: '2026-08-13', until: '', mustAck: false, pinned: false, urgent: false };

test('a manager is refused every 1c setup write, each naming the capability it needs, and nothing is written', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  const label = await labels(page);
  const before = await wholeStore(page);
  const v = (await tenantOf(api)).version;
  const writes: [string, string, string, unknown, number | null][] = [
    ['mod_cfg', 'PATCH', '/api/v1/tenant/modules/R', { on: false }, v],
    ['mod_cfg', 'PATCH', '/api/v1/tenant/flags/NOTICES', { on: false }, v],
    ['master_data', 'PATCH', '/api/v1/tenant/settings', { rotaHorizon: 6 }, v],
    ['master_data', 'PATCH', '/api/v1/tenant/settings', { company: { country: 'Ireland' } }, v],
    ['mod_cfg', 'POST', '/api/v1/templates', { name: 'Mine', description: '', scope: 'config' }, null],
    ['mod_cfg', 'POST', '/api/v1/templates/mne/apply', undefined, v],
    ['mod_cfg', 'POST', '/api/v1/templates/import', { text: '{}' }, null],
    ['mod_cfg', 'DELETE', '/api/v1/templates/mne', undefined, 0],
    ['framework', 'PATCH', '/api/v1/notifications/matrix', { events: { lv_ok: { employee: 'Off' } } }, 0],
    ['framework', 'PUT', '/api/v1/approvals/chains/Leave', { steps: [] }, 0],
    ['framework', 'POST', '/api/v1/approvals/delegations', { who: 'CP-1001', to: 'CP-1002', from: '2026-09-01', until: '2026-09-07', modules: ['Leave'] }, null],
    ['framework', 'DELETE', '/api/v1/approvals/delegations/dlg_1', undefined, 1],
    ['perm_cfg', 'PATCH', '/api/v1/user-types/employee', { name: 'Support Worker' }, 1],
  ];
  for (const [cap, method, path, body, version] of writes) {
    const r = version === null ? await api.send(method, path, body) : await sendVersioned(page, method, path, version, body);
    expect([method, path, ...said(r)]).toEqual([method, path, 403, 'capability', needs(label[cap] ?? cap)]);
  }
  expect(await wholeStore(page)).toEqual(before);
});

test('a template with structure needs Workforce master data as well as module configuration', async ({ page, api }) => {
  /* Rachel is given module configuration alone, as an exception */
  await signInEmail(page, DEE);
  const users = (await api.get('/api/v1/users')).body as { email: string; version: number }[];
  const grant = await sendVersioned(page, 'POST', `/api/v1/users/${encodeURIComponent(RACHEL)}/exceptions`, users.find(u => u.email === RACHEL)?.version ?? 0,
    { capability: 'mod_cfg', mode: 'grant', reason: 'Covering setup this week' });
  expect(grant.status).toBe(200);
  const label = await labels(page);

  await signInEmail(page, RACHEL);
  const structure = await api.send('POST', '/api/v1/templates', { name: 'With structure', description: '', scope: 'structure' });
  expect(said(structure)).toEqual([403, 'capability', needs(label.master_data ?? 'master_data')]);
  expect(await auditRows(page, 'template')).toEqual([]);
  const config = await api.send('POST', '/api/v1/templates', { name: 'Configuration only', description: '', scope: 'config' });
  expect(config.status).toBe(200);
  expect((await auditRows(page, 'template')).map(a => [a.act, a.entityId])).toEqual([['Template saved', 'tpl_configuration_only']]);
});

test('an employee cannot post a notice; a manager posts only to her location and its departments, and cannot change an organisation notice', async ({ page, api }) => {
  await signInEmail(page, AMARA);
  const label = await labels(page);
  const before = await wholeStore(page);
  const own = await api.send('POST', '/api/v1/notices', { ...NOTICE, scope: { kind: 'loc', code: 'WH', loc: 'WH' }, post: true });
  expect(said(own)).toEqual([403, 'capability', needs(label.notice_post ?? 'notice_post')]);
  expect(await wholeStore(page)).toEqual(before);

  await signInEmail(page, RACHEL);
  const signedIn = await wholeStore(page); // signing in is itself audited
  const everyone = await api.send('POST', '/api/v1/notices', { ...NOTICE, scope: { kind: 'all', code: '', loc: '' }, post: true });
  expect(said(everyone)).toEqual([403, 'scope', 'You cannot post to Everyone. It needs Post notices to everyone in Permissions.']);
  expect((everyone.body as { field?: string }).field).toBe('scope');
  const elsewhere = await api.send('POST', '/api/v1/notices', { ...NOTICE, scope: { kind: 'loc', code: 'BC', loc: 'BC' }, post: true });
  expect(said(elsewhere)).toEqual([403, 'scope', 'You cannot post to Beacon Court. It needs Post notices to everyone in Permissions.']);
  const outside = 'Updated lone working policy is outside your scope. It is for Everyone.';
  const edit = await sendVersioned(page, 'PATCH', '/api/v1/notices/NTC-0001', 1, { ...NOTICE, title: 'Updated lone working policy' });
  expect(said(edit)).toEqual([403, 'scope', outside]);
  const withdraw = await sendVersioned(page, 'POST', '/api/v1/notices/NTC-0001/withdraw', 1, { reason: 'Out of date' });
  expect(said(withdraw)).toEqual([403, 'scope', outside]);
  expect(await wholeStore(page)).toEqual(signedIn);

  /* her own location is fine, and the administrator, who holds notice_org, reaches everyone */
  const mine = await api.send('POST', '/api/v1/notices', { ...NOTICE, scope: { kind: 'loc', code: 'WH', loc: 'WH' }, post: true });
  expect(mine.status).toBe(200);
  await signInEmail(page, DEE);
  const org = await api.send('POST', '/api/v1/notices', { ...NOTICE, scope: { kind: 'all', code: '', loc: '' }, post: true });
  expect(org.status).toBe(200);
  expect((await auditRows(page, 'notice')).map(a => a.act)).toEqual(['Notice posted', 'Notice posted']);
});

test('a stale version is refused on a module switch, a chain save and a role rename, and nothing is written', async ({ page, api }) => {
  await signInEmail(page, DEE);
  const before = await wholeStore(page);
  const v = (await tenantOf(api)).version;
  expect((await sendVersioned(page, 'PATCH', '/api/v1/tenant/modules/R', v - 1, { on: false })).status).toBe(412);
  expect((await sendVersioned(page, 'PATCH', '/api/v1/user-types/employee', 0, { name: 'Support Worker' })).status).toBe(412);
  const chain = (await api.get('/api/v1/approvals/chains')).body as { chains: { module: string; version: number; steps: unknown[] }[] };
  const leave = chain.chains.find(c => c.module === 'Leave');
  expect((await sendVersioned(page, 'PUT', '/api/v1/approvals/chains/Leave', (leave?.version ?? 0) + 1, { steps: leave?.steps ?? [] })).status).toBe(412);
  expect(await wholeStore(page)).toEqual(before);
});

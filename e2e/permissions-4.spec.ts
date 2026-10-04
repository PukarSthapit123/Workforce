import { test, expect, FROZEN } from './support/fixtures';
import { sendVersioned, signInEmail } from './support/timesheet';
import { AMARA, GRACE, RACHEL } from './support/rota';
import { askFor, decide, leaveAudit, myLeave, type LeaveReq } from './support/leave';

/* Module 4 Review Focus 1 and 2, straight to the server on social: a manager
   cannot decide, read or record for a colleague at another location (403
   scope, D5); a manager cannot decide their own request (403 SELF_APPROVAL),
   which is not in their queue; an employee cannot decide or read the team's
   leave, and cancels only their own; a stale version is refused (412). Each
   refusal writes nothing. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
type R = { status: number; body: unknown };
const code = (r: R) => (r.body as { code: string }).code;
const said = (r: R) => [r.status, code(r), (r.body as { message: string }).message];
const queue = async (api: { get(p: string): Promise<R> }) => ((await api.get('/api/v1/leave/team/requests')).body as { requests: LeaveReq[] }).requests.map(r => r.id);

test('a manager cannot decide, read or record leave and sickness for a colleague at another location', async ({ page, api }) => {
  /* Grace works at Beacon Court; her annual leave is overdrawn as a leaver, so she asks for unpaid leave */
  await signInEmail(page, GRACE);
  const asked = await askFor(api, '2026-08-20', '2026-08-20', 'UNP');

  await signInEmail(page, RACHEL);
  expect(await queue(api)).not.toContain(asked.id);
  const scope = 'You can decide leave for people at Willow House only.';
  expect(said(await decide(page, asked, 'approve'))).toEqual([403, 'scope', scope]);
  expect(said(await decide(page, asked, 'decline', 'No'))).toEqual([403, 'scope', scope]);
  expect([(await api.get('/api/v1/leave/entitlement/CP-1288')).status]).toEqual([403]);
  const sick = await api.send('POST', '/api/v1/leave/sickness', { personCode: 'CP-1288', from: '2026-08-13', to: '2026-08-13', reason: 'Other' });
  expect(said(sick)).toEqual([403, 'scope', 'You can record sickness for people at Willow House only.']);
  const back = await api.send('POST', '/api/v1/leave/give-back', { personCode: 'CP-1288', dates: ['2026-08-11'] });
  expect([back.status, code(back)]).toEqual([403, 'scope']);
  const balances = (await api.get('/api/v1/leave/team/balances')).body as { rows: { personCode: string }[] };
  expect(balances.rows.map(r => r.personCode)).not.toContain('CP-1288');

  await signInEmail(page, GRACE);
  expect((await myLeave(api)).requests.find(r => r.id === asked.id)).toMatchObject({ state: 'pending', version: 1 });
  expect((await leaveAudit(page)).map(a => a.act)).toEqual(['Leave requested']);
});

test('a manager cannot approve or decline their own request, which is not in their queue, and a stale version is refused', async ({ page, api }) => {
  await signInEmail(page, RACHEL);
  const own = await askFor(api, '2026-08-20');
  expect(await queue(api)).not.toContain(own.id);
  for (const how of ['approve', 'decline'] as const) {
    const r = await decide(page, own, how, 'Fine');
    expect(said(r)).toEqual([403, 'SELF_APPROVAL', 'You cannot decide your own leave request.']);
    expect((r.body as { next: string }).next).toBe('Ask another approver at your location.');
  }
  /* Priya's request at version 1, sent as if it were older */
  const stale = await decide(page, { id: 'lr_1', version: 0 }, 'approve');
  expect(stale.status).toBe(412);
  expect((await myLeave(api)).requests.find(r => r.id === own.id)).toMatchObject({ state: 'pending', version: 1 });
  expect(await queue(api)).toContain('lr_1');
  expect((await leaveAudit(page)).map(a => a.act)).toEqual(['Leave requested']);
});

test('an employee cannot decide or read the team’s leave, cancels only their own requests, and not with a stale version', async ({ page, api }) => {
  await signInEmail(page, AMARA);
  for (const path of ['/api/v1/leave/team/requests', '/api/v1/leave/team/balances', '/api/v1/leave/sickness', '/api/v1/leave/entitlement/CP-1201', '/api/v1/leave/config']) {
    const r = await api.get(path);
    expect([path, r.status]).toEqual([path, 403]);
  }
  /* Priya's waiting request */
  const priya = { id: 'lr_1', version: 1 };
  for (const how of ['approve', 'decline'] as const) {
    const r = await decide(page, priya, how, 'No');
    expect([how, r.status, code(r)]).toEqual([how, 403, 'capability']);
  }
  const theirs = await sendVersioned(page, 'POST', '/api/v1/leave/requests/lr_1/cancel', 1);
  expect(said(theirs)).toEqual([403, 'NOT_YOUR_REQUEST', 'You can cancel only your own requests.']);
  const sick = await api.send('POST', '/api/v1/leave/sickness', { personCode: 'CP-1201', from: '2026-08-13', to: '2026-08-13', reason: 'Other' });
  expect([sick.status, code(sick)]).toEqual([403, 'capability']);

  /* her own waiting request (lr_3), at an older version */
  const stale = await sendVersioned(page, 'POST', '/api/v1/leave/requests/lr_3/cancel', 0);
  expect(stale.status).toBe(412);
  expect((await myLeave(api)).requests.find(r => r.id === 'lr_3')).toMatchObject({ state: 'pending', version: 1 });
  expect(await leaveAudit(page)).toEqual([]);
});

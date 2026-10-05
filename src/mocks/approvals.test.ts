import { server } from './node';
import { store } from './store';
import { ApprovalSetup, ChainModule, ChainSaved, DelegationSaved, Delegations, Delegation } from '@/contract/approvals';
import { ProfileChange } from '@/contract/profile';
import { Refusal } from '@/contract/common';
import { CHAIN_MODULES, defaultChainFor } from '@/domain/approvals';
import { audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const own = () => audits().filter(a => a.act !== 'Signed in');
const layers = (m: (typeof CHAIN_MODULES)[number]) => defaultChainFor(m).map(({ module: _m, ...s }) => { void _m; return s; });
const WRITES = ['approvalChains', 'delegations', 'notifications', 'audit'];
const NEXT = { who: 'CP-1002', to: 'CP-1001', from: '2026-09-01', until: '2026-09-07', modules: ['Leave'] };

test('the contract\'s modules are the domain\'s', () => {
  expect(ChainModule.options).toEqual([...CHAIN_MODULES]);
});

describe('approval chains (Review Focus 6)', () => {
  test('every module reads at the prototype\'s defaults, version 0, until first saved; with the sign-off settings', async () => {
    const r = ApprovalSetup.parse((await (await as('admin'))('GET', '/api/v1/approvals/chains')).body);
    expect(r.chains.map(c => [c.module, c.version, c.steps.map(s => s.role).join(' / ')])).toEqual([
      ['Timesheet', 0, 'Line manager / Payroll / Business Central'], ['Profile', 0, 'Line manager / Payroll'],
      ['Leave', 0, 'Line manager / Service Manager'], ['Rota', 0, 'Service Manager']]);
    expect(r.signOff).toMatchObject({ emailApproval: true, cutoff: 'Monday 12:00', enforceLock: true, current: { from: '2026-08-10', to: '2026-08-16' },
      previous: { from: '2026-08-03', to: '2026-08-09', closed: true } });
  });
  test('only the approval framework reads or writes them', async () => {
    const mgr = await as('manager');
    expect((await mgr('GET', '/api/v1/approvals/chains')).status).toBe(403);
    const before = snapshot(...WRITES);
    expect((await mgr('PUT', '/api/v1/approvals/chains/Leave', { steps: layers('Leave') }, 0)).status).toBe(403);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a chain is saved whole with If-Match and one audit row; stale, missing or the same is refused or does nothing', async () => {
    const call = await as('admin');
    const steps = [{ role: 'Line manager', scope: 'All departments', when: 'Every leave request', sla: '3 days', fixed: false }];
    expect((await call('PUT', '/api/v1/approvals/chains/Leave', { steps })).status).toBe(428);
    expect((await call('PUT', '/api/v1/approvals/chains/Leave', { steps }, 3)).status).toBe(412);
    expect(own()).toEqual([]);
    const r = ChainSaved.parse((await call('PUT', '/api/v1/approvals/chains/Leave', { steps }, 0)).body);
    expect(r.record).toMatchObject({ module: 'Leave', version: 1, steps });
    expect(r.message).toBe('Leave approval chain saved: Line manager.');
    expect(own()).toEqual([expect.objectContaining({ act: 'Approval chain changed', entity: 'approvalChain', entityId: 'chain_leave' })]);
    const again = ChainSaved.parse((await call('PUT', '/api/v1/approvals/chains/Leave', { steps }, 1)).body);
    expect(again).toMatchObject({ auditId: null, message: 'Nothing has changed.' });
    expect((await call('PUT', '/api/v1/approvals/chains/Pay', { steps }, 0)).status).toBe(404);
  });
  test('the posting step cannot be removed, and a refusal or a fault leaves nothing', async () => {
    const call = await as('admin');
    const before = snapshot(...WRITES);
    const noPost = await call('PUT', '/api/v1/approvals/chains/Timesheet', { steps: layers('Timesheet').filter(s => !s.fixed) }, 0);
    expect(noPost.status).toBe(422);
    expect(refusal(noPost)).toMatchObject({ code: 'FIXED', field: 'steps' });
    const badRole = await call('PUT', '/api/v1/approvals/chains/Profile', { steps: [{ role: 'Service Manager', scope: 'All departments', when: 'Every contact detail change', sla: '1 day', fixed: false }] }, 0);
    expect(badRole.status).toBe(422);
    expect(refusal(badRole)).toMatchObject({ field: 'steps.0.role', message: 'The Profile chain can only have a line manager and payroll.' });
    await fault('PUT', '/api/v1/approvals/chains/Leave');
    expect((await call('PUT', '/api/v1/approvals/chains/Leave', { steps: layers('Leave').slice(0, 1) }, 0)).status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
    expect(own()).toEqual([]);
  });
});

describe('delegations (Review Focus 6)', () => {
  test('the prototype\'s delegation is seeded by employee code, with the approvers to choose from', async () => {
    const r = Delegations.parse((await (await as('admin'))('GET', '/api/v1/approvals/delegations')).body);
    expect(r.items.map(d => [d.whoName, d.toName, d.from, d.until, d.modules.join(', '), d.active])).toEqual([
      ['Rachel Hussain', 'Dee Fitzgerald', '2026-08-24', '2026-08-31', 'Timesheet, Leave', false]]);
    expect(r.approvers.map(a => a.name)).toEqual(['Dee Fitzgerald', 'Rachel Hussain']);
  });
  test('the qnipay tenant has none: the prototype\'s people are not on its roster', async () => {
    resetTo('qnipay');
    expect(Delegations.parse((await (await as('admin'))('GET', '/api/v1/approvals/delegations')).body).items).toEqual([]);
  });
  test('adding one writes one audit row; a manager sees those they give or cover', async () => {
    const call = await as('admin');
    const r = DelegationSaved.parse((await call('POST', '/api/v1/approvals/delegations', NEXT)).body);
    expect(r.record).toMatchObject({ id: 'dlg_2', who: 'CP-1002', to: 'CP-1001', modules: ['Leave'] });
    expect(r.message).toBe('Delegation added: Dee Fitzgerald to Rachel Hussain, 01/09/2026 to 07/09/2026, Leave. Every decision records who acted.');
    expect(own()).toEqual([expect.objectContaining({ act: 'Delegation added', entity: 'delegation', entityId: 'dlg_2' })]);
    const mine = (await (await as('manager'))('GET', '/api/v1/approvals/delegations/mine')).body;
    expect(Delegation.array().parse(mine).map(d => d.id)).toEqual(['dlg_1', 'dlg_2']);
    expect((await (await as('employee'))('GET', '/api/v1/approvals/delegations/mine')).status).toBe(403);
  });
  test('self, a loop and an overlap are refused with the field named, and leave nothing', async () => {
    const call = await as('admin');
    const before = snapshot(...WRITES);
    const self = await call('POST', '/api/v1/approvals/delegations', { ...NEXT, to: 'CP-1002' });
    expect(self.status).toBe(409);
    expect(refusal(self)).toMatchObject({ code: 'LOOP', field: 'to', message: 'Dee Fitzgerald cannot cover their own approvals.' });
    const loop = await call('POST', '/api/v1/approvals/delegations', { ...NEXT, from: '2026-08-30' });
    expect(loop.status).toBe(409);
    expect(refusal(loop)).toMatchObject({ code: 'LOOP', field: 'to',
      message: 'Rachel Hussain already delegates Leave to Dee Fitzgerald over those dates. The approvals would go round in a circle.' });
    const overlap = await call('POST', '/api/v1/approvals/delegations', { who: 'CP-1001', to: 'CP-1002', from: '2026-08-31', until: '2026-09-02', modules: ['Timesheet'] });
    expect(overlap.status).toBe(409);
    expect(refusal(overlap)).toMatchObject({ code: 'OVERLAP', field: 'from', message: 'Rachel Hussain already delegates Timesheet to Dee Fitzgerald from 24/08/2026 to 31/08/2026.' });
    const notApprover = await call('POST', '/api/v1/approvals/delegations', { ...NEXT, to: 'CP-1042' });
    expect(refusal(notApprover)).toMatchObject({ field: 'to', message: 'Amara Okafor cannot approve, so cannot cover a queue.' });
    await fault('POST', '/api/v1/approvals/delegations');
    expect((await call('POST', '/api/v1/approvals/delegations', NEXT)).status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
    expect(own()).toEqual([]);
  });
  test('a Profile delegate must hold the access the stage needs; nothing is kept otherwise (M1)', async () => {
    const call = await as('admin'), before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/approvals/delegations', { who: 'CP-1001', to: 'CP-1002', from: '2026-09-01', until: '2026-09-07', modules: ['Profile'] });
    expect([r.status, refusal(r)]).toEqual([422, expect.objectContaining({ code: 'invalid', field: 'to',
      message: 'Dee Fitzgerald cannot cover Rachel Hussain’s Profile approvals without "Approve profile changes".' })]);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('while a Profile delegation is in force, the delegate and the approver they cover are both told of a request (M1)', async () => {
    const dee = store.coll<{ personCode: string; grants: string[] }>('accounts')['acc_dee.fitzgerald@brightpath.org'];
    if (!dee) throw new Error('no Dee');
    dee.grants = [...dee.grants, 'profile_appr'];
    const call = await as('admin');
    expect((await call('POST', '/api/v1/approvals/delegations', { who: 'CP-1001', to: 'CP-1002', from: '2026-08-13', until: '2026-08-20', modules: ['Profile'] })).status).toBe(200);
    expect((await (await as('employee'))('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: '07700 900111' }], note: '' })).status).toBe(200);
    const told = Object.values(store.coll<{ personId: string; event?: string; channel?: string }>('notifications')).filter(n => n.event === 'pf_req');
    expect(told.map(n => [n.personId, n.channel]).sort()).toEqual([['CP-1001', 'In-app + email'], ['CP-1002', 'In-app + email']]);
  });
  test('removing one needs If-Match and writes one audit row; a fault leaves it', async () => {
    const call = await as('admin');
    await fault('DELETE', '/api/v1/approvals/delegations/dlg_1');
    expect((await call('DELETE', '/api/v1/approvals/delegations/dlg_1', undefined, 1)).status).toBe(500);
    expect(Object.keys(store.coll('delegations'))).toEqual(['dlg_1']);
    expect((await call('DELETE', '/api/v1/approvals/delegations/dlg_1', undefined, 4)).status).toBe(412);
    expect((await call('DELETE', '/api/v1/approvals/delegations/dlg_1', undefined, 1)).status).toBe(200);
    expect(store.coll('delegations')).toEqual({});
    expect(own()).toEqual([expect.objectContaining({ act: 'Delegation removed', entityId: 'dlg_1' })]);
    expect((await call('DELETE', '/api/v1/approvals/delegations/dlg_1', undefined, 1)).status).toBe(404);
  });
});

describe('profile routing follows the Profile chain (D8)', () => {
  const propose = async (field: string, to: string) => {
    const r = await (await as('employee'))('POST', '/api/v1/profile-changes', { changes: [{ field, to }], note: '' });
    return ProfileChange.array().parse((r.body as { records: unknown }).records);
  };
  test('at the defaults a contact change goes to the line manager, who is told (pf_req)', async () => {
    const [rec] = await propose('phone', '07700 900111');
    expect(rec).toMatchObject({ route: ['manager'], stage: 'manager' });
    const told = Object.values(store.coll<{ personId: string; event?: string; body: string }>('notifications')).filter(n => n.event === 'pf_req');
    expect(told.map(n => [n.personId, n.body])).toEqual([['CP-1001', 'Amara Okafor (CP-1042). Mobile number. Awaiting approval.']]);
  });
  test('after payroll is put first for every contact change, a phone change goes to payroll alone', async () => {
    const steps = [
      { role: 'Payroll', scope: 'All departments', when: 'Every contact detail change', sla: '2 days', fixed: false },
      { role: 'Line manager', scope: 'Own department', when: 'Only bank details', sla: '3 days', fixed: false }];
    expect((await (await as('admin'))('PUT', '/api/v1/approvals/chains/Profile', { steps }, 0)).status).toBe(200);
    const [phone] = await propose('phone', '07700 900111');
    expect(phone).toMatchObject({ route: ['payroll'], stage: 'payroll' });
    const [bank] = await propose('bankAccount', '11112222');
    expect(bank).toMatchObject({ route: ['payroll', 'manager'], stage: 'payroll' });
    /* both wait in payroll's queue (Dee Fitzgerald holds bank verification); the line manager has nothing yet */
    const queue = ProfileChange.array().parse((await (await as('admin'))('GET', '/api/v1/profile-changes')).body);
    expect(queue.filter(c => c.personCode === 'CP-1042').map(c => [c.field, c.stage])).toEqual([['phone', 'payroll'], ['bankAccount', 'payroll']]);
    const mgr = ProfileChange.array().parse((await (await as('manager'))('GET', '/api/v1/profile-changes')).body);
    expect(mgr.filter(c => c.personCode === 'CP-1042' && ['phone', 'bankAccount'].includes(c.field) && c.raisedAt === store.now())).toEqual([]);
    /* the payroll decider is acting on the request, so takes the Manager column whatever her account type (I3): Dee is told of both */
    const told = Object.values(store.coll<{ personId: string; event?: string; channel?: string }>('notifications')).filter(n => n.event === 'pf_req');
    expect(told.map(n => [n.personId, n.channel])).toEqual([['CP-1002', 'In-app + email'], ['CP-1002', 'In-app + email']]);
  });
  test('at the defaults, a bank-detail change that passes the manager stage reaches the payroll decider (I3)', async () => {
    const [bank] = await propose('bankAccount', '11112222');
    expect(bank).toMatchObject({ route: ['manager', 'payroll'], stage: 'manager' });
    if (!bank) throw new Error('no change');
    const ok = await (await as('manager'))('POST', `/api/v1/profile-changes/${bank.id}/decision`, { decision: 'approve', reason: '' }, bank.version);
    expect([ok.status, (ok.body as { record: { stage: string } }).record.stage]).toEqual([200, 'payroll']);
    const told = Object.values(store.coll<{ personId: string; event?: string }>('notifications')).filter(n => n.event === 'pf_req').map(n => n.personId);
    expect(told).toEqual(['CP-1001', 'CP-1002']);
  });
});

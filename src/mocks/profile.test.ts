import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { decideProfileChange, getProfile, listProfileChanges, proposeChanges } from '@/contract/profile';
import { accountOf, audits, caller, fault, personOf, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));
const as = async (p: Persona) => caller(await tokenFor(p));
const WRITES = ['people', 'profileChanges', 'personHistory', 'audit'];
interface StoredChange { id: string; version: number; personCode: string; field: string; status: string; stage: string; from: string; to: string }
const changes = () => Object.values(store.coll<StoredChange>('profileChanges'));
const changeFor = (code: string, field: string) => {
  const c = changes().find(x => x.personCode === code && x.field === field && x.status === 'pending');
  if (!c) throw new Error(`no pending ${field} change for ${code}`);
  return c;
};
type Call = ReturnType<typeof caller>;
/* Signing in writes an audit row, so a test that snapshots the store signs in first and passes its caller. */
const decideWith = (call: Call, c: { id: string; version: number }, decision: 'approve' | 'decline', reason = '') =>
  call('POST', `/api/v1/profile-changes/${c.id}/decision`, { decision, reason }, c.version);
const decide = async (who: Persona, c: { id: string; version: number }, decision: 'approve' | 'decline', reason = '') =>
  decideWith(await as(who), c, decision, reason);
const me = () => personOf(accountOf('employee').personCode);
/* A bank change the manager has already passed on, waiting for payroll. */
const atPayroll = (code: string, from = String(personOf(code).bankAccount ?? '')) => {
  const id = `pfc_test_payroll_${code}`;
  store.coll('profileChanges')[id] = { id, version: 2, updatedAt: store.now(), personCode: code, field: 'bankAccount', from, to: '87654321',
    note: '', raisedAt: store.now(), status: 'pending', stage: 'payroll', route: ['manager', 'payroll'], decisions: [] };
  return { id, version: 2 };
};

describe('GET /api/v1/profile', () => {
  test('an employee reads their own record, the six fields, and nothing pending', async () => {
    const p = getProfile.response.parse((await (await as('employee'))('GET', '/api/v1/profile')).body);
    expect(p.person.code).toBe(accountOf('employee').personCode);
    expect(p.fields.map(f => f.key)).toEqual(['phone', 'address', 'emergencyName', 'emergencyPhone', 'bankAccount', 'bankSortCode']);
    expect(p.pending).toEqual([]);
    expect(p.selfEdit).toBe(true);
    expect(p.person.bankAccount).toMatch(/^(\*{4}.{0,4})?$/);
  });
  test('an admin, who has no own profile capability, is refused', async () => {
    expect((await (await as('admin'))('GET', '/api/v1/profile')).status).toBe(403);
  });
});

describe('POST /api/v1/profile-changes', () => {
  test('a proposal writes nothing to the record; it raises a pending change and one audit row', async () => {
    const was = String(me().phone);
    const r = await (await as('employee'))('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: '07700 900461' }], note: 'New phone' });
    expect(r.status).toBe(200);
    const { records, auditId } = proposeChanges.response.parse(r.body);
    expect(records).toEqual([expect.objectContaining({ field: 'phone', from: was, to: '07700 900461', status: 'pending', stage: 'manager', route: ['manager'] })]);
    expect(me().phone).toBe(was);
    expect(audits().find(a => a.id === auditId)?.act).toBe('Profile change requested');
  });
  test('a bank change routes to payroll as well, and its values are masked in the response', async () => {
    const r = await (await as('employee'))('POST', '/api/v1/profile-changes', { changes: [{ field: 'bankAccount', to: '12345678' }], note: '' });
    const [rec] = proposeChanges.response.parse(r.body).records;
    expect(rec).toMatchObject({ route: ['manager', 'payroll'], to: '****5678' });
    expect(changeFor(me().code, 'bankAccount').to).toBe('12345678');
  });
  test('an unchanged form is refused, and so is an unchanged masked bank number', async () => {
    const call = await as('employee');
    const r = await call('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: String(me().phone) }, { field: 'bankAccount', to: String(me().bankAccount) }], note: '' });
    expect(r.status).toBe(422);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'unchanged', message: 'Nothing has changed.' });
  });
  test('a field with a change already in flight is refused, and nothing is raised', async () => {
    const call = await as('employee');
    await call('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: '07700 900461' }], note: '' });
    const before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: '07700 900462' }, { field: 'address', to: '1 New Road' }], note: '' });
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'pending', message: 'A change to Mobile number is already awaiting approval.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('self-service switched off for the tenant is refused', async () => {
    const t = store.coll<{ flags: Record<string, unknown> }>('tenant').tenant;
    if (!t) throw new Error('no tenant record');
    t.flags = { ...t.flags, SELF_EDIT: false };
    const r = await (await as('employee'))('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: '1' }], note: '' });
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body).code).toBe('feature-off');
  });
  test('a fault leaves the store unchanged', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    await fault('POST', '/api/v1/profile-changes');
    expect((await call('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: '1' }], note: '' })).status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

describe('GET /api/v1/profile-changes', () => {
  test('a manager sees the pending changes for people at their location', async () => {
    const q = listProfileChanges.response.parse((await (await as('manager'))('GET', '/api/v1/profile-changes')).body);
    expect(q.map(c => [c.personCode, c.field]).sort()).toEqual([['CP-1088', 'phone'], ['CP-1201', 'address']]);
    expect(q[0]?.personName).toBeTruthy();
  });
  test('an employee is refused, naming the capability', async () => {
    const r = await (await as('employee'))('GET', '/api/v1/profile-changes');
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body).message).toContain('Approve profile changes');
  });
  test('payroll sees only changes waiting for payroll', async () => {
    const waiting = atPayroll(me().code);
    const q = listProfileChanges.response.parse((await (await as('admin'))('GET', '/api/v1/profile-changes')).body);
    expect(q.map(c => c.id)).toEqual([waiting.id]);
  });
  test('payroll is not offered its own bank change, which it could not decide', async () => {
    atPayroll(me().code);
    const own = atPayroll(accountOf('admin').personCode);
    const q = listProfileChanges.response.parse((await (await as('admin'))('GET', '/api/v1/profile-changes')).body);
    expect(q.map(c => c.personCode)).toEqual([me().code]);
    expect(q.map(c => c.id)).not.toContain(own.id);
  });
});

describe('POST /api/v1/profile-changes/:id/decision', () => {
  test('a manager\'s approval writes the value to the one record, with history and audit', async () => {
    const c = changeFor('CP-1088', 'phone');
    const r = await decide('manager', c, 'approve');
    expect(r.status).toBe(200);
    const out = decideProfileChange.response.parse(r.body);
    expect(out.record).toMatchObject({ status: 'approved', stage: 'done' });
    expect(out.person?.phone).toBe(c.to);
    expect(personOf('CP-1088').phone).toBe(c.to);
    expect(Object.values(store.coll<{ personCode: string; source: string }>('personHistory')).some(h => h.personCode === 'CP-1088' && h.source === 'profile-change')).toBe(true);
    expect(audits().find(a => a.id === out.auditId)?.act).toBe('Profile change approved');
  });
  test('a decline needs a reason, then leaves the record as it was', async () => {
    const c = changeFor('CP-1201', 'address'), was = personOf('CP-1201').address;
    expect(Refusal.parse((await decide('manager', c, 'decline')).body).field).toBe('reason');
    const out = decideProfileChange.response.parse((await decide('manager', c, 'decline', 'Address not recognised')).body);
    expect(out).toMatchObject({ record: { status: 'declined' }, person: null });
    expect(personOf('CP-1201').address).toBe(was);
    expect(audits().find(a => a.id === out.auditId)).toMatchObject({ act: 'Profile change declined', reason: 'Address not recognised' });
  });
  test('a bank change approved by the manager waits for payroll, and the record does not change until payroll approves', async () => {
    await (await as('employee'))('POST', '/api/v1/profile-changes', { changes: [{ field: 'bankAccount', to: '12345678' }], note: '' });
    const was = me().bankAccount;
    const first = decideProfileChange.response.parse((await decide('manager', changeFor(me().code, 'bankAccount'), 'approve')).body);
    expect(first).toMatchObject({ record: { status: 'pending', stage: 'payroll' }, person: null });
    expect(me().bankAccount).toBe(was);
    expect(audits().find(a => a.id === first.auditId)?.act).toBe('Profile change passed to payroll');
    const again = await decide('manager', changeFor(me().code, 'bankAccount'), 'approve');
    expect(again.status).toBe(403);
    expect(Refusal.parse(again.body).message).toContain('Verify bank detail changes');
    const queue = listProfileChanges.response.parse((await (await as('admin'))('GET', '/api/v1/profile-changes')).body);
    expect(queue.map(c => c.field)).toEqual(['bankAccount']);
    const last = decideProfileChange.response.parse((await decide('admin', changeFor(me().code, 'bankAccount'), 'approve')).body);
    expect(last.record.status).toBe('approved');
    expect(me().bankAccount).toBe('12345678');
    expect(last.person?.bankAccount).toBe('****5678');
  });
  test('nobody decides a change to their own details', async () => {
    const mgr = accountOf('manager').personCode;
    await (await as('manager'))('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: '07700 900999' }], note: '' });
    const queue = listProfileChanges.response.parse((await (await as('manager'))('GET', '/api/v1/profile-changes')).body);
    expect(queue.map(c => c.personCode)).not.toContain(mgr);
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await decideWith(call, changeFor(mgr, 'phone'), 'approve');
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body).code).toBe('own-change');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('nobody decides their own bank change at the payroll stage either', async () => {
    const admin = accountOf('admin').personCode, c = atPayroll(admin);
    const call = await as('admin'), before = snapshot(...WRITES);
    const r = await decideWith(call, c, 'approve');
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body).code).toBe('own-change');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('at the payroll stage, a bank change the record has overtaken is refused, and the newer value stands', async () => {
    const code = me().code, c = atPayroll(code, 'not-the-current-number');
    const call = await as('admin'), before = snapshot(...WRITES);
    const r = await decideWith(call, c, 'approve');
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'changed-since', next: 'Decline this change and ask for a new proposal.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a change the record has overtaken is refused, and the newer value stands', async () => {
    const c = changeFor('CP-1088', 'phone'), p = personOf('CP-1088');
    await (await as('admin'))('PATCH', `/api/v1/people/${p.id}`, { phone: '07700 900555' }, p.version);
    const r = await decide('manager', c, 'approve');
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'changed-since', next: 'Decline this change and ask for a new proposal.' });
    expect(personOf('CP-1088').phone).toBe('07700 900555');
    expect(changeFor('CP-1088', 'phone').status).toBe('pending');
  });
  test('a manager cannot decide for someone at another location', async () => {
    const mine = String(personOf(accountOf('manager').personCode).location);
    const other = Object.values(store.coll<{ code: string; location: string }>('people')).find(p => p.location !== mine);
    if (!other) throw new Error('nobody outside the manager\'s location');
    const id = 'pfc_test_other';
    store.coll('profileChanges')[id] = { id, version: 1, updatedAt: store.now(), personCode: other.code, field: 'phone', from: '', to: '1',
      note: '', raisedAt: store.now(), status: 'pending', stage: 'manager', route: ['manager'], decisions: [] };
    const r = await decide('manager', { id, version: 1 }, 'approve');
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body).code).toBe('scope');
  });
  test('a decided change cannot be decided again', async () => {
    await decide('manager', changeFor('CP-1088', 'phone'), 'approve');
    const done = changes().find(c => c.personCode === 'CP-1088' && c.field === 'phone');
    if (!done) throw new Error('change vanished');
    const r = await decide('manager', done, 'decline', 'Too late');
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body).code).toBe('decided');
  });
  test('a stale version is refused with 412', async () => {
    const c = changeFor('CP-1088', 'phone');
    expect((await decide('manager', { id: c.id, version: c.version + 1 }, 'approve')).status).toBe(412);
  });
  test('a fault leaves the store unchanged', async () => {
    const call = await as('manager'), c = changeFor('CP-1088', 'phone'), before = snapshot(...WRITES);
    await fault('POST', `/api/v1/profile-changes/${c.id}/decision`);
    expect((await decideWith(call, c, 'approve')).status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

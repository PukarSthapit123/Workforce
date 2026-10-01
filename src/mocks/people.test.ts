import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { createPerson, getNextCode, listHistory, listPeople, updatePerson } from '@/contract/people';
import { accountOf, audits, caller, fault, personOf, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));
const as = async (p: Persona) => caller(await tokenFor(p));
const WRITES = ['people', 'accounts', 'personHistory', 'audit'];
const newPerson = (over: Record<string, unknown> = {}) => ({
  code: 'CP-9001', name: 'Test Person', email: 'test.person@brightpath.org', phone: '', jobProfile: 'SW', employeeType: 'shift',
  category: 'Contracted', location: 'WH', department: 'CARE', manager: 'Rachel Hussain', contractedHours: 30, maxHours: 45,
  night: false, resource: '', cis: false, start: '2026-08-13', state: 'active', userType: 'employee', ...over });
const managerLocation = () => String(personOf(accountOf('manager').personCode).location);

describe('GET /api/v1/people', () => {
  test('an admin sees everyone currently here, and the response parses against the contract', async () => {
    const r = await (await as('admin'))('GET', '/api/v1/people');
    expect(r.status).toBe(200);
    const list = listPeople.response.parse(r.body);
    const here = Object.values(store.coll<{ state: string }>('people')).filter(p => !['leaver', 'archived'].includes(p.state));
    expect(list).toHaveLength(here.length);
    expect(list.map(p => p.code)).not.toContain('CP-1288');
  });
  test('state=all reaches leavers, and a single state filters', async () => {
    const call = await as('admin');
    expect(listPeople.response.parse((await call('GET', '/api/v1/people?state=all')).body).map(p => p.code)).toContain('CP-1288');
    const leavers = listPeople.response.parse((await call('GET', '/api/v1/people?state=leaver')).body);
    expect(leavers.length).toBeGreaterThan(0);
    expect(leavers.every(p => p.state === 'leaver')).toBe(true);
  });
  test('q searches name and employee ID', async () => {
    const list = listPeople.response.parse((await (await as('admin'))('GET', '/api/v1/people?q=okafor')).body);
    expect(list.map(p => p.name)).toContain('Amara Okafor');
    expect(list.every(p => /okafor/i.test(p.name) || /okafor/i.test(p.code))).toBe(true);
  });
  test('q also finds people by their job profile’s name', async () => {
    const job = Object.values(store.coll<{ code: string; name: string }>('jobProfiles'))
      .find(j => Object.values(store.coll<{ jobProfile: string; state: string }>('people')).some(p => p.jobProfile === j.code && p.state === 'active'));
    if (!job) throw new Error('the seed has no job profile anyone active holds');
    const list = listPeople.response.parse((await (await as('admin'))('GET', `/api/v1/people?q=${encodeURIComponent(job.name.toLowerCase())}`)).body);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some(p => p.jobProfile === job.code)).toBe(true);
  });
  test('a manager sees only their own location', async () => {
    const list = listPeople.response.parse((await (await as('manager'))('GET', '/api/v1/people?state=all')).body);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every(p => p.location === managerLocation())).toBe(true);
  });
  test('an employee is refused with 403 naming the capability, in the one refusal shape', async () => {
    const r = await (await as('employee'))('GET', '/api/v1/people');
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'capability', message: expect.stringContaining('Team people list') });
  });
  test('bank account numbers are masked in every response', async () => {
    const list = listPeople.response.parse((await (await as('admin'))('GET', '/api/v1/people?state=all')).body);
    expect(list.filter(p => p.bankAccount && !/^\*{4}.{0,4}$/.test(p.bankAccount)).map(p => p.code)).toEqual([]);
  });
});

describe('GET /api/v1/people/:id and its history', () => {
  test('a manager is refused a person at another location, even with the record ID', async () => {
    const other = Object.values(store.coll<{ id: string; location: string }>('people')).find(p => p.location !== managerLocation());
    if (!other) throw new Error('the seed has nobody outside the manager\'s location');
    const r = await (await as('manager'))('GET', `/api/v1/people/${other.id}`);
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body).code).toBe('scope');
  });
  test('an employee can read their own record', async () => {
    const me = personOf(accountOf('employee').personCode);
    const r = await (await as('employee'))('GET', `/api/v1/people/${me.id}`);
    expect(r.status).toBe(200);
  });
  test('history is newest first and parses', async () => {
    const call = await as('admin'), p = personOf('CP-1042');
    await call('PATCH', `/api/v1/people/${p.id}`, { contractedHours: 30 }, p.version);
    await call('PATCH', `/api/v1/people/${p.id}`, { maxHours: 40 }, p.version + 1);
    const h = listHistory.response.parse((await call('GET', `/api/v1/people/${p.id}/history`)).body);
    expect(h.map(e => e.field)).toEqual(['maxHours', 'contractedHours']);
    expect(h[1]).toMatchObject({ source: 'edited', from: '37.5', to: '30', by: { personCode: accountOf('admin').personCode } });
  });
});

describe('GET /api/v1/people/next-code', () => {
  test('it proposes the next free employee ID, in the tenant\'s own scheme', async () => {
    const r = await (await as('admin'))('GET', '/api/v1/people/next-code');
    const { code } = getNextCode.response.parse(r.body);
    expect(code).toMatch(/^[A-Z][A-Z0-9-]*\d+$/);
    expect(Object.values(store.coll<{ code: string }>('people')).map(p => p.code)).not.toContain(code);
  });
  test('EI A new ID follows the scheme already in use', async () => {
    resetTo('qnipay');
    const { code } = getNextCode.response.parse((await (await as('admin'))('GET', '/api/v1/people/next-code')).body);
    expect(code).toBe('EMP021');
  });
  test('an employee is refused', async () => {
    expect((await (await as('employee'))('GET', '/api/v1/people/next-code')).status).toBe(403);
  });
});

describe('POST /api/v1/people', () => {
  test('a valid record is created with its account, one history entry and one audit row', async () => {
    const call = await as('admin'), before = audits().length;
    const r = await call('POST', '/api/v1/people', newPerson());
    expect(r.status).toBe(200);
    const { record, auditId } = createPerson.response.parse(r.body);
    expect(record).toMatchObject({ code: 'CP-9001', state: 'active', version: 1, userType: 'employee' });
    expect(store.coll('accounts')['acc_test.person@brightpath.org']).toMatchObject({ personCode: 'CP-9001', userType: 'employee' });
    expect(Object.values(store.coll<{ personCode: string; source: string }>('personHistory')).filter(h => h.personCode === 'CP-9001'))
      .toEqual([expect.objectContaining({ source: 'created', field: 'state', to: 'active' })]);
    expect(audits()).toHaveLength(before + 1);
    expect(audits().find(a => a.id === auditId)).toMatchObject({ act: 'Employee created', entity: 'person', entityId: 'CP-9001',
      after: expect.objectContaining({ employeeType: 'shift', location: 'WH', contractedHours: 30 }) });
  });
  test('a duplicate employee ID is refused with 422 on the code field, and nothing is written', async () => {
    const call = await as('admin');
    const before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/people', newPerson({ code: 'cp-1042' }));
    expect(r.status).toBe(422);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'invalid', field: 'code', message: expect.stringContaining('already in use') });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a starting state other than candidate, preboarding or active is refused', async () => {
    const r = await (await as('admin'))('POST', '/api/v1/people', newPerson({ state: 'leaver' }));
    expect(r.status).toBe(422);
    expect(Refusal.parse(r.body).field).toBe('state');
  });
  test('a manager cannot create an admin: 403, and no account appears', async () => {
    const call = await as('manager');
    const before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/people', newPerson({ location: managerLocation(), userType: 'admin' }));
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'capability', message: expect.stringContaining('Permissions and role configuration') });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a manager can add someone at their own location, and only there', async () => {
    const call = await as('manager');
    expect((await call('POST', '/api/v1/people', newPerson({ location: managerLocation() }))).status).toBe(200);
    const elsewhere = Object.values(store.coll<{ code: string }>('locations')).find(l => l.code !== managerLocation());
    if (!elsewhere) throw new Error('the seed has one location only');
    const r = await call('POST', '/api/v1/people', newPerson({ code: 'CP-9002', email: 'x2@brightpath.org', location: elsewhere.code }));
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body).code).toBe('scope');
  });
  test('an employee is refused, naming the capability', async () => {
    const r = await (await as('employee'))('POST', '/api/v1/people', newPerson());
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body).message).toContain('Add and edit people');
  });
  test('a fault leaves the store unchanged', async () => {
    const call = await as('admin');
    const before = snapshot(...WRITES);
    await fault('POST', '/api/v1/people');
    const r = await call('POST', '/api/v1/people', newPerson());
    expect(r.status).toBe(500);
    expect(Refusal.parse(r.body).code).toBe('fault');
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

describe('PATCH /api/v1/people/:id', () => {
  test('an edit bumps the version, names the changed fields, and is audited before → after', async () => {
    const p = personOf('CP-1042');
    const r = await (await as('admin'))('PATCH', `/api/v1/people/${p.id}`, { contractedHours: 30, phone: '07700 900001' }, p.version);
    expect(r.status).toBe(200);
    const { record, changed, auditId } = updatePerson.response.parse(r.body);
    expect(record).toMatchObject({ version: p.version + 1, contractedHours: 30, phone: '07700 900001' });
    expect(changed.sort()).toEqual(['contractedHours', 'phone']);
    expect(audits().find(a => a.id === auditId)).toMatchObject({ act: 'Employee record edited', entityId: 'CP-1042',
      before: { contractedHours: '37.5', phone: '07700 900777' }, after: { contractedHours: '30', phone: '07700 900001' } });
  });
  test('an edit that changes nothing writes nothing', async () => {
    const call = await as('admin');
    const p = personOf('CP-1042'), before = snapshot(...WRITES);
    const r = await call('PATCH', `/api/v1/people/${p.id}`, { name: String(p.name) }, p.version);
    expect(updatePerson.response.parse(r.body)).toMatchObject({ changed: [], auditId: null });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a stale version is refused with 412 and nothing changes', async () => {
    const call = await as('admin');
    const p = personOf('CP-1042'), before = snapshot(...WRITES);
    const r = await call('PATCH', `/api/v1/people/${p.id}`, { contractedHours: 20 }, p.version + 5);
    expect(r.status).toBe(412);
    expect(Refusal.parse(r.body).next).toBe('Reload and apply your change again');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('the employee ID cannot be changed once it exists', async () => {
    const p = personOf('CP-1042');
    const r = await (await as('admin'))('PATCH', `/api/v1/people/${p.id}`, { code: 'CP-7777' }, p.version);
    expect(r.status).toBe(422);
    expect(Refusal.parse(r.body)).toMatchObject({ field: 'code', message: 'Employee ID cannot change once it exists. Existing records reference it.' });
    expect(personOf('CP-1042').version).toBe(p.version);
  });
  test('a state cannot be patched; it needs a transition', async () => {
    const p = personOf('CP-1042');
    const r = await (await as('admin'))('PATCH', `/api/v1/people/${p.id}`, { state: 'leaver' }, p.version);
    expect(r.status).toBe(422);
    expect(Refusal.parse(r.body).field).toBe('state');
    expect(personOf('CP-1042').state).toBe('active');
  });
  test('editing hours on a record whose seed email is shared succeeds', async () => {
    resetTo('qnipay');
    const p = personOf('EMP015');
    const r = await (await as('admin'))('PATCH', `/api/v1/people/${p.id}`, { contractedHours: 30 }, p.version);
    expect(r.status).toBe(200);
    expect(personOf('EMP015').contractedHours).toBe(30);
  });
  test('changing the email re-keys the account', async () => {
    const p = personOf('CP-1042'), old = String(p.email);
    await (await as('admin'))('PATCH', `/api/v1/people/${p.id}`, { email: 'amara.new@brightpath.org' }, p.version);
    expect(store.coll('accounts')[`acc_${old}`]).toBeUndefined();
    expect(store.coll('accounts')['acc_amara.new@brightpath.org']).toMatchObject({ personCode: 'CP-1042' });
  });
  test('a manager cannot change a user type', async () => {
    const call = await as('manager');
    const p = personOf(accountOf('employee').personCode), before = snapshot(...WRITES);
    const r = await call('PATCH', `/api/v1/people/${p.id}`, { userType: 'manager' }, p.version);
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body).code).toBe('capability');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  /* The work email is the sign-in identity (D8): re-keying an account that
     carries more than an employee's rights is an access decision, as the
     user type is. Without this a manager could move an admin's account to an
     address of their choosing and lock the admin out. */
  test('a manager cannot change the work email of an admin in their own location', async () => {
    resetTo('qnipay');
    const mgr = accountOf('manager'), here = String(personOf(mgr.personCode).location);
    const admin = Object.values(store.coll<{ email: string; userType: string; personCode: string }>('accounts'))
      .find(a => a.userType === 'admin' && personOf(a.personCode).location === here);
    if (!admin) throw new Error('the qnipay seed has no admin at the manager\'s location');
    const call = await as('manager'), p = personOf(admin.personCode), before = snapshot(...WRITES);
    const r = await call('PATCH', `/api/v1/people/${p.id}`, { email: 'someone.else@dogmagroup.co.uk' }, p.version);
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'capability', next: expect.any(String) });
    expect(snapshot(...WRITES)).toEqual(before);
    expect(store.coll('accounts')[`acc_${admin.email.toLowerCase()}`]).toMatchObject({ personCode: admin.personCode, userType: 'admin' });
  });
  test('a manager can still change the work email of an employee, and the account follows it', async () => {
    const p = personOf(accountOf('employee').personCode), old = String(p.email);
    expect(p.location).toBe(managerLocation());
    const call = await as('manager'), rows = audits().length;
    const r = await call('PATCH', `/api/v1/people/${p.id}`, { email: 'moved.here@brightpath.org' }, p.version);
    expect(r.status).toBe(200);
    expect(store.coll('accounts')[`acc_${old.toLowerCase()}`]).toBeUndefined();
    expect(store.coll('accounts')['acc_moved.here@brightpath.org']).toMatchObject({ personCode: p.code, userType: 'employee' });
    expect(audits()).toHaveLength(rows + 1);
  });
  test('a manager cannot edit someone at another location', async () => {
    const other = Object.values(store.coll<{ id: string; version: number; location: string }>('people')).find(p => p.location !== managerLocation());
    if (!other) throw new Error('the seed has nobody outside the manager\'s location');
    const r = await (await as('manager'))('PATCH', `/api/v1/people/${other.id}`, { contractedHours: 10 }, other.version);
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body).code).toBe('scope');
  });
  test('a fault leaves the store unchanged', async () => {
    const call = await as('admin');
    const p = personOf('CP-1042'), before = snapshot(...WRITES);
    await fault('PATCH', `/api/v1/people/${p.id}`);
    expect((await call('PATCH', `/api/v1/people/${p.id}`, { contractedHours: 20 }, p.version)).status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('an admin can change a user type, which changes their account and is recorded', async () => {
    const call = await as('admin');
    const emp = accountOf('employee'), p = personOf(emp.personCode);
    const r = await call('PATCH', `/api/v1/people/${p.id}`, { userType: 'manager' }, p.version);
    expect(r.status).toBe(200);
    expect(updatePerson.response.parse(r.body)).toMatchObject({ changed: ['userType'], record: { userType: 'manager' } });
    expect(store.coll<{ userType: string }>('accounts')[`acc_${emp.email}`]?.userType).toBe('manager');
  });
  test('an admin cannot change their own user type: 409, and nothing is written', async () => {
    const call = await as('admin');
    const me = personOf(accountOf('admin').personCode), before = snapshot(...WRITES);
    const r = await call('PATCH', `/api/v1/people/${me.id}`, { userType: 'employee' }, me.version);
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body).code).toBe('locked');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a manager cannot move someone to another location', async () => {
    const call = await as('manager');
    const p = personOf(accountOf('employee').personCode), before = snapshot(...WRITES);
    const elsewhere = Object.values(store.coll<{ code: string }>('locations')).find(l => l.code !== managerLocation());
    if (!elsewhere) throw new Error('the seed has one location only');
    const r = await call('PATCH', `/api/v1/people/${p.id}`, { location: elsewhere.code }, p.version);
    expect(r.status).toBe(403);
    expect(Refusal.parse(r.body).code).toBe('scope');
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { createEmployeeType, getTypeLibrary, listEmployeeTypes, removeEmployeeType, updateEmployeeType } from '@/contract/employee-types';
import { audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));
const as = async (p: Persona) => caller(await tokenFor(p));
const WRITES = ['employeeTypes', 'audit'];
const BASE = '/api/v1/employee-types';
const sample = { code: 'waking_night', name: 'Waking Night Support', category: 'Contracted', mode: 'clock', uom: 'hour', capabilities: ['shift'], startedFrom: 'blank' };
const typeByCode = (code: string) => {
  const t = Object.values(store.coll<{ id: string; version: number; code: string }>('employeeTypes')).find(x => x.code === code);
  if (!t) throw new Error(`no employee type ${code}`);
  return t;
};
const heldType = () => {
  const p = Object.values(store.coll<{ employeeType: string }>('people'))[0];
  if (!p) throw new Error('no people');
  return p.employeeType;
};

test('the list parses with in-use counts, for anyone signed in', async () => {
  const list = listEmployeeTypes.response.parse((await (await as('employee'))('GET', BASE)).body);
  expect(list.find(t => t.code === heldType())?.inUse).toBeGreaterThan(0);
});
test('the library offers the prototype\'s archetypes and type capabilities, to type_cfg only', async () => {
  const lib = getTypeLibrary.response.parse((await (await as('admin'))('GET', `${BASE}/library`)).body);
  expect(lib.archetypes.length).toBeGreaterThan(2);
  expect(lib.capabilities.map(c => c.code)).toEqual(['vehicle', 'site', 'project', 'shift']);
  expect((await (await as('manager'))('GET', `${BASE}/library`)).status).toBe(403);
});
test('ET A type is created, with entry mode and pay basis, and audited with where it started from', async () => {
  const r = await (await as('admin'))('POST', BASE, sample);
  expect(r.status).toBe(200);
  const { record, auditId } = createEmployeeType.response.parse(r.body);
  expect(record).toMatchObject({ code: 'waking_night', mode: 'clock', uom: 'hour', version: 1 });
  expect(audits().find(a => a.id === auditId)).toMatchObject({ act: 'Employee type created', after: expect.objectContaining({ startedFrom: 'blank' }) });
});
test('ET A name is required', async () => {
  const call = await as('admin'), before = snapshot(...WRITES);
  const r = await call('POST', BASE, { ...sample, name: ' ' });
  expect(r.status).toBe(422);
  expect(Refusal.parse(r.body)).toMatchObject({ field: 'name', message: 'A name is required.' });
  expect(snapshot(...WRITES)).toEqual(before);
});
test('a duplicate or malformed type code is refused', async () => {
  const call = await as('admin');
  expect(Refusal.parse((await call('POST', BASE, { ...sample, code: heldType() })).body).field).toBe('code');
  expect(Refusal.parse((await call('POST', BASE, { ...sample, code: 'Waking Night' })).body).field).toBe('code');
});
test('a manager is refused, naming the capability', async () => {
  const r = await (await as('manager'))('POST', BASE, sample);
  expect(r.status).toBe(403);
  expect(Refusal.parse(r.body).message).toContain('Employee types and configuration');
});
test('an edit reports the fields that changed, and the code cannot change', async () => {
  const call = await as('admin'), t = typeByCode(heldType());
  const out = updateEmployeeType.response.parse((await call('PATCH', `${BASE}/${t.id}`, { mode: 'grid', capabilities: ['shift', 'site'] }, t.version)).body);
  expect(out.changed.sort()).toEqual(['capabilities', 'mode']);
  expect(audits().find(a => a.id === out.auditId)?.act).toBe('Employee type edited');
  const fresh = typeByCode(heldType());
  const r = await call('PATCH', `${BASE}/${fresh.id}`, { code: 'renamed' }, fresh.version);
  expect(r.status).toBe(422);
  expect(Refusal.parse(r.body).field).toBe('code');
});
test('a stale version is refused with 412', async () => {
  const t = typeByCode(heldType());
  expect((await (await as('admin'))('PATCH', `${BASE}/${t.id}`, { name: 'x' }, t.version + 2)).status).toBe(412);
});
test('ET It can be removed once nobody holds it', async () => {
  const call = await as('admin');
  await call('POST', BASE, sample);
  const t = typeByCode('waking_night');
  const r = await call('DELETE', `${BASE}/${t.id}`, undefined, t.version);
  expect(r.status).toBe(200);
  expect(audits().find(a => a.id === removeEmployeeType.response.parse(r.body).auditId)?.act).toBe('Employee type removed');
  expect(store.coll('employeeTypes')[t.id]).toBeUndefined();
});
test('ET Removing a type people hold is refused, and names them', async () => {
  const call = await as('admin'), t = typeByCode(heldType()), before = snapshot(...WRITES, 'people');
  const r = await call('DELETE', `${BASE}/${t.id}`, undefined, t.version);
  expect(r.status).toBe(409);
  expect(Refusal.parse(r.body)).toMatchObject({ code: 'in-use', usedBy: [expect.objectContaining({ kind: 'people' })] });
  expect(snapshot(...WRITES, 'people')).toEqual(before);
});
test('the last type cannot be removed', async () => {
  const types = store.coll<{ id: string; code: string }>('employeeTypes');
  for (const t of Object.values(types).slice(1)) Reflect.deleteProperty(types, t.id);
  const only = Object.values(types)[0];
  if (!only) throw new Error('no types');
  for (const p of Object.values(store.coll<{ employeeType: string }>('people'))) p.employeeType = 'nobody_holds_this';
  const t = typeByCode(only.code);
  const r = await (await as('admin'))('DELETE', `${BASE}/${t.id}`, undefined, t.version);
  expect(r.status).toBe(409);
  expect(Refusal.parse(r.body).code).toBe('last-type');
});
test('a fault on create, edit or remove leaves the store unchanged', async () => {
  const call = await as('admin'), t = typeByCode(heldType()), before = snapshot(...WRITES);
  await fault('POST', BASE); expect((await call('POST', BASE, sample)).status).toBe(500);
  await fault('PATCH', `${BASE}/${t.id}`); expect((await call('PATCH', `${BASE}/${t.id}`, { name: 'x' }, t.version)).status).toBe(500);
  await fault('DELETE', `${BASE}/${t.id}`); expect((await call('DELETE', `${BASE}/${t.id}`, undefined, t.version)).status).toBe(500);
  expect(snapshot(...WRITES)).toEqual(before);
});

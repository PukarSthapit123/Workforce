import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { DIMENSIONS, DIMENSION_KINDS, type DimensionKind } from '@/contract/dimensions';
import { audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));
const as = async (p: Persona) => caller(await tokenFor(p));

const COLLECTION: Record<DimensionKind, string> = { locations: 'locations', departments: 'departments', 'cost-centres': 'costCentres', 'job-profiles': 'jobProfiles', projects: 'projects' };
const LABEL: Record<DimensionKind, string> = { locations: 'Location', departments: 'Department', 'cost-centres': 'Cost centre', 'job-profiles': 'Job profile', projects: 'Project' };
const SAMPLE: Record<DimensionKind, Record<string, unknown>> = {
  locations: { code: 'tq', name: 'Test Quay', area: 'Docklands', department: 'CARE', costCentre: 'WH-CAM-01', level: 'Low', minPerShift: 2, manager: '', address: '', active: true },
  departments: { code: 'TST', name: 'Testing', manager: '' },
  'cost-centres': { code: 'CC-999', name: 'Test centre' },
  'job-profiles': { code: 'TJ', name: 'Test job', night: true },
  projects: { code: 'PRJ-999', name: 'Test project', client: '', costCentre: 'CC-220', manager: '', status: 'Active', start: '', end: '', budgetHours: '', billable: false, location: '' },
};
/* a seed code each dimension uses; projects have no users until sub-project 2 */
const IN_USE: Record<DimensionKind, string | null> = { locations: 'WH', departments: 'CARE', 'cost-centres': 'WH-CAM-01', 'job-profiles': 'SW', projects: null };
const rowByCode = (kind: DimensionKind, code: string) => {
  const r = Object.values(store.coll<{ id: string; version: number; code: string }>(COLLECTION[kind])).find(x => x.code === code);
  if (!r) throw new Error(`no ${kind} ${code}`);
  return r;
};

for (const kind of DIMENSION_KINDS) {
  const ep = DIMENSIONS[kind].api, base = `/api/v1/${kind}`, writes = [COLLECTION[kind], 'audit'];
  describe(kind, () => {
    test('the list parses, carries in-use counts, and needs only a session', async () => {
      const r = await (await as('employee'))('GET', base);
      expect(r.status).toBe(200);
      const list = ep.list.response.parse(r.body) as { code: string; inUse: number }[];
      expect(list.length).toBeGreaterThan(0);
      const used = IN_USE[kind];
      if (used) expect(list.find(x => x.code === used)?.inUse).toBeGreaterThan(0);
    });
    test('a valid entry is created, upper-cased, and audited', async () => {
      const r = await (await as('admin'))('POST', base, SAMPLE[kind]);
      expect(r.status).toBe(200);
      const { record, auditId } = ep.create.response.parse(r.body) as { record: { code: string; version: number }; auditId: string };
      expect(record.code).toBe(String(SAMPLE[kind].code).toUpperCase());
      expect(record.version).toBe(1);
      expect(audits().find(a => a.id === auditId)?.act).toBe(`${LABEL[kind]} created`);
    });
    test('a duplicate code is refused whatever its case, and nothing is written', async () => {
      const existing = Object.values(store.coll<{ code: string }>(COLLECTION[kind]))[0];
      if (!existing) throw new Error(`no ${kind} in the seed`);
      const call = await as('admin'), before = snapshot(...writes);
      const r = await call('POST', base, { ...SAMPLE[kind], code: existing.code.toLowerCase() });
      expect(r.status).toBe(422);
      expect(Refusal.parse(r.body)).toMatchObject({ field: 'code', message: expect.stringContaining('already exists') });
      expect(snapshot(...writes)).toEqual(before);
    });
    test('a name is required', async () => {
      const r = await (await as('admin'))('POST', base, { ...SAMPLE[kind], name: ' ' });
      expect(r.status).toBe(422);
      expect(Refusal.parse(r.body).field).toBe('name');
    });
    test('a manager is refused, naming the capability', async () => {
      const call = await as('manager'), before = snapshot(...writes);
      const r = await call('POST', base, SAMPLE[kind]);
      expect(r.status).toBe(403);
      expect(Refusal.parse(r.body).message).toContain('Workforce master data');
      expect(snapshot(...writes)).toEqual(before);
    });
    test('an edit reports the fields that changed and is audited as a diff', async () => {
      const call = await as('admin');
      await call('POST', base, SAMPLE[kind]);
      const row = rowByCode(kind, String(SAMPLE[kind].code).toUpperCase());
      const r = await call('PATCH', `${base}/${row.id}`, { name: 'Renamed' }, row.version);
      const out = ep.update.response.parse(r.body) as { changed: string[]; auditId: string; record: { version: number } };
      expect(out.changed).toEqual(['name']);
      expect(out.record.version).toBe(row.version + 1);
      expect(audits().find(a => a.id === out.auditId)).toMatchObject({ act: `${LABEL[kind]} edited`, after: { name: 'Renamed' } });
    });
    test('the code is locked once it exists', async () => {
      const row = Object.values(store.coll<{ id: string; version: number }>(COLLECTION[kind]))[0];
      if (!row) throw new Error(`no ${kind}`);
      const r = await (await as('admin'))('PATCH', `${base}/${row.id}`, { code: 'NEWCODE' }, row.version);
      expect(r.status).toBe(422);
      expect(Refusal.parse(r.body)).toMatchObject({ field: 'code', message: expect.stringContaining('cannot change') });
    });
    test('a stale version is refused with 412', async () => {
      const row = Object.values(store.coll<{ id: string; version: number }>(COLLECTION[kind]))[0];
      if (!row) throw new Error(`no ${kind}`);
      expect((await (await as('admin'))('PATCH', `${base}/${row.id}`, { name: 'x' }, row.version + 3)).status).toBe(412);
    });
    test('an unused entry can be removed, and is audited', async () => {
      const call = await as('admin');
      await call('POST', base, SAMPLE[kind]);
      const row = rowByCode(kind, String(SAMPLE[kind].code).toUpperCase());
      const r = await call('DELETE', `${base}/${row.id}`, undefined, row.version);
      expect(r.status).toBe(200);
      const { auditId } = ep.remove.response.parse(r.body) as { auditId: string };
      expect(store.coll(COLLECTION[kind])[row.id]).toBeUndefined();
      expect(audits().find(a => a.id === auditId)?.act).toBe(`${LABEL[kind]} removed`);
    });
    const used = IN_USE[kind];
    if (used) test('an entry in use cannot be removed, and the refusal says what uses it', async () => {
      const call = await as('admin'), row = rowByCode(kind, used), before = snapshot(...writes);
      const r = await call('DELETE', `${base}/${row.id}`, undefined, row.version);
      expect(r.status).toBe(409);
      const refusal = Refusal.parse(r.body);
      expect(refusal.code).toBe('in-use');
      expect(refusal.message).toMatch(new RegExp(`^${used} is used by \\d+`));
      expect(refusal.usedBy?.[0]?.examples.length).toBeGreaterThan(0);
      expect(snapshot(...writes)).toEqual(before);
    });
    test('a fault on create, edit or remove leaves the store unchanged', async () => {
      const row = Object.values(store.coll<{ id: string; version: number }>(COLLECTION[kind]))[0];
      if (!row) throw new Error(`no ${kind}`);
      const call = await as('admin'), before = snapshot(...writes);
      await fault('POST', base);
      expect((await call('POST', base, SAMPLE[kind])).status).toBe(500);
      await fault('PATCH', `${base}/${row.id}`);
      expect((await call('PATCH', `${base}/${row.id}`, { name: 'x' }, row.version)).status).toBe(500);
      await fault('DELETE', `${base}/${row.id}`);
      expect((await call('DELETE', `${base}/${row.id}`, undefined, row.version)).status).toBe(500);
      expect(snapshot(...writes)).toEqual(before);
    });
  });
}

test('a location must point at a department and cost centre that exist', async () => {
  const r = await (await as('admin'))('POST', '/api/v1/locations', { ...SAMPLE.locations, department: 'NOPE' });
  expect(r.status).toBe(422);
  expect(Refusal.parse(r.body)).toMatchObject({ field: 'department', message: 'There is no department with the code NOPE.' });
});
test('a location\'s refusal names both the people and the projects at it', async () => {
  const row = rowByCode('locations', 'WH');
  const r = await (await as('admin'))('DELETE', `/api/v1/locations/${row.id}`, undefined, row.version);
  expect(Refusal.parse(r.body).usedBy?.map(u => u.kind)).toEqual(['people', 'projects']);
});

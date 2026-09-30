import social from './social.json';
import qnipay from './qnipay.json';
import meta from './meta.json';
import { PERSON_STATES } from '@/domain/lifecycle';
import { DIMENSION_CODE, EMPLOYEE_CODE, TYPE_CODE } from '@/domain/codes';
import { SELF_FIELDS } from '@/domain/selfService';

type Rec = Record<string, unknown> & { id: string; code?: string };
interface SeedFile { data: Record<string, Record<string, Rec>> }
const vals = (s: SeedFile, c: string) => Object.values(s.data[c] ?? {});
const codes = (s: SeedFile, c: string) => new Set<unknown>(vals(s, c).map(r => r.code));
const ISO_OR_BLANK = /^(\d{4}-\d{2}-\d{2})?$/;
const PERSON_KEYS = ['code', 'name', 'email', 'phone', 'address', 'emergencyName', 'emergencyPhone', 'bankAccount', 'bankSortCode',
  'jobProfile', 'employeeType', 'category', 'location', 'department', 'manager', 'contractedHours', 'maxHours', 'night',
  'resource', 'cis', 'state', 'start', 'end'];

for (const [name, raw] of Object.entries({ social, qnipay })) {
  const seed = raw as unknown as SeedFile;
  describe(`seed ${name} for plan 1b`, () => {
    test('every person is in one of the seven states', () => {
      expect(vals(seed, 'people').filter(p => !(PERSON_STATES as readonly unknown[]).includes(p.state)).map(p => p.code)).toEqual([]);
    });
    test('every person carries the self-service, contract and Business Central fields', () => {
      for (const p of vals(seed, 'people')) expect(Object.keys(p).filter(k => PERSON_KEYS.includes(k)).sort(), String(p.code)).toEqual([...PERSON_KEYS].sort());
    });
    test('every person points at a location, type, department and job profile that exist', () => {
      const locs = codes(seed, 'locations'), types = codes(seed, 'employeeTypes'), deps = codes(seed, 'departments'), jobs = codes(seed, 'jobProfiles');
      const broken = vals(seed, 'people').filter(p => !locs.has(p.location) || !types.has(p.employeeType)
        || (p.department !== '' && !deps.has(p.department)) || (p.jobProfile !== '' && !jobs.has(p.jobProfile)));
      expect(broken.map(p => `${String(p.code)}: ${String(p.location)}/${String(p.employeeType)}/${String(p.department)}/${String(p.jobProfile)}`)).toEqual([]);
    });
    test('dates are ISO or empty', () => {
      for (const c of ['people', 'projects']) for (const r of vals(seed, c)) {
        expect(String(r.start), `${c} ${String(r.code)} start`).toMatch(ISO_OR_BLANK);
        expect(String(r.end), `${c} ${String(r.code)} end`).toMatch(ISO_OR_BLANK);
      }
    });
    test('employee IDs, dimension codes and type codes are well formed', () => {
      expect(vals(seed, 'people').map(p => String(p.code)).filter(c => !EMPLOYEE_CODE.test(c))).toEqual([]);
      for (const c of ['locations', 'departments', 'costCentres', 'jobProfiles', 'projects'])
        expect(vals(seed, c).map(r => String(r.code)).filter(x => !DIMENSION_CODE.test(x)), c).toEqual([]);
      expect(vals(seed, 'employeeTypes').map(r => String(r.code)).filter(c => !TYPE_CODE.test(c))).toEqual([]);
    });
    test('employee types carry name, category, entry mode, pay basis and capabilities', () => {
      expect(vals(seed, 'employeeTypes').length).toBeGreaterThan(0);
      for (const t of vals(seed, 'employeeTypes')) {
        expect(['Contracted', 'Bank', 'Agency', 'Salaried'], String(t.code)).toContain(t.category);
        expect(['form', 'grid', 'clock'], String(t.code)).toContain(t.mode);
        expect(['hour', 'day'], String(t.code)).toContain(t.uom);
        expect(Array.isArray(t.capabilities), String(t.code)).toBe(true);
      }
    });
    test('locations use the contract\'s field names', () => {
      for (const l of vals(seed, 'locations')) {
        expect(l, String(l.code)).toHaveProperty('costCentre');
        expect(l, String(l.code)).toHaveProperty('minPerShift');
        expect(l, String(l.code)).not.toHaveProperty('cc');
      }
    });
    test('projects carry budget hours as text, and no field called budget', () => {
      for (const p of vals(seed, 'projects')) {
        expect(p, String(p.code)).not.toHaveProperty('budget');
        expect(typeof p.budgetHours, String(p.code)).toBe('string');
      }
    });
    test('bank_verify exists, and only the admin template holds it', () => {
      expect(seed.data.capabilities?.bank_verify).toMatchObject({ group: 'team', label: 'Verify bank detail changes' });
      const holders = vals(seed, 'userTypes').filter(u => (u.capabilities as string[]).includes('bank_verify')).map(u => u.id);
      expect(holders).toEqual(['admin']);
    });
    test('person history starts empty', () => {
      expect(vals(seed, 'personHistory')).toEqual([]);
    });
  });
}

test('social carries the prototype\'s two pending profile changes', () => {
  const pc = vals(social as unknown as SeedFile, 'profileChanges');
  expect(pc.map(c => [c.personCode, c.field, c.status, c.stage]).sort()).toEqual([
    ['CP-1088', 'phone', 'pending', 'manager'], ['CP-1201', 'address', 'pending', 'manager']]);
  for (const c of pc) expect(c.route).toEqual(['manager']);
});
test("each seeded profile change starts from the person's current value", () => {
  const s = social as unknown as SeedFile;
  for (const c of vals(s, 'profileChanges')) {
    const p = vals(s, 'people').find(x => x.code === c.personCode);
    expect(p?.[String(c.field)], String(c.id)).toBe(c.from);
  }
});
test('meta carries support levels, archetypes, type capabilities and the self-service fields', () => {
  expect(meta.supportLevels.map((l: { code: string }) => l.code)).toEqual(['High', 'Medium', 'Low', 'Floating']);
  expect(meta.typeArchetypes.length).toBeGreaterThan(2);
  expect(meta.typeCapabilities.map((c: { code: string }) => c.code)).toEqual(['vehicle', 'site', 'project', 'shift']);
  expect(meta.selfFields.map((f: { label: string }) => f.label)).toEqual(SELF_FIELDS.map(f => f.label));
});

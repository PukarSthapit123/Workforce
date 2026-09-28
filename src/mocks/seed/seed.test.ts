import social from './social.json';
import qnipay from './qnipay.json';
import meta from './meta.json';

type Rec = Record<string, unknown> & { id: string; code?: string };
const vals = (s: { data: Record<string, Record<string, Rec>> }, c: string) => Object.values(s.data[c] ?? {});

for (const [name, seed] of Object.entries({ social, qnipay }) as [string, { tenant: string; data: Record<string, Record<string, Rec>> }][]) {
  describe(`seed ${name}`, () => {
    test('has people, accounts, user types, capabilities and a tenant', () => {
      for (const c of ['people', 'accounts', 'userTypes', 'capabilities', 'locations', 'departments'])
        expect(vals(seed, c).length, c).toBeGreaterThan(0);
      expect(seed.data.tenant?.tenant).toBeDefined();
    });
    test('every record has id, version and updatedAt', () => {
      for (const [c, recs] of Object.entries(seed.data)) for (const r of Object.values(recs))
        expect(r.id && typeof r.version === 'number' && typeof r.updatedAt === 'string', `${c}/${r.id}`).toBe(true);
    });
    test('codes are unique within each dimension', () => {
      for (const c of ['people', 'locations', 'departments', 'costCentres', 'jobProfiles', 'projects']) {
        const codes = vals(seed, c).map(r => r.code);
        expect(new Set(codes).size, c).toBe(codes.length);
      }
    });
    test('every person sits in a location that exists, and every account in a person that exists', () => {
      const locs = new Set(vals(seed, 'locations').map(l => l.code));
      const people = new Set(vals(seed, 'people').map(p => p.code));
      expect(vals(seed, 'people').filter(p => p.location && !locs.has(p.location as string)).map(p => p.code)).toEqual([]);
      expect(vals(seed, 'accounts').filter(a => !people.has(a.personCode as string)).map(a => a.email)).toEqual([]);
    });
    test('at least one account of each user type exists', () => {
      const types = new Set(vals(seed, 'accounts').map(a => a.userType));
      expect([...types].sort()).toEqual(['admin', 'employee', 'manager']);
    });
  });
}
test('meta carries flags, modules and the lifecycle', () => {
  expect(meta.flags.length).toBeGreaterThan(30);
  expect(meta.modules.map((m: { code: string }) => m.code)).toContain('CORE');
  expect(Object.keys(meta.empStates)).toEqual(['candidate', 'preboard', 'active', 'suspended', 'onleave', 'leaver', 'archived']);
});

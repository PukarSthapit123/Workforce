import social from './social.json';
import qnipay from './qnipay.json';
import { Company, FinancialYear, BankHoliday } from '@/contract/tenant';
import { EXTRA_BOUNDS, FLAGS, SWITCH_CODES, moduleLive, moduleBy } from '@/domain/modules';

interface TenantSeed {
  modules: Record<string, boolean>; flags: Record<string, boolean>; company: unknown; financialYear: unknown; weekStart: string;
  bankHolidays: unknown[]; extras: { breaksMax: number; vehiclesMax: number }; restore: Record<string, string[]>;
}
interface SeedFile { data: Record<string, Record<string, unknown>> }
const tenantOf = (s: SeedFile) => s.data.tenant?.tenant as TenantSeed;

for (const [name, raw] of Object.entries({ social, qnipay })) {
  const seed = raw as unknown as SeedFile, t = tenantOf(seed);
  describe(`seed ${name} for 1c`, () => {
    test('company details parse, and carry no currency (no money)', () => {
      expect(Company.parse(t.company)).toBeTruthy();
      expect(JSON.stringify(t.company)).not.toMatch(/currency|£|€|\$/i);
    });
    test('the financial year is the prototype\'s 2026/27, and agrees with Leave\'s year start', () => {
      expect(FinancialYear.parse(t.financialYear)).toEqual({ start: '2026-04-01', end: '2027-03-31', label: '2026/27' });
      const leave = seed.data.leaveConfig?.leaveConfig as { finYearStart: string };
      expect(leave.finYearStart).toBe('01/04');
    });
    test('the week starts on Monday and the bank holidays are the prototype\'s, as ISO dates in order', () => {
      expect(t.weekStart).toBe('Monday');
      expect(t.bankHolidays.map(b => BankHoliday.parse(b))).toEqual([
        { date: '2026-08-31', name: 'Summer bank holiday' }, { date: '2026-12-25', name: 'Christmas Day' }, { date: '2026-12-28', name: 'Boxing Day' }]);
    });
    test('every switch the catalogue knows is seeded, Workforce core is on and Timesheet is live', () => {
      expect(Object.keys(t.modules).sort()).toEqual([...SWITCH_CODES].sort());
      expect(t.modules.CORE).toBe(true);
      const ts = moduleBy('TS');
      expect(ts && moduleLive(t.modules, ts)).toBe(true);
      expect(Object.keys(t.flags).sort()).toEqual(FLAGS.map(f => f.code).sort());
    });
    test('feature extras sit inside their bounds, and nothing is remembered to restore yet', () => {
      expect(t.extras.breaksMax).toBeGreaterThanOrEqual(EXTRA_BOUNDS.breaksMax.min);
      expect(t.extras.breaksMax).toBeLessThanOrEqual(EXTRA_BOUNDS.breaksMax.max);
      expect(t.extras.vehiclesMax).toBeGreaterThanOrEqual(EXTRA_BOUNDS.vehiclesMax.min);
      expect(t.extras.vehiclesMax).toBeLessThanOrEqual(EXTRA_BOUNDS.vehiclesMax.max);
      expect(t.restore).toEqual({});
      expect(seed.data.rotaSetAside ?? {}).toEqual({});
    });
    test('the weekly grid and the rota horizon are not repeated on the tenant (one home each, D6)', () => {
      expect(t).not.toHaveProperty('weekGrid');
      expect(t).not.toHaveProperty('weekLayout');
      expect(t).not.toHaveProperty('rotaHorizon');
      expect(seed.data.timesheetConfig?.timesheetConfig).toMatchObject({ weekGrid: expect.any(String), weekLayout: expect.any(String) });
    });
  });
}
test('social runs Rota and holds its horizon on Rota setup; qnipay has none and reads the default', () => {
  expect((social as unknown as SeedFile).data.rotaConfig?.rotaConfig).toMatchObject({ horizon: 12 });
  expect((qnipay as unknown as SeedFile).data.rotaConfig).toBeUndefined();
});
test('social carries the prototype\'s delegation by employee code (D8); qnipay has none; no chain is seeded', () => {
  expect((social as unknown as SeedFile).data.delegations).toEqual({ dlg_1: { id: 'dlg_1', version: 1, updatedAt: '2026-08-13T14:30:00.000Z',
    who: 'CP-1001', to: 'CP-1002', from: '2026-08-24', until: '2026-08-31', modules: ['Timesheet', 'Leave'] } });
  expect((qnipay as unknown as SeedFile).data.delegations).toEqual({});
  for (const s of [social, qnipay]) expect((s as unknown as SeedFile).data.approvalChains).toBeUndefined();
});

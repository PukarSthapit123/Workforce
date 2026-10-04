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
test('both tenants carry the prototype\'s four notices with textVersion, ISO stamps and acknowledgements by employee code (D10)', () => {
  for (const raw of [social, qnipay]) {
    const seed = raw as unknown as SeedFile;
    const notices = Object.values(seed.data.notices ?? {}) as { id: string; textVersion: number; at: string; acks: { personCode: string; textVersion: number; at: string }[]; history: { textVersion: number }[] }[];
    const codes = new Set(Object.values(seed.data.people ?? {}).map(p => (p as { code: string }).code));
    expect(notices.map(n => n.id)).toEqual(['NTC-0001', 'NTC-0002', 'NTC-0003', 'NTC-0004']);
    expect(notices.map(n => n.textVersion)).toEqual([2, 1, 1, 1]);
    expect(notices.flatMap(n => [n.at, ...n.acks.map(a => a.at)]).every(at => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(at))).toBe(true);
    expect(notices.flatMap(n => n.acks).every(a => codes.has(a.personCode))).toBe(true);
    expect(notices[0]?.history.map(h => h.textVersion)).toEqual([1]);
  }
});
test('each tenant carries the prototype\'s seven documents for its first employee account, with ISO dates, and the three payroll documents (D12)', () => {
  for (const [raw, owner] of [[social, 'CP-1042'], [qnipay, 'EMP002']] as const) {
    const seed = raw as unknown as SeedFile;
    const docs = Object.values(seed.data.documents ?? {}) as { personCode: string; name: string; date: string; source: string }[];
    expect(docs.map(d => d.name)).toEqual(['Contract of employment', 'Job description · Support Worker', 'DBS certificate', 'Safeguarding L2 certificate',
      'Medication competency', 'Working time opt-out', 'Annual leave statement 2026/27']);
    expect(docs.every(d => d.personCode === owner && /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    expect(Object.values(seed.data.payrollDocuments ?? {}).map(d => (d as { name: string }).name)).toEqual(['Payslips', 'P60 · 2025/26', 'P45']);
    expect(JSON.stringify(seed.data.payrollDocuments)).not.toMatch(/£|amount|brateb/i);
  }
});

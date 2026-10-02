import social from './social.json';
import qnipay from './qnipay.json';
import meta from './meta.json';
import {
  RATE_TRIGGERS, TS_STATES, WEEK_GRIDS, WEEK_LAYOUTS, clockFromIso, entryMinutes, tsCan, validateTimes, weekLabel, weekTotals,
  type CaptureRules, type TimeEntry, type TimeFormat,
} from '@/domain/timesheet';

type Rec = Record<string, unknown> & { id: string };
interface SeedFile { data: Record<string, Record<string, Rec>> }
interface Day extends Rec {
  personCode: string; date: string; state: string; entries: TimeEntry[]; captureSource: string; enteredBy: string;
  history: { from: string; to: string; by: { personCode: string } }[]; returnReason: string; integrationAttemptId: string;
}
interface Config extends Rec {
  rules: CaptureRules; cutoff: string; timeFormat: TimeFormat; weekGrid: string; weekLayout: string;
  types: Record<string, { fields: Record<string, unknown>; allowances: string[]; rules: { when: string; value: string }[]; overtime: unknown }>;
  allowances: Record<string, Rec>;
}
const vals = <T = Rec>(s: SeedFile, c: string) => Object.values(s.data[c] ?? {}) as T[];
const configOf = (s: SeedFile) => s.data.timesheetConfig?.timesheetConfig as Config;
/* The prototype's frozen clock: 13/08/2026 09:12 London. */
const NOW = clockFromIso('2026-08-13T08:12:00.000Z');

for (const [name, raw] of Object.entries({ social, qnipay })) {
  const seed = raw as unknown as SeedFile;
  describe(`seed ${name} for module 2`, () => {
    test('every timesheet day belongs to a person, is in a known state and has a history that got it there', () => {
      const people = new Set(vals(seed, 'people').map(p => p.code));
      for (const d of vals<Day>(seed, 'timesheetDays')) {
        expect(people.has(d.personCode) && people.has(d.enteredBy), d.id).toBe(true);
        expect(TS_STATES as readonly string[], d.id).toContain(d.state);
        expect(d.id).toBe(`tsd_${d.personCode}_${d.date}`);
        let at = 'draft';
        for (const h of d.history) { expect(h.from, d.id).toBe(at); expect(tsCan(h.from, h.to), d.id).toBe(true); at = h.to; }
        expect(at, d.id).toBe(d.state);
      }
    });
    test('the submitted days pass the capture rules at the frozen clock, so a seeded day is never one the server would refuse', () => {
      const cfg = configOf(seed);
      for (const d of vals<Day>(seed, 'timesheetDays').filter(x => x.state !== 'draft')) for (const e of d.entries)
        expect(validateTimes(e, { date: d.date, now: NOW, rules: cfg.rules, cutoff: cfg.cutoff, timeFormat: cfg.timeFormat }).errors, d.id).toEqual([]);
    });
    test('the six submissions keep the prototype\'s states, hours, proxy flag and return reason', () => {
      const subs = vals<Day>(seed, 'timesheetDays').filter(d => d.state !== 'draft');
      expect(subs.map(d => [d.date, d.state, entryMinutes(d.entries[0] ?? { start: '', finish: '', breaks: [] })])).toEqual([
        ['2026-08-12', 'pend', 450], ['2026-08-11', 'pend', 540], ['2026-08-10', 'pend', 570],
        ['2026-08-10', 'ok', 450], ['2026-08-12', 'ok', 450], ['2026-08-10', 'back', 450]]);
      const back = subs[5];
      expect(back?.captureSource).toBe('proxy');
      expect(back?.returnReason).toBe('Break times missing. Please add and resubmit.');
      expect(subs.filter(d => d.captureSource === 'proxy')).toHaveLength(1);
    });
    test('approved days carry a posted attempt, and one failed attempt waits for a retry', () => {
      const attempts = seed.data.integrationAttempts ?? {};
      for (const d of vals<Day>(seed, 'timesheetDays').filter(x => x.state === 'ok'))
        expect(attempts[d.integrationAttemptId], d.id).toMatchObject({ state: 'posted', attempt: 1, dayId: d.id });
      expect(vals(seed, 'integrationAttempts').filter(a => a.state === 'failed')).toEqual([
        expect.objectContaining({ id: 'int_a1f3', attempt: 1, cause: 'Line 2: unknown cost centre CC-991' })]);
    });
    test('the multi-week catch-up is two past weeks in draft, as days', () => {
      const drafts = vals<Day>(seed, 'timesheetDays').filter(d => d.state === 'draft');
      const owner = drafts[0]?.personCode ?? '';
      expect(drafts.every(d => d.personCode === owner)).toBe(true);
      const total = (ws: string) => weekTotals(ws, drafts.map(d => ({ date: d.date, entries: d.entries }))).weekMinutes;
      expect([weekLabel('2026-08-03'), total('2026-08-03')]).toEqual(['Week 32 · 03–09 Aug 2026', 2250]);
      expect([weekLabel('2026-07-27'), total('2026-07-27')]).toEqual(['Week 31 · 27 Jul – 02 Aug 2026', 1800]);
    });
    test('timesheet config: capture rules, a capture entry per employee type, and the weekly layout', () => {
      const cfg = configOf(seed);
      expect(Object.keys(cfg.rules).sort()).toEqual(['blockFuture', 'enforceLock', 'enforceRest', 'maxDaily', 'minNet', 'nightFrom', 'nightTo',
        'otDaily', 'otWeekly', 'varianceWarn', 'warnDaily']);
      expect(cfg.cutoff).toMatch(/^(Sunday|Monday|Tuesday|Wednesday|Thursday) \d{2}:\d{2}$/);
      expect(WEEK_GRIDS as readonly string[]).toContain(cfg.weekGrid);
      expect(WEEK_LAYOUTS as readonly string[]).toContain(cfg.weekLayout);
      expect(Object.keys(cfg.types).sort()).toEqual(vals(seed, 'employeeTypes').map(t => t.code).sort());
      for (const [k, t] of Object.entries(cfg.types)) {
        for (const r of t.rules) expect(r.when === '' || Object.hasOwn(RATE_TRIGGERS, r.when), k).toBe(true);
        const uom = vals(seed, 'employeeTypes').find(x => x.code === k)?.uom;
        expect(t.overtime === null, k).toBe(uom === 'day');
      }
    });
    test('no money: no allowance amount, no flat pay code value, no expenses field and no pound sign anywhere', () => {
      const cfg = configOf(seed);
      for (const a of Object.values(cfg.allowances)) expect(Object.keys(a).sort()).toEqual(['basis', 'code', 'element', 'label', 'payCode', 'tier']);
      for (const p of vals(seed, 'payCodes')) if (p.basis === 'flat') expect(p.value, String(p.code)).toBe('');
      expect(Object.keys(cfg.types).filter(k => Object.hasOwn(cfg.types[k]?.fields ?? {}, 'expenses'))).toEqual([]);
      const text = JSON.stringify([seed.data.timesheetConfig, seed.data.payCodes, seed.data.timesheetDays, seed.data.integrationAttempts]);
      expect(text).not.toMatch(/£|"amt"/);
    });
  });
}

test('qnipay maps the six submissions to Manish Nepal\'s six active reports at his location (D10)', () => {
  const s = qnipay as unknown as SeedFile;
  const subs = vals<Day>(s, 'timesheetDays').filter(d => d.state !== 'draft');
  expect(subs.map(d => d.personCode)).toEqual(['EMP004', 'EMP005', 'EMP007', 'EMP009', 'EMP010', 'EMP011']);
  expect(subs[5]?.enteredBy).toBe('EMP014');
  expect(subs.flatMap(d => d.history.slice(1).map(h => h.by.personCode))).toEqual(['EMP014', 'EMP014', 'EMP014']);
});
test('meta carries the capture field catalogue without money, and the repeating groups', () => {
  const fields = meta.timesheetFields as { c: string; cat: string }[];
  expect(fields.map(f => f.c)).toContain('break_s5');
  expect(fields.map(f => f.c)).not.toContain('expenses');
  expect(JSON.stringify(fields)).not.toMatch(/£|"amt"/);
  expect(meta.timesheetRepeats).toEqual({ vehicle: { name: 'Vehicles & movements', max: 4, unit: 'vehicle' }, breaks: { name: 'Breaks', max: 5, unit: 'break' } });
});

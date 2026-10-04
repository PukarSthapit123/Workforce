import social from './social.json';
import qnipay from './qnipay.json';
import {
  absenceCellPlan, balanceOf, bookedLeaveDates, bradford, datesCellPlan, entitlement, isLeaveState, latestAbsenceText, leaveCan, leaveConfigProblem,
  leaveYear, monthsWorked, nextStepText, policyBy, reconcileLeaver, requestDays, requestProblem, sicknessDates, slaOf, typeLeaveFor,
  type LeaveBase, type LeaveConfig, type LeavePolicy, type LeaveRecord, type LeaveStage, type LeaveType, type LedgerRow, type SickEpisode, type TypeLeave,
} from '@/domain/leave';

type Rec = Record<string, unknown> & { id: string };
interface SeedFile { data: Record<string, Record<string, Rec>> }
interface Person extends Rec { code: string; name: string; location: string; state: string; contractedHours: number; start: string; employeeType: string }
type Request = Rec & LeaveRecord & { personCode: string; raisedAt: string; escalated: boolean; decidedBy: { personCode: string } | null;
  history: { from: string; to: string; by: { personCode: string } }[] };
type Config = Rec & LeaveConfig & { types: LeaveType[]; policies: LeavePolicy[]; stages: LeaveStage[]; typeLeave: Record<string, TypeLeave> };
interface Week extends Rec { location: string; weekStart: string; lines: Record<string, string[]> }
const TODAY = '2026-08-13';
const vals = <T = Rec>(s: SeedFile, c: string) => Object.values(s.data[c] ?? {}) as T[];
const LEAVE = ['leaveConfig', 'leaveRequests', 'leaveLedger', 'leaveBases', 'leavers', 'sickEpisodes'];

function world(seed: SeedFile) {
  const people = new Map(vals<Person>(seed, 'people').map(p => [p.code, p]));
  const cfg = seed.data.leaveConfig?.leaveConfig as Config;
  const requests = vals<Request>(seed, 'leaveRequests'), ledger = vals<Rec & LedgerRow & { personCode: string }>(seed, 'leaveLedger');
  const bases = new Map(vals<Rec & LeaveBase & { personCode: string }>(seed, 'leaveBases').map(b => [b.personCode, b]));
  const episodes = vals<Rec & SickEpisode>(seed, 'sickEpisodes');
  const leavers = vals<Rec & { personCode: string; leaveDate: string }>(seed, 'leavers');
  const must = <T>(v: T | undefined, what: string): T => { if (v === undefined) throw new Error(`missing ${what}`); return v; };
  const policyOf = (p: Person) => must(policyBy(cfg.policies, typeLeaveFor(cfg.typeLeave, p.employeeType).policy), 'policy');
  const balance = (p: Person, reqs: readonly LeaveRecord[] = requests.filter(r => r.personCode === p.code)) => {
    const base = must(bases.get(p.code), `base for ${p.code}`);
    const ent = entitlement({ contractedHours: p.contractedHours, start: p.start, accruedHours: base.accruedHours }, policyOf(p), TODAY);
    return balanceOf({ ent, base, contractedHours: p.contractedHours, requests: reqs, ledger: ledger.filter(l => l.personCode === p.code), today: TODAY, finYearStart: cfg.finYearStart });
  };
  return { people, cfg, requests, ledger, bases, episodes, leavers, balance, policyOf, must };
}

for (const [name, raw] of Object.entries({ social, qnipay })) {
  const seed = raw as unknown as SeedFile, w = world(seed);
  describe(`seed ${name} for module 4`, () => {
    test('the leave setup passes its own check and keeps the prototype\'s types, policies and four stages', () => {
      const types = vals<Rec & { code: string }>(seed, 'employeeTypes').map(t => t.code);
      expect(leaveConfigProblem(w.cfg, w.cfg.types, w.cfg.policies, w.cfg.stages, w.cfg.typeLeave, types)).toBeNull();
      expect(w.cfg.types.map(t => t.code)).toEqual(['AL', 'TOIL', 'SICK', 'COMP', 'TRN', 'UNP', 'PAR', 'JURY']);
      expect(w.cfg.policies.map(p => p.code)).toEqual(['STD', 'ACC', 'TOIL', 'SICK', 'FIX', 'NONE', 'HRIS']);
      expect(w.cfg.stages.map(s => s.action)).toContain('Escalated. SLA breached');
      expect(Object.keys(w.cfg.typeLeave).sort()).toEqual([...types].sort());
      expect([w.cfg.slaDays, w.cfg.absenceTrigger, w.cfg.finYearStart, w.cfg.blocksTimesheet]).toEqual([5, 100, '01/04', true]);
    });
    test('every request belongs to a real person, moved there by allowed steps, and passes validation at the frozen clock', () => {
      for (const r of w.requests) {
        const p = w.people.get(r.personCode);
        expect(p, r.id).toBeDefined();
        if (!p) continue;
        expect(isLeaveState(r.state), r.id).toBe(true);
        expect(r.history[0]).toMatchObject({ from: '', to: 'pending', by: { personCode: p.code } });
        for (const h of r.history.slice(1)) expect(leaveCan(h.from, h.to), r.id).toBe(true);
        expect(r.history.at(-1)?.to, r.id).toBe(r.state);
        if (r.decidedBy) expect([w.people.has(r.decidedBy.personCode), r.decidedBy.personCode === p.code], r.id).toEqual([true, false]);
        const others = w.requests.filter(x => x.personCode === p.code && x.id !== r.id);
        const v = requestProblem(r, { types: w.cfg.types, contractedHours: p.contractedHours, checkBalance: true, leftD: w.balance(p, others).leftD });
        expect(v.ok, r.id).toBe(true);
        if (v.ok) expect([v.shape.qty, v.shape.unit], r.id).toEqual([r.qty, r.unit]);
      }
    });
    test('states, an escalated request and SLA days left as the prototype seeded them', () => {
      expect(w.requests.map(r => [r.id, r.type, r.from, r.to, r.qty, r.unit, r.state])).toEqual([
        ['lr_1', 'AL', '2026-08-24', '2026-08-28', 5, 'days', 'pending'], ['lr_2', 'TOIL', '2026-08-21', '2026-08-21', 7.5, 'hours', 'pending'],
        ['lr_3', 'AL', '2026-09-03', '2026-09-04', 2, 'days', 'pending'], ['lr_4', 'AL', '2026-08-10', '2026-08-11', 2, 'days', 'approved'],
        ['lr_5', 'AL', '2026-08-17', '2026-08-18', 2, 'days', 'approved']]);
      const sla = w.requests.filter(r => r.state === 'pending').map(r => slaOf({ raised: r.raisedAt.slice(0, 10), escalated: r.escalated }, w.cfg.slaDays, TODAY, w.cfg.stages.length));
      expect(sla.map(s => [s.daysLeft, s.escalated, s.stage])).toEqual([[0, true, 3], [3, false, 2], [4, false, 2]]);
    });
    test('every manager\'s location has a request waiting on them', () => {
      const accounts = vals<Rec & { personCode: string; userType: string }>(seed, 'accounts').filter(a => a.userType === 'manager');
      expect(accounts.length).toBeGreaterThan(0);
      for (const a of accounts) {
        const loc = w.people.get(a.personCode)?.location;
        expect(w.requests.some(r => r.state === 'pending' && r.personCode !== a.personCode && w.people.get(r.personCode)?.location === loc), a.personCode).toBe(true);
      }
    });
    test('every person has a leave base for this leave year, and no balance starts negative but the leaver\'s', () => {
      const leaving = new Set(w.leavers.map(l => l.personCode));
      for (const p of w.people.values()) {
        expect(w.bases.get(p.code)?.year, p.code).toBe(leaveYear(TODAY, w.cfg.finYearStart).label);
        const b = w.balance(p);
        if (!leaving.has(p.code)) expect([p.code, b.leftD >= 0, b.toilLeft >= 0]).toEqual([p.code, true, true]);
      }
    });
    test('each sickness spell is a dated episode of a real person, none overlapping another of theirs', () => {
      for (const e of w.episodes) {
        expect(w.people.has(e.personCode), e.id).toBe(true);
        expect(e.to >= e.from, e.id).toBe(true);
        const mine = w.episodes.filter(x => x.personCode === e.personCode && x.id !== e.id);
        expect(mine.some(x => !(x.to < e.from || x.from > e.to)), e.id).toBe(false);
      }
    });
    test('no money in any leave collection', () => {
      expect(JSON.stringify(LEAVE.map(c => seed.data[c]))).not.toMatch(/£|"rate"|"amount"|"cost"|"pay"|"salary"|"value"/i);
    });
  });
}

describe('seed social for module 4: the prototype\'s numbers', () => {
  const w = world(social as unknown as SeedFile);
  const person = (code: string) => w.must(w.people.get(code), code);
  test('derived balances match the prototype\'s stored taken and waiting days', () => {
    /* P's lv: taken and pending. Priya Shah's base is lowered to fit her pro-rata
       entitlement, and Rosa Mendes's waiting request is TOIL, which draws on the TOIL bank. */
    const p = { 'CP-1042': [9.5, 2], 'CP-1088': [15, 0], 'CP-1153': [11, 0], 'CP-1266': [6, 0], 'CP-1402': [8, 0], 'CP-1001': [12, 0], 'CP-1002': [5, 0], 'CP-1201': [9, 5] };
    for (const [code, [taken, pending]] of Object.entries(p)) expect([code, w.balance(person(code)).takenD, w.balance(person(code)).pending]).toEqual([code, taken, pending]);
    expect(w.balance(person('CP-1042'))).toMatchObject({ leftD: 13.5, toil: 6 });
    expect(w.balance(person('CP-1402'))).toMatchObject({ toil: 11.5, toilPending: 7.5, toilLeft: 4 });
    expect(w.balance(person('CP-1455'))).toMatchObject({ unit: 'hours', takenH: 7.5, leftH: 44.6 });
  });
  test('the episodes reproduce the prototype\'s spells, days and Bradford scores', () => {
    const board = (code: string) => {
      const mine = w.episodes.filter(e => e.personCode === code).sort((a, b) => a.from.localeCompare(b.from));
      const bf = bradford(mine, TODAY, w.cfg.absenceTrigger), last = mine.at(-1);
      return { ...bf, latest: last ? latestAbsenceText(last, TODAY) : '', next: nextStepText(bf.triggered, last) };
    };
    expect(board('CP-1088')).toEqual({ spells: 4, days: 7, score: 112, triggered: true, latest: '11/08/2026 · 1 day', next: 'Return-to-work meeting due' });
    expect(board('CP-1153')).toEqual({ spells: 1, days: 1, score: 1, triggered: false, latest: '22/07/2026 · 1 day', next: 'No action' });
    expect(board('CP-1266')).toEqual({ spells: 1, days: 12, score: 12, triggered: false, latest: '02/06/2026 · 12 days', next: 'Sick note held · 8-week check 28/08/2026' });
  });
  test('the leaver reconciles as the prototype did: 6 months, 16 days taken, over-taken', () => {
    const L = w.must(w.leavers[0], 'leaver'), p = person(L.personCode);
    expect([p.code, p.state, L.leaveDate]).toEqual(['CP-1288', 'leaver', '2026-09-30']);
    const yr = leaveYear(TODAY, w.cfg.finYearStart), months = monthsWorked(yr.start, p.start, L.leaveDate), b = w.balance(p);
    expect([months, b.takenD, b.ent.days]).toEqual([6, 16, 14.4]);
    expect(reconcileLeaver({ fullDays: b.ent.days, takenDays: b.takenD, months, contractedHours: p.contractedHours }))
      .toMatchObject({ prorata: 7.2, diff: -8.8, verdict: 'Over-taken', action: 'Recover 8.8 days (39.60 h) through the final payroll' });
  });
  test('the rota weeks carry V for booked leave and S for sickness, by the same cell plan, and nothing else', () => {
    const weeks = vals<Week>(social as unknown as SeedFile, 'rotaWeeks');
    const expected = new Map<string, string>();
    for (const p of w.people.values()) {
      const mine = w.requests.filter(r => r.personCode === p.code), booked = bookedLeaveDates(mine, []);
      for (const r of mine.filter(x => x.state === 'approved')) for (const pw of absenceCellPlan(p.location, r.from, r.to))
        for (const d of pw.days) expected.set(`${pw.weekId}|${p.code}|${d}`, r.type === 'SICK' ? 'S' : 'V');
      for (const e of w.episodes.filter(x => x.personCode === p.code)) for (const pw of datesCellPlan(p.location, sicknessDates(e, TODAY, booked)))
        for (const d of pw.days) expected.set(`${pw.weekId}|${p.code}|${d}`, 'S');
    }
    const actual = new Map<string, string>();
    for (const wk of weeks) for (const [code, line] of Object.entries(wk.lines)) line.forEach((c, d) => { if (c === 'V' || c === 'S') actual.set(`${wk.id}|${code}|${d}`, c); });
    const seeded = new Set(weeks.map(x => x.id));
    expect([...actual].sort()).toEqual([...expected].filter(([k]) => seeded.has(k.split('|')[0] ?? '')).sort());
    expect([...actual]).toEqual([['rw_WH_2026-08-10|CP-1088|0', 'V'], ['rw_WH_2026-08-10|CP-1088|1', 'V']]);
  });
  test('Marcus Reilly\'s sickness falls on his booked leave, so there is a day to give back', () => {
    const marcus = w.requests.filter(r => r.personCode === 'CP-1088');
    expect(w.episodes.some(e => e.personCode === 'CP-1088' && e.from === '2026-08-11')).toBe(true);
    expect(bookedLeaveDates(marcus, []).has('2026-08-11')).toBe(true);
    expect(requestDays(w.must(marcus[0], 'request'), 30)).toEqual({ days: 2, hours: 12 });
  });
});

describe('seed qnipay for module 4', () => {
  const q = qnipay as unknown as SeedFile, w = world(q);
  test('the prototype\'s records land on Manish Nepal\'s reports at Manchester, the employee persona first', () => {
    expect([...new Set(w.requests.map(r => r.personCode))]).toEqual(['EMP005', 'EMP007', 'EMP004', 'EMP009']);
    expect(w.requests.filter(r => r.decidedBy).map(r => r.decidedBy?.personCode)).toEqual(['EMP001', 'EMP001']);
    expect([...new Set(w.episodes.map(e => e.personCode))]).toEqual(['EMP009', 'EMP010', 'EMP011']);
    expect(w.leavers.map(l => [l.personCode, w.people.get(l.personCode)?.state])).toEqual([['EMP008', 'archived']]);
    for (const r of w.requests) expect(w.people.get(r.personCode)?.location).toBe('MCR');
  });
  test('Bradford is the prototype\'s on qnipay too', () => {
    expect(bradford(w.episodes.filter(e => e.personCode === 'EMP009'), TODAY, w.cfg.absenceTrigger)).toEqual({ spells: 4, days: 7, score: 112, triggered: true });
  });
  test('Rota is off, so no request claims a rota effect and there is no rota data', () => {
    expect((q.data.tenant?.tenant as Rec & { flags: Record<string, boolean> }).flags.LV_ROTA).toBe(false);
    expect(w.requests.every(r => !(r as Request & { short: boolean }).short)).toBe(true);
    for (const c of ['rotaWeeks', 'shiftTypes', 'coverRequests']) expect(q.data[c], c).toBeUndefined();
  });
});

import {
  DOWNLOAD_BLOCKED, HOURS_CSV_HEADER, cellHours, checkCount, dayStatus, dayVariance, exportedText, flagWarns, footHours, hasError,
  hoursCsv, hoursCsvRow, hoursFileName, isBank, minutesToHours, positionOf, rotaLineText, teamTotals, varianceTone, type ExportMember,
} from './hours';
import { DEFAULT_ROTA_CONFIG, normLine, recalcShift, type RotaWorker, type RuleContext, type ShiftType, type TypeRota } from './rota';

const must = <T>(v: T | null | undefined): T => { if (v == null) throw new Error('fixture missing'); return v; };
const E = must(recalcShift({ code: 'E', name: 'Early', from: '07:00', to: '15:00', breakMinutes: 30, night: false, tone: 'E' }));
const L = must(recalcShift({ code: 'L', name: 'Late', from: '14:30', to: '22:00', breakMinutes: 0, night: false, tone: 'L' }));
const N = must(recalcShift({ code: 'N', name: 'Night', from: '22:00', to: '07:00', breakMinutes: 0, night: true, tone: 'N' }));
const SHIFTS: ShiftType[] = [E, L, N];
const SHIFT_TYPE: TypeRota = { shifts: ['E', 'L', 'N'], night: true, maxHours: 45, restHours: 11, maxConsec: 5, flexible: false };
const worker = (o: Partial<RotaWorker> = {}): RotaWorker => ({ code: 'CP-1042', name: 'Amara Okafor', employeeType: 'shift', typeName: 'Support Worker',
  jobProfile: 'SW', category: 'Contracted', contractedHours: 37.5, maxHours: 45, night: true, cleared: true, dbsExpiry: '2027-03-31',
  qualifications: 'All valid', favourite: false, preferredDays: [], ...o });
const ctx = (o: Partial<RuleContext> = {}): Omit<RuleContext, 'safeWorker'> => ({ shifts: SHIFTS, typeRota: SHIFT_TYPE, config: DEFAULT_ROTA_CONFIG, ...o });
const line = (...cells: string[]) => normLine(cells);

describe('the hours position engine', () => {
  /* Amara on the social seed's week of 10 August: Early, Early, rest, Night, Night: 33h against 37.5h, 7.5h worked */
  test('contracted, rota\'d and worked, the three variances, and the flags', () => {
    const p = positionOf(worker(), line('E', 'E', '', 'N', 'N'), 7.5, ctx());
    expect([p.con, p.rot, p.wk, p.rotaVar, p.workVar, p.schedVar, p.cap]).toEqual([37.5, 33, 7.5, -4.5, -30, -25.5, 45]);
    expect(p.flags).toEqual([{ k: 'Under contracted', c: 'info' }, { k: '2 nights', c: 'neu' }]);
    expect([checkCount(p.flags), hasError(p.flags)]).toEqual([1, false]);
  });
  test('over contracted, overtime, over maximum, rest and consecutive days are raised in the prototype\'s order', () => {
    const p = positionOf(worker({ maxHours: 40 }), line('E', 'E', 'E', 'E', 'N', 'E'), 50, ctx());
    expect(p.flags.map(f => f.k)).toEqual(['Over contracted', 'Over maximum', 'Overtime worked', 'Rest warning', '6 consecutive days', '1 night']);
    expect(p.flags.filter(flagWarns).map(f => f.c)).toEqual(['warn', 'err', 'warn', 'err', 'err']);
    expect([checkCount(p.flags), hasError(p.flags)]).toEqual([5, true]);
  });
  test('overtime needs more than a quarter of an hour over the rota', () => {
    expect(positionOf(worker(), line('E'), 7.75, ctx()).flags.map(f => f.k)).not.toContain('Overtime worked');
    expect(positionOf(worker(), line('E'), 7.76, ctx()).flags.map(f => f.k)).toContain('Overtime worked');
  });
  test('a bank worker has no contracted baseline: no flag against a contract, and Bank in its place', () => {
    const bank = worker({ code: 'CP-1310', contractedHours: 0, maxHours: 37.5 });
    const p = positionOf(bank, line('', '', '', '', '', 'E'), 7.5, ctx());
    expect(isBank(bank.contractedHours)).toBe(true);
    expect([p.con, p.rot, p.wk, p.rotaVar, p.workVar, p.schedVar]).toEqual([0, 7.5, 7.5, 7.5, 7.5, 0]);
    expect(p.flags).toEqual([]);
    /* still measured against a maximum */
    expect(positionOf(bank, line('E', 'E', 'E', 'E', 'E', 'E'), 0, ctx()).flags.map(f => f.k)).toEqual(['Over maximum', '6 consecutive days']);
    expect(isBank(37.5)).toBe(false);
  });
  test('with the Rota module off there is no rota\'d baseline, so nothing is measured against one', () => {
    const p = positionOf(worker(), null, 40, ctx());
    expect([p.rot, p.wk, p.rotaVar, p.workVar, p.schedVar, p.flags]).toEqual([0, 40, 0, 2.5, 0, []]);
  });
  test('worked hours are rounded to the minute\'s two places, never floating point noise', () => {
    expect(positionOf(worker(), line('E'), 0.1 + 0.2, ctx()).wk).toBe(0.3);
    expect(minutesToHours(450)).toBe(7.5);
    expect(minutesToHours(100)).toBe(1.67);
  });
});

describe('how the figures read', () => {
  test('hours and variances, as each place in the prototype signs them', () => {
    expect([footHours(0), footHours(2.5), footHours(-4.5)]).toEqual(['+0h', '+2.5h', '-4.5h']);
    expect([cellHours(0), cellHours(2.5), cellHours(-4.5)]).toEqual(['0h', '+2.5h', '-4.5h']);
    expect([varianceTone(1), varianceTone(-1), varianceTone(0)]).toEqual(['up', 'dn', 'ok']);
  });
  test('a day\'s variance, and none when the day has no hours either way', () => {
    expect([dayVariance(7.5, 8), dayVariance(9, 0), dayVariance(0, 7.5), dayVariance(0, 0)]).toEqual([0.5, -9, 7.5, null]);
  });
  test('a day\'s status: leave, sickness, the recorded state, nothing recorded, still to come, rest', () => {
    const d = { cell: 'E', absence: '' as const, state: null, scheduled: 7.5, future: false };
    expect(dayStatus({ ...d, cell: 'V', scheduled: 0 })).toEqual({ kind: 'leave' });
    expect(dayStatus({ ...d, absence: 'V' })).toEqual({ kind: 'leave' });
    expect(dayStatus({ ...d, cell: 'S', scheduled: 0 })).toEqual({ kind: 'sickness' });
    expect(dayStatus({ ...d, state: 'pend' })).toEqual({ kind: 'recorded', state: 'pend' });
    expect(dayStatus({ ...d, cell: '', scheduled: 0, state: 'draft' })).toEqual({ kind: 'recorded', state: 'draft' });
    expect(dayStatus(d)).toEqual({ kind: 'missing' });
    expect(dayStatus({ ...d, future: true })).toEqual({ kind: 'upcoming' });
    expect(dayStatus({ ...d, cell: '', scheduled: 0 })).toEqual({ kind: 'rest' });
  });
  test('the rota line cell', () => {
    expect(rotaLineText({ code: 'E', name: 'Early', time: '07:00–15:00' })).toBe('Early · 07:00–15:00');
    expect([rotaLineText({ code: 'V', name: '', time: '' }), rotaLineText({ code: 'S', name: '', time: '' })]).toEqual(['Annual leave', 'Sickness']);
    expect([rotaLineText({ code: '', name: 'Rest day', time: '' }), rotaLineText(undefined)]).toEqual(['', '']);
  });
});

describe('the team', () => {
  const amara = { contractedHours: 37.5, position: positionOf(worker(), line('E', 'E', '', 'N', 'N'), 7.5, ctx()) };
  const ellie = { contractedHours: 0, position: positionOf(worker({ contractedHours: 0 }), line('', '', '', '', '', 'E'), 0, ctx()) };
  const over = { contractedHours: 37.5, position: positionOf(worker(), line('E', 'E', 'E', 'E', 'E', 'E'), 45, ctx()) };
  test('totals, contracted colleagues, discrepancies and whether any is an error', () => {
    expect(teamTotals([amara, ellie])).toEqual({ con: 37.5, rot: 40.5, wk: 7.5, rotaVar: 3, workVar: -33, contracted: 1, discrepancies: 1, anyError: false });
    expect(teamTotals([amara, ellie, over])).toMatchObject({ con: 75, rot: 85.5, discrepancies: 2, anyError: true });
    expect(teamTotals([])).toEqual({ con: 0, rot: 0, wk: 0, rotaVar: 0, workVar: 0, contracted: 0, discrepancies: 0, anyError: false });
  });
});

describe('the export', () => {
  const m = (o: Partial<ExportMember>): ExportMember => ({ code: 'CP-1042', name: 'Amara Okafor', locationName: 'Willow House', jobProfileName: 'Support Worker',
    contractedHours: 37.5, position: positionOf(worker(), line('E', 'E', '', 'N', 'N'), 7.5, ctx()), ...o });
  test('one header, then one line per colleague, hours and flags only', () => {
    const rows = hoursCsv([m({}), m({ code: 'CP-1310', name: 'Ellie Warren', contractedHours: 0,
      position: positionOf(worker({ contractedHours: 0 }), line('', '', '', '', '', 'E'), 0, ctx()) })], true);
    expect(rows[0]).toEqual([...HOURS_CSV_HEADER]);
    expect(rows[1]).toEqual(['CP-1042', 'Amara Okafor', 'Willow House', 'Support Worker', 37.5, 33, 7.5, -4.5, -30, 'Under contracted; 2 nights']);
    expect(rows[2]).toEqual(['CP-1310', 'Ellie Warren', 'Willow House', 'Support Worker', 'Bank', 7.5, 0, '', '', '']);
    expect(HOURS_CSV_HEADER.join(' ')).not.toMatch(/amount|rate|cost|currency|£/i);
  });
  test('with the Rota module off the rota\'d cells are blank', () => {
    expect(hoursCsvRow(m({ position: positionOf(worker(), null, 40, ctx()) }), false).slice(4, 9)).toEqual([37.5, '', 40, '', 2.5]);
  });
  test('the file is named for the location and the week, and the toast and audit give the true row count', () => {
    expect(hoursFileName('WH', '2026-08-10')).toBe('qnipay-hours-position-WH-10-08-2026.csv');
    expect(exportedText(12, 'x.csv')).toBe('Exported · 12 rows · x.csv');
    expect(exportedText(1, 'x.csv')).toBe('Exported · 1 row · x.csv');
    expect(DOWNLOAD_BLOCKED).toEqual({ message: 'Download blocked by the browser. No file was produced.', next: 'Allow downloads for this site, then export again.' });
  });
});

import {
  DEFAULT_ROTA_CONFIG, applyPattern, amendedAuditText, amendedNotice, assignCheck, claimRefusal, clearPreview, clearProblem,
  clearSummary, clearWrites, confirmProblem, confirmSummary, consecRun, copyProblem, copySummary, copyWeek, coverAskAllMove, coverClosed,
  coverEscalateMove, coverNext, coverReasonMove, coverage, coverageIssueNotice, emptyWeek, eligibility, gapDays, gapsAt, genLabel, genRange,
  generateAuditText, generateSummary, hoursPosition, ineligibleMessage, isValidCell, itRequestFor, lineRestIssues, minFor, newCover,
  normLine, onRoster, onShift, openCoverProblem, openShiftsFor, patternGenerateProblem, patternProblem, patternUsage, planSummary, planWeek,
  publishNotice, publishProblem, publishSummary, publishWeek, recalcShift, repeatProblem, repeatSummary, repeatWeek, resizeCycle,
  rotaCan, rotaConfigProblem, rotaDayOf, rotaDaysOf, rotaInputFor, rotaKeyCounts, rotaLive, rotaPolicyWithholds, rotaTransitionProblem, rotaVisible, rotaWeekId,
  setCell, setCells, shiftAssignedNotice, shiftLetter, shiftName, shiftRemovalProblem, shiftShortTime, shiftTime, shiftTypeProblem,
  shiftUsage, sortShifts, staggerOffsets, suggest, thinnest, typesAfterNightChange, typesAfterShiftCreate, typesWithoutShift,
  type Candidate, type CoverCore, type FulfilStage, type PatternCore, type RotaActor, type RotaWeekCore, type RotaWorker,
  type RuleContext, type ShiftType, type TypeRota, type WeekSlot,
} from './rota';

const must = <T>(v: T | null | undefined): T => { if (v == null) throw new Error('fixture missing'); return v; };
const E = must(recalcShift({ code: 'E', name: 'Early', from: '07:00', to: '15:00', breakMinutes: 30, night: false, tone: 'E' }));
const L = must(recalcShift({ code: 'L', name: 'Late', from: '14:30', to: '22:00', breakMinutes: 0, night: false, tone: 'L' }));
const N = must(recalcShift({ code: 'N', name: 'Night', from: '22:00', to: '07:00', breakMinutes: 0, night: true, tone: 'N' }));
const SHIFTS: ShiftType[] = [E, L, N];
const SHIFT_TYPE: TypeRota = { shifts: ['E', 'L', 'N'], night: true, maxHours: 45, restHours: 11, maxConsec: 5, flexible: false };
const worker = (o: Partial<RotaWorker> = {}): RotaWorker => ({ code: 'CP-1042', name: 'Amara Okafor', employeeType: 'shift', typeName: 'Support Worker',
  jobProfile: 'SW', category: 'Contracted', contractedHours: 37.5, maxHours: 45, night: true, cleared: true, dbsExpiry: '2027-03-31',
  qualifications: 'All valid', favourite: false, preferredDays: [], ...o });
const ctx = (o: Partial<RuleContext> = {}): RuleContext => ({ shifts: SHIFTS, typeRota: SHIFT_TYPE, config: DEFAULT_ROTA_CONFIG, safeWorker: true, ...o });
const line = (...cells: string[]) => normLine(cells);
const ME: RotaActor = { personCode: 'CP-1001', name: 'Rachel Hussain' };
const AT = '2026-08-13T08:12:00.000Z';
const STAGES: FulfilStage[] = [
  { n: 1, audience: 'Employees at location', wait: 15, channel: 'In-app + email', next: 'Favourite workers' },
  { n: 2, audience: 'Favourite bank workers', wait: 30, channel: 'In-app + email', next: 'All cleared workers' },
  { n: 3, audience: 'All cleared bank workers', wait: 120, channel: 'In-app + email + SMS', next: 'Manager escalation' },
  { n: 4, audience: 'Service Manager', wait: 240, channel: 'Email', next: 'Agency / manual booking' },
];
const locName = (c: string) => ({ WH: 'Willow House', BC: 'Beacon Court', RL: 'Rowan Lodge' })[c] ?? c;
const reasons = (w: RotaWorker, l: string[], day: number, code: string, c = ctx()) => eligibility(w, l, day, code, c).map(x => x.reason);

describe('shift types', () => {
  test('recalcShift derives the length, the midnight crossing and the place on the 24-hour line', () => {
    expect(E).toMatchObject({ hours: 7.5, cross: false, start: 7, end: 15 });
    expect(N).toMatchObject({ hours: 9, cross: true, start: 22, end: 31 });
    const twilight = recalcShift({ code: 'TN', name: 'Twilight', from: '16:00', to: '0:30', breakMinutes: 0, night: false });
    expect(twilight).toMatchObject({ to: '00:30', hours: 8.5, cross: true, start: 16, end: 24.5, tone: 'N' });
    expect(recalcShift({ code: 'M', name: 'Mid', from: '12:00', to: '18:00', breakMinutes: 0, night: false })?.tone).toBe('L');
    expect(recalcShift({ code: 'X', name: 'X', from: '25:00', to: '18:00', breakMinutes: 0, night: false })).toBeNull();
    expect(sortShifts([N, E, L]).map(s => s.code)).toEqual(['E', 'L', 'N']);
  });
  test('names, times and letters, with leave and sickness as their own marks', () => {
    expect([shiftName(SHIFTS, 'V'), shiftName(SHIFTS, 'S'), shiftName(SHIFTS, 'E'), shiftName(SHIFTS, 'Q')]).toEqual(['Annual leave', 'Sickness', 'Early', '']);
    expect([shiftTime(SHIFTS, 'E'), shiftShortTime(SHIFTS, 'N'), shiftShortTime(SHIFTS, 'V'), shiftLetter('V'), shiftLetter('E')])
      .toEqual(['07:00–15:00', '22:00–07', 'Leave', 'AL', 'E']);
    expect(['', 'V', 'S', 'E', 'Q'].map(c => isValidCell(c, SHIFTS))).toEqual([true, true, true, true, false]);
  });
  test('a new shift type needs a unique code, a name and two different 24-hour times', () => {
    const ok = { code: 'TN', name: 'Twilight', from: '16:00', to: '00:30', breakMinutes: 0, night: false };
    const codes = ['E', 'L', 'N'];
    expect(shiftTypeProblem(ok, codes, true)).toBeNull();
    for (const code of ['E', 'V', 'TOOLONG', ''])
      expect(shiftTypeProblem({ ...ok, code }, codes, true)).toEqual({ field: 'code', message: 'A unique code of 1–4 characters is required.' });
    expect(shiftTypeProblem({ ...ok, code: 'E' }, codes, false)).toBeNull();
    expect(shiftTypeProblem({ ...ok, name: ' ' }, codes, true)?.message).toBe('A name is required.');
    expect(shiftTypeProblem({ ...ok, from: '4pm' }, codes, true)?.message).toBe('Use a 24-hour time such as 16:00.');
    expect(shiftTypeProblem({ ...ok, to: '' }, codes, true)?.message).toBe('Use a 24-hour time such as 00:30.');
    expect(shiftTypeProblem({ ...ok, to: '16:00' }, codes, true)?.message).toBe('A shift cannot start and finish at the same time.');
    expect(shiftTypeProblem({ ...ok, breakMinutes: 200 }, codes, true)?.field).toBe('breakMinutes');
    expect(shiftTypeProblem({ ...ok, tone: 'Q' }, codes, true)?.field).toBe('tone');
  });
  test('a shift type in use cannot be removed, and the last one is kept', () => {
    const lines = [line('E', 'E'), line('L', 'E')];
    const pats = [{ days: ['E', '', 'E'] }];
    expect([shiftUsage('E', lines), patternUsage('E', pats)]).toEqual([3, 2]);
    expect(shiftRemovalProblem(E, 3, 3, 2)?.message).toBe('Early is still in use on 3 rota day(s) and 2 pattern day(s). Clear those first.');
    expect(shiftRemovalProblem(E, 1, 0, 0)?.message).toBe('Keep at least one shift type.');
    expect(shiftRemovalProblem(E, 3, 0, 0)).toBeNull();
  });
  test('employee types follow the catalogue: eligible on create, night-only types keep night shifts, removal strips it', () => {
    const types = { shift: SHIFT_TYPE, salaried: { ...SHIFT_TYPE, shifts: ['E', 'L'], night: false } };
    const tn = must(recalcShift({ code: 'TN', name: 'Twilight', from: '16:00', to: '00:30', breakMinutes: 0, night: true }));
    const made = typesAfterShiftCreate(types, tn, true);
    expect([made.shift?.shifts, made.salaried?.shifts]).toEqual([['E', 'L', 'N', 'TN'], ['E', 'L']]);
    expect(typesAfterShiftCreate(types, tn, false).shift?.shifts).toEqual(['E', 'L', 'N']);
    const nightL = typesAfterNightChange(types, 'L', true);
    expect([nightL.shift?.shifts, nightL.salaried?.shifts]).toEqual([['E', 'L', 'N'], ['E']]);
    expect(typesAfterNightChange(types, 'L', false)).toEqual(types);
    expect(typesWithoutShift(types, 'E').salaried?.shifts).toEqual(['L']);
  });
});

describe('rota config and policy', () => {
  const ok = { employeeTypes: ['shift'], shiftCodes: ['E', 'L', 'N'] };
  test('the prototype defaults pass, and each bad value is refused with its field', () => {
    expect(rotaConfigProblem(DEFAULT_ROTA_CONFIG, STAGES, { shift: SHIFT_TYPE }, ok)).toBeNull();
    expect(rotaConfigProblem({ ...DEFAULT_ROTA_CONFIG, minDefault: 0 }, STAGES, {}, ok)?.field).toBe('minDefault');
    expect(rotaConfigProblem({ ...DEFAULT_ROTA_CONFIG, horizon: 9 }, STAGES, {}, ok)?.field).toBe('horizon');
    expect(rotaConfigProblem({ ...DEFAULT_ROTA_CONFIG, rotaBuiltBy: 'Everyone' }, STAGES, {}, ok)?.field).toBe('rotaBuiltBy');
    expect(rotaConfigProblem(DEFAULT_ROTA_CONFIG, [], {}, ok)?.message).toBe('Keep at least one stage.');
    expect(rotaConfigProblem(DEFAULT_ROTA_CONFIG, [{ ...STAGES[0], n: 1, audience: 'Anyone' } as FulfilStage], {}, ok)?.field).toBe('stages.0.audience');
    expect(rotaConfigProblem(DEFAULT_ROTA_CONFIG, STAGES, { shift: { ...SHIFT_TYPE, shifts: ['Q'] } }, ok)?.message).toBe('Q is not a shift type.');
    expect(rotaConfigProblem(DEFAULT_ROTA_CONFIG, STAGES, { driver: SHIFT_TYPE }, ok)?.field).toBe('types.driver');
  });
  test('"Admins only" withholds patterns and shift types from managers, and nothing else', () => {
    expect(rotaPolicyWithholds('rota_pattern', 'manager', 'Admins only')).toBe(true);
    expect(rotaPolicyWithholds('rota_shift', 'manager', 'Admins only')).toBe(true);
    expect(rotaPolicyWithholds('rota_pattern', 'admin', 'Admins only')).toBe(false);
    expect(rotaPolicyWithholds('team_rota', 'manager', 'Admins only')).toBe(false);
    expect(rotaPolicyWithholds('rota_pattern', 'manager', 'Admins and managers')).toBe(false);
  });
});

describe('week states (D2)', () => {
  test('the moves are exactly ROTA_STATES, and live means published or republished', () => {
    const allowed = [['draft', 'review'], ['draft', 'published'], ['review', 'draft'], ['review', 'published'], ['published', 'amendment'],
      ['amendment', 'republished'], ['republished', 'amendment']];
    const all = ['draft', 'review', 'published', 'amendment', 'republished'];
    for (const f of all) for (const t of all) expect(rotaCan(f, t), `${f}→${t}`).toBe(allowed.some(([a, b]) => a === f && b === t));
    expect(all.filter(rotaLive)).toEqual(['published', 'republished']);
    expect(all.filter(rotaVisible)).toEqual(['published', 'amendment', 'republished']);
  });
  test('a refused move uses the prototype\'s words as a sentence', () => {
    expect(rotaTransitionProblem('published', 'review')).toEqual({ code: 'TRANSITION_NOT_ALLOWED',
      message: 'A published rota cannot go back to review.', next: 'From published it can move to amended.' });
    expect(rotaTransitionProblem('draft', 'republished')?.message).toBe('A draft rota cannot be republished.');
    expect(rotaTransitionProblem('amendment', 'published')?.message).toBe('An amended rota cannot be published.');
    expect(rotaTransitionProblem('amendment', 'draft')?.message).toBe('An amended rota cannot go back to draft.');
    expect(rotaTransitionProblem('draft', 'review')).toBeNull();
  });
});

const week = (o: Partial<RotaWeekCore> = {}): RotaWeekCore => ({ ...emptyWeek('WH', '2026-08-10'), ...o });
describe('cell changes (rotaChange)', () => {
  test('a change to a draft week is logged but leaves it a draft', () => {
    const r = setCell(week({ lines: { 'CP-1042': line('E') } }), { personCode: 'CP-1042', name: 'Amara Okafor', day: 0, to: 'L', by: ME, at: AT, why: 'Changed' });
    expect(r.week.state).toBe('draft');
    expect(r.amended).toBe(false);
    expect(r.change).toEqual({ at: AT, by: ME, personCode: 'CP-1042', name: 'Amara Okafor', date: '2026-08-10', from: 'E', to: 'L', why: 'Changed', afterPublish: false, version: 0 });
    expect(r.week.lines['CP-1042']).toEqual(line('L'));
  });
  test('a change to a live week is an amendment against the published version', () => {
    const live = week({ state: 'published', publishVersion: 1, lines: { 'CP-1042': line('E', 'E') } });
    const r = setCell(live, { personCode: 'CP-1042', name: 'Amara Okafor', day: 1, to: '', by: ME, at: AT, why: 'Removed' });
    expect([r.week.state, r.amended, r.change.afterPublish, r.change.version]).toEqual(['amendment', true, true, 1]);
    expect(amendedAuditText('Willow House', live, r.change, SHIFTS)).toBe('Willow House · week 33 v1 · Amara Okafor · Early → nothing');
    expect(amendedNotice('2026-08-10', 1)).toEqual({ title: 'Rota amended', body: 'Week 33 · your shift on Tue has changed. Check your shifts.' });
    const again = setCell(r.week, { personCode: 'CP-1042', name: 'Amara Okafor', day: 2, to: 'L', by: ME, at: AT, why: 'Assigned' });
    /* an amended week is still one colleagues can see: the next change is an amendment too (I3) */
    expect([again.week.state, again.amended, again.change.afterPublish, again.week.changes.length]).toEqual(['amendment', true, true, 2]);
  });
  test('several writes as one request keep every change, newest first', () => {
    const r = setCells(week({ state: 'republished', publishVersion: 2 }), [
      { personCode: 'A', name: 'A', day: 0, to: 'E', by: ME, at: AT, why: 'Accepted' },
      { personCode: 'B', name: 'B', day: 1, to: 'L', by: ME, at: AT, why: 'Accepted' }]);
    expect([r.week.state, r.amended, r.week.changes.map(c => c.personCode)]).toEqual(['amendment', true, ['B', 'A']]);
    expect(rotaWeekId('WH', '2026-08-10')).toBe('rw_WH_2026-08-10');
  });
});

describe('coverage', () => {
  const lines = [line('E', 'V', 'N'), line('L', '', 'N'), line('E', 'S', '')];
  test('onShift counts people working, not leave or sickness, and gaps are days below the minimum', () => {
    expect([0, 1, 2].map(d => onShift(lines, d))).toEqual([3, 0, 2]);
    expect(gapDays(lines, 2)).toEqual([1, 3, 4, 5, 6]);
    expect(gapsAt(lines, 0)).toBe(0);
    expect([minFor(4, true, DEFAULT_ROTA_CONFIG), minFor(undefined, true, DEFAULT_ROTA_CONFIG), minFor(4, false, DEFAULT_ROTA_CONFIG)]).toEqual([4, 4, 0]);
  });
  test('per-day shift counts and the live legend', () => {
    expect(coverage(lines, SHIFTS)[0]).toEqual({ E: 2, L: 1, N: 0 });
    expect(rotaKeyCounts(lines)).toEqual({ shifts: { E: 2, L: 1, N: 2 }, leave: 1, sick: 1, empty: 14 });
  });
});

describe('publish (D3)', () => {
  test('gaps block publishing only while the policy says so', () => {
    expect(publishProblem(week(), 2, true)?.code).toBe('COVERAGE_GAPS');
    expect(publishProblem(week(), 2, true)?.message).toBe('Coverage gaps block publishing.');
    expect(publishProblem(week(), 2, false)).toBeNull();
  });
  test('an already-live week with no change is refused with the prototype\'s text', () => {
    expect(publishProblem(week({ state: 'published', publishVersion: 1 }), 0, true)?.message)
      .toBe('Week 33 is already published at v1. Change a shift first if you need to republish.');
  });
  test('publishing moves state and version; republishing counts only the amendments to the version it replaces', () => {
    const p = publishWeek(week({ state: 'review' }), ME, AT);
    expect([p.week.state, p.version, p.amended, p.republished, p.week.publishedBy, p.week.publishedAt]).toEqual(['published', 1, 0, false, ME, AT]);
    const old = { at: AT, by: ME, personCode: 'A', name: 'A', date: '2026-08-10', from: '', to: 'E', why: '', afterPublish: true, version: 1 };
    const amended = week({ state: 'amendment', publishVersion: 2, changes: [{ ...old, version: 2 }, { ...old, version: 2 }, old] });
    const r = publishWeek(amended, ME, AT);
    expect([r.week.state, r.version, r.amended]).toEqual(['republished', 3, 2]);
    expect(publishSummary(3, 10, 2, true)).toBe('Rota republished · v3 · 10 colleagues notified · 2 amendment(s) included');
    expect(publishNotice('Willow House', '2026-08-10', 3, true)).toEqual({ title: 'Rota republished', body: 'Willow House · 10/08/2026 – 16/08/2026 · v3' });
  });
});

describe('eligibility (PEOP167)', () => {
  test('with safe-worker filtering off only the employee type\'s shifts count', () => {
    const off = ctx({ safeWorker: false, typeRota: { ...SHIFT_TYPE, shifts: ['E', 'L'] } });
    expect(eligibility(worker(), line(), 0, 'N', off)).toEqual([{ rule: 'Shift eligibility', reason: 'Support Worker is not eligible for night shifts' }]);
    expect(eligibility(worker({ cleared: false }), line('V'), 0, 'E', off)).toEqual([]);
  });
  test('availability: approved leave and sickness', () => {
    expect(reasons(worker(), line('V'), 0, 'E')).toEqual(['On approved leave']);
    expect(reasons(worker(), line('S'), 0, 'E')).toEqual(['Recorded as off sick']);
  });
  test('a shift already on the day is a conflict', () => {
    expect(eligibility(worker(), line('L'), 0, 'E', ctx()).map(x => [x.rule, x.reason])).toContainEqual(['Shift conflict', 'Already working that day']);
  });
  test('clearance names the lapsed DBS date', () => {
    const k = worker({ name: 'Kwame Boateng', cleared: false, dbsExpiry: '2026-06-30' });
    const ex = eligibility(k, line(), 0, 'E', ctx());
    expect(ex).toEqual([{ rule: 'Clearance', reason: 'Not cleared to work. DBS expired 30/06/2026' }]);
    expect(ineligibleMessage(k.name, ex[0] ?? { rule: '', reason: '' })).toBe('Kwame Boateng. Not cleared to work. DBS expired 30/06/2026.');
    expect(reasons(worker({ cleared: false, dbsExpiry: '' }), line(), 0, 'E')).toEqual(['Not cleared to work']);
  });
  test('an expired qualification excludes; one about to expire does not', () => {
    expect(reasons(worker({ qualifications: 'Medication training expired' }), line(), 0, 'E')).toEqual(['Medication training expired']);
    expect(reasons(worker({ qualifications: 'First aid expires in 24 days' }), line(), 0, 'E')).toEqual([]);
  });
  test('a night shift needs a night-trained person on a night-eligible type', () => {
    expect(reasons(worker({ night: false }), line(), 0, 'N')).toEqual(['Not night-trained']);
    expect(reasons(worker(), line(), 0, 'N', ctx({ typeRota: { ...SHIFT_TYPE, night: false } }))).toEqual(['Not night-trained']);
  });
  test('the employee type\'s shifts', () => {
    expect(reasons(worker(), line(), 0, 'N', ctx({ typeRota: { ...SHIFT_TYPE, shifts: ['E'] } }))).toEqual(['Support Worker is not eligible for night shifts']);
  });
  test('maximum hours: the lowest of the person, the type and the tenant', () => {
    expect(reasons(worker({ maxHours: 30 }), line('N', '', 'N', '', 'N'), 6, 'E')).toEqual(['Would pass their 30-hour maximum']);
    expect(reasons(worker({ maxHours: 60 }), line('N', '', 'N', '', 'N'), 6, 'E', ctx({ config: { ...DEFAULT_ROTA_CONFIG, maxHours: 30 } })))
      .toEqual(['Would pass their 30-hour maximum']);
  });
  test('minimum rest, an overlap, and the restWarn switch', () => {
    expect(eligibility(worker(), line('L'), 1, 'E', ctx())).toEqual([{ rule: 'Minimum rest', reason: 'Only 9 hours rest before or after' }]);
    const X = must(recalcShift({ code: 'X', name: 'Dawn', from: '05:00', to: '13:00', breakMinutes: 0, night: false }));
    const withX = ctx({ shifts: [...SHIFTS, X], typeRota: { ...SHIFT_TYPE, shifts: ['E', 'L', 'N', 'X'] } });
    expect(reasons(worker(), line('N'), 1, 'X', withX)).toEqual(['Clashes with another shift']);
    expect(reasons(worker(), line('L'), 1, 'E', ctx({ config: { ...DEFAULT_ROTA_CONFIG, restWarn: false } }))).toEqual([]);
  });
  test('consecutive days against the type\'s limit', () => {
    expect(reasons(worker(), line('E', 'E', 'E', 'E', 'E'), 5, 'E')).toEqual(['Would make 6 days in a row']);
    expect(consecRun(line('E', 'E', '', 'E'), 2, SHIFTS)).toBe(4);
  });
  test('each safe rule can be switched off on its own', () => {
    const off = (k: keyof typeof DEFAULT_ROTA_CONFIG.safeRules) => ctx({ config: { ...DEFAULT_ROTA_CONFIG, safeRules: { ...DEFAULT_ROTA_CONFIG.safeRules, [k]: false } } });
    expect(reasons(worker(), line('V'), 0, 'E', off('availability'))).toEqual([]);
    expect(reasons(worker({ cleared: false }), line(), 0, 'E', off('clearance'))).toEqual([]);
    expect(reasons(worker({ qualifications: 'DBS expired' }), line(), 0, 'E', off('quals'))).toEqual([]);
    expect(reasons(worker({ night: false }), line(), 0, 'N', off('night'))).toEqual([]);
    expect(reasons(worker({ maxHours: 30 }), line('N', '', 'N', '', 'N'), 6, 'E', off('maxHours'))).toEqual([]);
    expect(reasons(worker(), line('L'), 1, 'E', off('rest'))).toEqual([]);
    expect(reasons(worker(), line('E', 'E', 'E', 'E', 'E'), 5, 'E', off('consec'))).toEqual([]);
    expect(reasons(worker(), line('L'), 0, 'E', off('conflicts'))).toEqual([]);
  });
});

describe('hours position', () => {
  test('contracted, rota\'d and worked, with the flags they raise', () => {
    const pos = hoursPosition(worker(), line('E', 'E', 'E', 'E', 'E', 'E'), 47, ctx());
    expect([pos.rot, pos.cap, pos.rotaVar, pos.workVar, pos.schedVar]).toEqual([45, 45, 7.5, 9.5, 2]);
    expect(pos.flags.map(f => f.k)).toEqual(['Over contracted', 'Overtime worked', '6 consecutive days']);
    expect(hoursPosition(worker(), line('N', 'E'), 0, ctx()).flags).toEqual([
      { k: 'Under contracted', c: 'info' }, { k: 'Rest warning', c: 'err' }, { k: '1 night', c: 'neu' }]);
    expect(hoursPosition(worker({ maxHours: 10 }), line('E', 'E'), 15, ctx()).flags.map(f => f.k)).toContain('Over maximum');
    expect(lineRestIssues(line('N', 'E', 'L', 'E'), 11, SHIFTS)).toEqual([{ i: 0, rest: 0 }, { i: 2, rest: 9 }]);
  });
});

describe('the single assignment path (D4)', () => {
  test('an unknown shift, a leave or sick day, and the same shift are refused before eligibility', () => {
    expect(assignCheck(worker(), line(), 0, 'Q', 'assign', ctx())).toMatchObject({ ok: false, code: 'UNKNOWN_SHIFT', message: 'There is no shift type with the code Q.' });
    expect(assignCheck(worker({ name: 'Marcus Reilly' }), line('V'), 0, 'E', 'assign', ctx()))
      .toMatchObject({ ok: false, code: 'ON_LEAVE', message: 'Marcus Reilly is already down as on leave that day.' });
    expect(assignCheck(worker(), line('S'), 0, 'E', 'assign', ctx())).toMatchObject({ message: 'Amara Okafor is already down as off sick that day.' });
    expect(assignCheck(worker(), line('E'), 0, 'E', 'change', ctx())).toMatchObject({ code: 'UNCHANGED', message: 'Amara Okafor is already on Early that day.' });
  });
  test('a failed hard rule refuses with "<name>. <reason>." and the rule', () => {
    expect(assignCheck(worker({ night: false }), line(), 0, 'N', 'assign', ctx()))
      .toEqual({ ok: false, code: 'ROTA_INELIGIBLE', message: 'Amara Okafor. Not night-trained.', rule: 'Night eligibility' });
  });
  test('assign onto a filled day is a conflict; change judges the day without the shift it replaces', () => {
    expect(assignCheck(worker(), line('L'), 0, 'E', 'assign', ctx())).toMatchObject({ code: 'ROTA_INELIGIBLE', message: 'Amara Okafor. Already working that day.' });
    expect(assignCheck(worker(), line('L'), 0, 'E', 'change', ctx())).toMatchObject({ ok: true, line: line('E') });
  });
  test('advisories travel with the saved line and never block', () => {
    const r = assignCheck(worker(), line('E', 'E', 'E', 'E', 'E'), 5, 'E', 'assign', ctx({ safeWorker: false }));
    expect(r.ok && r.advisories.map(a => a.k)).toEqual(['Over contracted', '6 consecutive days']);
  });
});

describe('suggestions', () => {
  const cand = (w: RotaWorker, l: string[], c = ctx()): Candidate => ({ worker: w, line: l, ctx: c });
  test('hard rules first, then a ranking with its reasons', () => {
    const a = worker({ code: 'A', name: 'A' });
    const b = worker({ code: 'B', name: 'B', category: 'Bank', contractedHours: 0, favourite: true, preferredDays: [4] });
    const k = worker({ code: 'K', name: 'K', cleared: false, dbsExpiry: '2026-06-30' });
    const r = suggest(4, 'E', [cand(a, line('E', 'E', 'E', 'E')), cand(b, line()), cand(k, line())]);
    expect(r.ok.map(x => [x.worker.code, x.score, x.why])).toEqual([
      ['B', 11, ['Bank worker with no shifts yet this week', 'Favourite here, so asked first', 'Wants shifts on this day']],
      ['A', 2.5, ['7.5 hours below contracted', 'Would make 5 days in a row', '16 hours rest either side']]]);
    expect(r.no.map(x => [x.worker.code, x.rule, x.reason])).toEqual([['K', 'Clearance', 'Not cleared to work. DBS expired 30/06/2026']]);
  });
  test('the other reasons: at contracted, hours booked, fewest nights', () => {
    expect(suggest(2, 'E', [cand(worker({ contractedHours: 7.5 }), line('E'))]).ok[0]?.why[0]).toBe('already at contracted hours');
    expect(suggest(2, 'E', [cand(worker({ contractedHours: 0 }), line('E'))]).ok[0]?.why[0]).toBe('7.5h booked so far this week');
    expect(suggest(2, 'N', [cand(worker({ contractedHours: 0 }), line())]).ok[0]?.why).toContain('Fewest nights this week');
  });
  test('thinnest is the least-staffed shift, catalogue order breaking a tie', () => {
    expect(thinnest(0, [line('E'), line('E'), line('L')], SHIFTS)).toBe('N');
    expect(thinnest(0, [line('E'), line('L'), line('N')], SHIFTS)).toBe('E');
  });
  test('planWeek fills each day up to the minimum, and says when nobody is available', () => {
    const bank = (code: string) => cand(worker({ code, name: code, contractedHours: 0, maxHours: 37.5 }), line());
    const plan = planWeek([bank('A'), bank('B'), bank('C')], 1, SHIFTS);
    expect(plan.map(p => p.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(plan.every(p => !p.none)).toBe(true);
    expect(new Set(plan.map(p => (p.none ? '' : p.personCode))).size).toBe(3);
    const none = planWeek([cand(worker({ cleared: false }), line())], 1, SHIFTS);
    expect(none.every(p => p.none)).toBe(true);
    expect([planSummary(3), planSummary(0)]).toEqual(['Suggested 3 assignments for you to review',
      'No suggestions possible. Advertise the gaps through a cover request.']);
  });
  test('the roster: active people at the location with contracted hours or a shift', () => {
    const p = { code: 'A', location: 'WH', state: 'active', contractedHours: 0 };
    expect([onRoster(p, 'WH', line()), onRoster(p, 'WH', line('E')), onRoster({ ...p, contractedHours: 30 }, 'WH', line()),
      onRoster({ ...p, state: 'leaver' }, 'WH', line('E')), onRoster(p, 'BC', line('E'))]).toEqual([false, true, true, false, false]);
  });
});

const pattern = (o: Partial<PatternCore> = {}): PatternCore => ({ code: 'WP-02', name: 'Early / Late, 5 over 7', cycle: 7, locations: ['WH'], jobProfiles: ['SW'],
  costCentre: 'WH-CAM-01', starts: '2026-07-06', horizon: 12, gen: '4w', genFrom: '', genTo: '', active: true, days: ['E', 'E', 'L', 'L', 'E', '', ''],
  people: [1, 1, 3, 5, 2].map((offset, i) => ({ personCode: `P${i}`, offset })), ...o });
describe('pattern generation', () => {
  test('genRange: the span from today or the start, and the shifts it would land', () => {
    expect(genRange(pattern(), '2026-08-13')).toEqual({ ok: true, from: '2026-08-13', to: '2026-09-09', span: 28, shifts: 100,
      label: 'four weeks', range: '13/08/2026 – 09/09/2026' });
    expect(genRange(pattern({ gen: '1m' }), '2026-08-13')).toMatchObject({ to: '2026-09-12' });
    expect(genRange(pattern({ starts: '2026-09-01', gen: '1w' }), '2026-08-13')).toMatchObject({ from: '2026-09-01', to: '2026-09-07' });
    expect(genRange(pattern({ gen: 'range', genFrom: '2026-08-20', genTo: '2026-08-26' }), '2026-08-13')).toMatchObject({ span: 7, label: 'between two dates' });
  });
  test('genRange refuses a range without both dates, backwards, or over two years', () => {
    expect(genRange(pattern({ gen: 'range' }), '2026-08-13')).toEqual({ ok: false, message: 'Pick both dates for the range.' });
    expect(genRange(pattern({ gen: 'range', genFrom: '2026-08-20', genTo: '2026-08-19' }), '2026-08-13'))
      .toEqual({ ok: false, message: 'The end date is before the start date.' });
    expect(genRange(pattern({ gen: 'range', genTo: '2028-09-01' }), '2026-08-13')).toEqual({ ok: false, message: 'A single run cannot cover more than two years.' });
    expect([genLabel(pattern({ gen: '2w' })), genLabel(pattern({ gen: 'nonsense' }))]).toEqual(['Two weeks', 'Twelve months']);
  });
  test('the refusals before a run', () => {
    expect(patternGenerateProblem(pattern({ days: ['', '', ''] }), null, locName)?.message).toBe('Nothing to generate. Every day of the cycle is a rest day.');
    expect(patternGenerateProblem(pattern({ locations: [] }), null, locName)?.message).toBe('Pick at least one location before generating.');
    expect(patternGenerateProblem(pattern({ people: [] }), null, locName)?.message).toBe('Nobody is on Early / Late, 5 over 7 yet. Add a person first.');
    expect(patternGenerateProblem(pattern(), 'BC', locName)?.message)
      .toBe('Early / Late, 5 over 7 does not cover Beacon Court. A manager can only generate for their own location.');
    expect(patternGenerateProblem(pattern(), 'WH', locName)).toBeNull();
  });
  const info = (code: string, location: string, state = 'active') => [code, { code, name: code, location, state, restNeed: 11 }] as const;
  const run = (p: PatternCore, scope: string | null, weeks: Record<string, WeekSlot>) => applyPattern(p, { today: '2026-08-10', scope,
    people: new Map([info('A', 'WH'), info('B', 'WH'), info('C', 'BC'), info('G', 'BC', 'leaver')]), weekAt: (l, ws) => weeks[`${l}|${ws}`], locName, shifts: SHIFTS });
  const small = (people: PatternCore['people']) => pattern({ starts: '2026-08-10', gen: '1w', days: ['E', 'E', '', '', '', '', ''], people });
  test('applyPattern never overwrites: filled cells and leave are counted, live weeks skipped', () => {
    const weeks = { 'WH|2026-08-10': { state: 'draft', lines: { A: line('', 'V'), B: line('L') } }, 'BC|2026-08-10': { state: 'published', lines: {} } };
    const r = run(small([{ personCode: 'A', offset: 1 }, { personCode: 'B', offset: 2 }, { personCode: 'C', offset: 1 }]), null, weeks);
    expect(r).toMatchObject({ ok: true, written: 2, occupied: 1, absence: 1, weeks: 1, live: 1, people: 3, range: '10/08/2026 – 16/08/2026' });
    expect(r.ok && r.writes.map(w => [w.location, w.weekStart, w.created, w.lines.A, w.lines.B])).toEqual([['WH', '2026-08-10', false, line('E', 'V'), line('L', '', '', '', '', '', 'E')]]);
    if (r.ok) {
      expect(generateSummary(r)).toBe('2 shift(s) written · 10/08/2026 – 16/08/2026 · 1 week(s) · 3 people · 1 cell(s) already filled, left alone'
        + ' · 1 skipped for leave or sickness · 1 published week(s) skipped. Amend those individually');
      expect(generateAuditText(small([]), r, null)).toBe('Early / Late, 5 over 7 · 10/08/2026 – 16/08/2026 · 2 shift(s) written across 1 week(s) · 3 person(s)'
        + ' · 1 cell(s) already filled and left alone · 1 published week(s) skipped');
    }
  });
  test('applyPattern scoped to a manager\'s location, rest warnings on what it wrote, and nothing written', () => {
    const r = run(pattern({ starts: '2026-08-10', gen: '1w', days: ['N', 'E', '', '', '', '', ''], people: [{ personCode: 'A', offset: 1 }, { personCode: 'C', offset: 1 }] }), 'WH', {});
    expect(r).toMatchObject({ ok: true, written: 2, people: 1, rest: ['A · week of 2026-08-10 · 0h rest (needs 11h)'] });
    expect(r.ok && r.writes[0]?.created).toBe(true);
    const again = run(small([{ personCode: 'A', offset: 1 }]), null, { 'WH|2026-08-10': { state: 'draft', lines: { A: line('L', 'L') } } });
    expect(again.ok && generateSummary(again)).toBe('Nothing written · every target cell was already filled');
  });
  test('applyPattern refuses when nobody on the pattern is in reach', () => {
    expect(run(small([{ personCode: 'C', offset: 1 }]), 'RL', {})).toEqual({ ok: false, message: 'Nobody on this pattern works at Rowan Lodge.' });
    expect(run(small([{ personCode: 'G', offset: 1 }, { personCode: 'Z', offset: 1 }]), null, {}))
      .toEqual({ ok: false, message: 'None of the people on this pattern are on the workforce record.' });
  });
  test('a pattern\'s own checks, cycle resizing and staggered starting days', () => {
    expect(patternProblem(pattern(), ['E', 'L', 'N'])).toBeNull();
    expect(patternProblem(pattern({ name: '' }), ['E', 'L', 'N'])?.message).toBe('Give the pattern a name.');
    expect(patternProblem(pattern({ cycle: 30 }), ['E', 'L', 'N'])?.field).toBe('cycle');
    expect(patternProblem(pattern({ days: ['E', 'Q', '', '', '', '', ''] }), ['E', 'L', 'N'])?.message).toBe('Day 2 of the cycle uses Q, which is not a shift type.');
    expect(patternProblem(pattern({ people: [{ personCode: 'A', offset: 9 }] }), ['E', 'L', 'N'])?.message).toBe('A starting day must be from 1 to 7.');
    const shrunk = resizeCycle(pattern({ people: [{ personCode: 'A', offset: 6 }] }), 4);
    expect([shrunk.days, shrunk.people[0]?.offset]).toEqual([['E', 'E', 'L', 'L'], 2]);
    expect(resizeCycle(pattern(), 9).days.slice(7)).toEqual(['', '']);
    const nights = ['N', 'N', 'N', 'N', '', '', '', ''];
    expect([staggerOffsets(nights, 1, 'stagger', 3), staggerOffsets(nights, 3, 'stagger', 3), staggerOffsets(nights, 3, 'same', 2)])
      .toEqual([[1, 2, 3], [3, 4, 1], [3, 3]]);
  });
});

describe('repeat, copy and clear (D6)', () => {
  const src: WeekSlot = { state: 'published', lines: { A: line('E', 'E', '', '', '', 'V'), B: line('L'), X: line('N') } };
  test('an amended week counts as live: repeat and generate skip it (I3)', () => {
    const amended: WeekSlot = { state: 'amendment', lines: {} };
    expect(repeatWeek('WH', '2026-08-10', src, ['A'], 1, () => amended)).toMatchObject({ written: 0, live: 1, weeks: 0 });
    const p = pattern({ starts: '2026-08-10', gen: '1w', days: ['E', 'E', '', '', '', '', ''], people: [{ personCode: 'A', offset: 1 }] });
    const r = applyPattern(p, { today: '2026-08-10', scope: null, people: new Map([['A', { code: 'A', name: 'A', location: 'WH', state: 'active', restNeed: 11 }]]),
      weekAt: () => amended, locName: c => c, shifts: SHIFTS });
    expect(r).toMatchObject({ ok: true, written: 0, live: 1 });
  });
  test('repeatWeek writes forward into empty cells only, skipping live weeks and leave', () => {
    const weeks: Record<string, WeekSlot> = { '2026-08-24': { state: 'published', lines: {} }, '2026-08-31': { state: 'draft', lines: { A: line('V', 'L'), B: line() } } };
    const r = repeatWeek('WH', '2026-08-10', src, ['A', 'B'], 3, (_l, ws) => weeks[ws]);
    expect([r.written, r.occupied, r.absence, r.live, r.weeks]).toEqual([4, 1, 1, 1, 2]);
    expect(r.writes.map(w => [w.weekStart, w.created, w.lines.A, w.lines.X])).toEqual([
      ['2026-08-17', true, line('E', 'E'), undefined], ['2026-08-31', false, line('V', 'L'), undefined]]);
    expect(repeatSummary(r)).toBe('4 shift(s) written across 2 week(s) · 1 cell(s) already filled, left alone · 1 published week(s) skipped');
    expect(repeatSummary({ ...r, written: 0 })).toBe('Nothing written. Every target cell was already filled or in a published week.');
  });
  test('repeat refusals', () => {
    expect(repeatProblem(src, ['A'], 3)?.message).toBe('Choose how many weeks to repeat for from the list.');
    expect(repeatProblem(undefined, ['A'], 4)?.message).toBe('This week is not stored yet.');
    expect(repeatProblem({ state: 'draft', lines: { A: line('V') } }, ['A'], 4)?.message).toBe('This week has no shifts to repeat.');
    expect(repeatProblem(src, ['A'], 4)).toBeNull();
  });
  test('copy fills empty cells from last week and leaves the rest alone', () => {
    const r = copyWeek(src, { lines: { A: line('', 'L') } }, ['A', 'B']);
    expect([r.written, r.occupied, r.lines.A, r.lines.B]).toEqual([2, 1, line('E', 'L'), line('L')]);
    expect(copySummary(2, 1, '2026-08-03')).toBe('2 shift(s) copied from 03/08/2026 · review before publishing · 1 cell(s) already filled, left alone');
  });
  test('copy refusals', () => {
    expect(copyProblem({ state: 'published', weekStart: '2026-08-10' }, src, ['A'])?.message)
      .toBe('Week 33 is published. Copying over a live rota would replace published shifts.');
    expect(copyProblem({ state: 'amendment', weekStart: '2026-08-10' }, src, ['A'])?.code).toBe('WEEK_LIVE');
    expect(copyProblem({ state: 'draft', weekStart: '2026-08-17' }, undefined, ['A'])?.message).toBe('The previous week has no rota stored, so there is nothing to copy.');
    expect(copyProblem({ state: 'draft', weekStart: '2026-08-17' }, src, ['Z'])?.message).toBe('Nothing to copy. The previous week has no shifts for this location.');
  });
  test('clear removes shifts, keeps leave, and records each removal', () => {
    const lines = { A: line('E', 'V', 'L'), B: line() };
    expect(clearPreview(lines, ['A', 'B'])).toEqual({ shifts: 2, absence: 1, colleagues: 1 });
    const writes = clearWrites(lines, ['A', 'B'], new Map([['A', 'Amara Okafor']]), ME, AT);
    expect(writes.map(w => [w.personCode, w.name, w.day, w.to, w.why])).toEqual([['A', 'Amara Okafor', 0, '', 'Cleared'], ['A', 'Amara Okafor', 2, '', 'Cleared']]);
    const r = setCells(week({ lines }), writes);
    expect([r.week.lines.A, r.changes.length, r.amended]).toEqual([line('', 'V'), 2, false]);
    expect(clearSummary(2, '2026-08-10')).toBe('2 shift(s) cleared · week 33 · drag from the palette or generate from a pattern to rebuild it');
  });
  test('clear refusals', () => {
    expect(clearProblem(week({ state: 'republished' }), [], 'Willow House')?.message).toBe('Week 33 is republished. Remove shifts individually so each change is recorded.');
    expect(clearProblem(week({ state: 'amendment' }), [], 'Willow House')?.message).toBe('Week 33 is amended. Remove shifts individually so each change is recorded.');
    expect(clearProblem(week({ lines: { A: line('V') } }), ['A'], 'Willow House')?.message).toBe('Nothing to clear. This week has no shifts at Willow House.');
  });
});

describe('cover (D7)', () => {
  const open = (o: Partial<CoverCore> = {}): CoverCore => ({ ...newCover({ location: 'WH', date: '2026-08-11', shift: 'E', reason: '', urgent: false }, STAGES, AT, 6, 'Willow House'), ...o });
  test('one open request per location, day and shift', () => {
    expect(openCoverProblem([open()], 'WH', '2026-08-11', 'E', SHIFTS)?.message).toBe('A cover request is already open for Early on Tue 11 Aug.');
    expect(openCoverProblem([open()], 'WH', '2026-08-11', 'L', SHIFTS)).toBeNull();
    expect(openCoverProblem([open({ open: false })], 'WH', '2026-08-11', 'E', SHIFTS)).toBeNull();
    expect(openCoverProblem([], 'WH', '2026-08-11', 'Q', SHIFTS)?.code).toBe('UNKNOWN_SHIFT');
  });
  test('a new request asks nobody until it has a reason; an urgent one asks employees and favourites together', () => {
    expect([open().asked, open().log, open().stage]).toEqual(['Not asked yet', [], 1]);
    const sick = newCover({ location: 'WH', date: '2026-08-11', shift: 'E', reason: 'Sickness', urgent: false }, STAGES, AT, 6, 'Willow House');
    expect([sick.asked, sick.log]).toEqual(['Employees at Willow House, then favourite bank workers',
      [{ stage: 1, at: AT, audience: 'Employees at location', channel: 'In-app + email', sent: 6 }]]);
    expect(newCover({ location: 'WH', date: '2026-08-11', shift: 'E', reason: 'Vacancy', urgent: true }, STAGES, AT, 6, 'Willow House').asked)
      .toBe('Employees at Willow House and favourites at the same time');
  });
  test('stages move only by action: reason, ask everyone, escalate', () => {
    const r = coverReasonMove(open(), 'Sickness', STAGES, AT, 4, 'Willow House');
    if (!('cover' in r)) throw new Error('refused');
    expect([r.cover.stage, r.cover.log.length, coverNext(r.cover, STAGES)]).toEqual([2, 1,
      'Next it opens to all cleared bank workers. The configured wait is 30 minutes.']);
    const relabel = coverReasonMove(r.cover, 'Vacancy', STAGES, AT, 4, 'Willow House');
    expect('cover' in relabel && [relabel.cover.reason, relabel.cover.log.length]).toEqual(['Vacancy', 1]);
    const all = coverAskAllMove(r.cover, STAGES, AT, 9);
    if (!('cover' in all)) throw new Error('refused');
    expect([all.cover.stage, all.cover.asked, all.cover.log.at(-1)?.audience]).toEqual([3, 'Everyone cleared to work has been asked', 'All cleared bank workers']);
    const esc = coverEscalateMove(all.cover, STAGES, AT);
    if (!('cover' in esc)) throw new Error('refused');
    expect([esc.cover.stage, esc.cover.log.at(-1)?.sent, coverNext(esc.cover, STAGES)]).toEqual([4, 1, 'With the Service Manager. Next: agency / manual booking.']);
    expect(coverNext(open(), STAGES)).toBe('Choose a reason to start');
  });
  test('cover refusals', () => {
    expect(coverReasonMove(open(), 'Bored', STAGES, AT, 0, 'Willow House')).toMatchObject({ problem: { message: 'Choose a reason.', field: 'reason' } });
    expect(coverAskAllMove(open(), STAGES, AT, 0)).toMatchObject({ problem: { message: 'Choose a reason first.' } });
    expect(coverEscalateMove(open(), [], AT)).toMatchObject({ problem: { message: 'Keep at least one stage.' } });
    expect(coverClosed(open({ open: false }))?.message).toBe('This cover request is already closed.');
    expect(coverEscalateMove(open({ open: false }), STAGES, AT)).toMatchObject({ problem: { code: 'COVER_CLOSED' } });
  });
  test('confirming a filled shift raises the IT access request', () => {
    const f = { coverId: 'cov_1', location: 'WH', date: '2026-08-15', shift: 'E', personCode: 'CP-1310', name: 'Ellie Warren', confirmed: false, itRequest: '' };
    expect(confirmProblem(f)).toBeNull();
    expect(confirmProblem({ ...f, confirmed: true })?.message).toBe('This shift is already confirmed as worked.');
    expect(itRequestFor(f, 0, 'Bank', AT, 'Willow House', SHIFTS)).toEqual({ ref: 'ITR-1007', personCode: 'CP-1310', name: 'Ellie Warren', location: 'Willow House',
      shift: 'Early · 07:00–15:00', date: '2026-08-15', worker: 'Bank', status: 'Raised', raisedAt: AT, system: 'IT service desk (simulated)' });
    expect([confirmSummary('ITR-1007'), confirmSummary('')]).toEqual(['Confirmed. IT access request ITR-1007 raised.', 'Confirmed as worked.']);
  });
  test('open shifts: offered only where the person is eligible, with why', () => {
    const covers = [open({ reason: 'Sickness' }), open({ shift: 'L' }), open({ location: 'BC', reason: 'Sickness' }), open({ shift: 'N', reason: 'Sickness', open: false })];
    const me = { ...worker(), location: 'WH' };
    const why = (w: typeof me, c = ctx()) => openShiftsFor(w, covers, () => line(), c).map(x => x.why);
    expect(why(me)).toEqual(['You are cleared and available for this shift']);
    expect(why({ ...me, favourite: true })).toEqual(['You are a favourite here, so it is offered to you first']);
    expect(why({ ...me, preferredDays: [1] })).toEqual(['Matches the days you said you can work']);
    expect(why({ ...me, cleared: false })).toEqual([]);
    expect(why({ ...me, cleared: false }, ctx({ safeWorker: false }))).toEqual(['Open at your location']);
    expect(claimRefusal({ rule: 'Clearance', reason: 'Not cleared to work' })).toBe('You cannot take that shift. Not cleared to work.');
  });
  test('notices', () => {
    expect(shiftAssignedNotice(SHIFTS, 'E', '2026-08-11', 'Willow House')).toEqual({ title: 'Shift assigned', body: 'Early on Tue 11 Aug at Willow House' });
    expect(coverageIssueNotice('Willow House', '2026-08-11', 4)).toEqual({ title: 'Coverage issue · Willow House',
      body: 'Tue 11 Aug is below the minimum of 4. A cover request is open.' });
  });
});

describe('the timesheet\'s rota line (D16)', () => {
  const tctx = { shifts: SHIFTS, typeRota: SHIFT_TYPE, config: DEFAULT_ROTA_CONFIG, typeName: 'Support Worker' };
  test('a shift cell is a line with the rest either side; rest, leave and sickness are not', () => {
    expect(rotaInputFor(line('L', 'E'), 1, tctx)).toEqual({ line: { code: 'E', name: 'Early', hours: 7.5, cross: false },
      rest: { gapHours: 9, ruleHours: 11, typeName: 'Support Worker' } });
    expect(rotaInputFor(line('N'), 0, tctx)?.line).toEqual({ code: 'N', name: 'Night', hours: 9, cross: true });
    expect([rotaInputFor(line('V'), 0, tctx), rotaInputFor(line('S'), 0, tctx), rotaInputFor(line(), 0, tctx), rotaInputFor(undefined, 0, tctx)])
      .toEqual([undefined, undefined, undefined, undefined]);
  });
  test('a day of the published rota reads as its shift with times and hours, a rest day, leave or sickness', () => {
    expect(rotaDayOf('N', SHIFTS)).toEqual({ code: 'N', name: 'Night', from: '22:00', to: '07:00', time: '22:00–07:00', hours: 9, cross: true });
    expect(rotaDayOf('', SHIFTS)).toMatchObject({ code: '', name: 'Rest day', hours: 0 });
    expect(rotaDayOf('X', SHIFTS)).toMatchObject({ code: '', name: 'Rest day' });
    expect([rotaDayOf('V', SHIFTS).name, rotaDayOf('S', SHIFTS).name]).toEqual(['Annual leave', 'Sickness']);
    expect(rotaDaysOf(line('E', '', 'V'), SHIFTS).map(d => d.code)).toEqual(['E', '', 'V', '', '', '', '']);
  });
});

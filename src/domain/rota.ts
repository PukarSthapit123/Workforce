/* Rota rules. Ported from the prototype (qnipay-workforce-v15.html: SHIFTS and
   recalcShift, "9b-i. ROTA WEEK STORE + LIFECYCLE", eligibility, suggest,
   thinnest, hoursPosition, genRange, applyPattern, repeatWeek, the copy, clear,
   publish and cover handlers, openShiftsFor). Every function is pure: the
   shift catalogue, the config, the clock and the lines come in as arguments, so
   the server refuses with exactly what the screen warns about.

   A rota week is one record per location and week (brief D1). Its lines map a
   person code to seven cells, Monday first. A cell holds a shift code, '' (rest),
   'V' (leave) or 'S' (sickness). Messages are the prototype's, with each em-dash
   aside rewritten as its own sentence (listed in the module report). */
import type { Problem } from './codes';
import type { RotaInput } from './timesheet';
import {
  addDays, addMonths, daysBetween, dowMon, DOW_SHORT, fmtMin, formatDay, formatDmy, isIsoDate, isoWeek, periodStart,
  restGap, toMin, type ShiftSpan,
} from './time';

/* ------------------------------------------------------------------ cells */
export const LEAVE = 'V';
export const SICK = 'S';
export type Line = readonly string[];
export const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const emptyLine = (): string[] => ['', '', '', '', '', '', ''];
export const isAbsence = (c: string | undefined) => c === LEAVE || c === SICK;
/* A cell that puts somebody on shift: anything but rest, leave and sickness. */
export const isWorking = (c: string | undefined) => !!c && !isAbsence(c);
/* A line is always seven cells; a missing line is a week of rest. */
export const normLine = (line: Line | undefined): string[] => DAYS.map(i => String(line?.[i] ?? ''));
/* A refusal the server sends as it is: code, message and what to do next. */
export interface RotaRefusal { code: string; message: string; next: string; field?: string }

/* ----------------------------------------------------------- shift types */
export type ShiftTone = 'E' | 'L' | 'N';
/* The colour a shift is drawn in. The prototype's labels were "Early — blue". */
export const SHIFT_TONES: readonly (readonly [ShiftTone, string])[] = [['E', 'Early (blue)'], ['L', 'Late (amber)'], ['N', 'Night (violet)']];
const isTone = (t: unknown): t is ShiftTone => t === 'E' || t === 'L' || t === 'N';
export interface ShiftTypeInput { code: string; name: string; from: string; to: string; breakMinutes: number; night: boolean; tone?: string }
export interface ShiftType {
  code: string; name: string; from: string; to: string; breakMinutes: number; night: boolean; tone: ShiftTone;
  /* derived from the times, never typed (PEOP144) */
  hours: number; cross: boolean; start: number; end: number;
}
/* A shift is defined by its times; its length, whether it crosses midnight and
   where it sits on the 24-hour line are derived. null when a time is not a time. */
export function recalcShift(s: ShiftTypeInput): ShiftType | null {
  const f = toMin(s.from), t = toMin(s.to);
  if (f == null || t == null) return null;
  let span = t - f;
  if (span <= 0) span += 1440;
  const breakMinutes = Math.max(0, Number(s.breakMinutes) || 0);
  const hours = Number(((span - Math.min(breakMinutes, span)) / 60).toFixed(2));
  const start = f / 60, end = start + span / 60;
  const tone: ShiftTone = isTone(s.tone) ? s.tone : start >= 20 || end > 24 ? 'N' : start >= 12 ? 'L' : 'E';
  return { code: s.code, name: s.name, from: fmtMin(f), to: fmtMin(t), breakMinutes, night: !!s.night, tone,
    hours: hours === Math.round(hours) ? Math.round(hours) : hours, cross: t <= f, start, end };
}
export const shiftBy = (shifts: readonly ShiftType[], code: string) => shifts.find(s => s.code === code);
/* What a cell may hold: rest, leave, sickness or a shift in the catalogue. */
export const isValidCell = (c: string, shifts: readonly ShiftType[]) => c === '' || isAbsence(c) || !!shiftBy(shifts, c);
/* HRS, SHNAME, TIME, SHORTT and shLetter. */
export const shiftHours = (shifts: readonly ShiftType[], code: string) => shiftBy(shifts, code)?.hours ?? 0;
export const shiftName = (shifts: readonly ShiftType[], code: string) =>
  (code === LEAVE ? 'Annual leave' : code === SICK ? 'Sickness' : shiftBy(shifts, code)?.name ?? '');
export const shiftTime = (shifts: readonly ShiftType[], code: string) => {
  if (code === LEAVE) return 'Annual leave';
  if (code === SICK) return 'Sickness';
  const s = shiftBy(shifts, code);
  return s ? `${s.from}–${s.to}` : '';
};
export const shiftShortTime = (shifts: readonly ShiftType[], code: string) => {
  if (code === LEAVE) return 'Leave';
  if (code === SICK) return 'Sickness';
  const s = shiftBy(shifts, code);
  return s ? `${s.from.slice(0, 5)}–${s.to.slice(0, 2)}` : '';
};
export const shiftLetter = (code: string) => (code === LEAVE ? 'AL' : code);
/* Custom codes take their tone, so they inherit a palette rather than render unstyled. */
export const toneOf = (shifts: readonly ShiftType[], code: string) => shiftBy(shifts, code)?.tone ?? code;
/* The catalogue in its order on the 24-hour line. */
export const sortShifts = (shifts: readonly ShiftType[]) => [...shifts].sort((a, b) => a.start - b.start);

export const SHIFT_CODE = /^[A-Z0-9]{1,4}$/;
/* ns-create and the inline time edits. `existing` is every code in the catalogue. */
export function shiftTypeProblem(s: ShiftTypeInput, existing: readonly string[], creating: boolean): Problem | null {
  const code = s.code.trim().toUpperCase();
  if (creating && (!SHIFT_CODE.test(code) || existing.includes(code) || isAbsence(code)))
    return { field: 'code', message: 'A unique code of 1–4 characters is required.' };
  if (!s.name.trim()) return { field: 'name', message: 'A name is required.' };
  if (toMin(s.from) == null) return { field: 'from', message: 'Use a 24-hour time such as 16:00.' };
  if (toMin(s.to) == null) return { field: 'to', message: 'Use a 24-hour time such as 00:30.' };
  if (toMin(s.from) === toMin(s.to)) return { field: 'to', message: 'A shift cannot start and finish at the same time.' };
  const b = Number(s.breakMinutes);
  if (!Number.isInteger(b) || b < 0 || b > 180) return { field: 'breakMinutes', message: 'The unpaid break must be a whole number of minutes from 0 to 180.' };
  if (s.tone !== undefined && !isTone(s.tone)) return { field: 'tone', message: 'Choose a colour from the list.' };
  return null;
}
/* How many cells and pattern days hold a code: the counts the removal refusal quotes. */
export const shiftUsage = (code: string, lines: Iterable<Line>) => { let n = 0; for (const l of lines) n += l.filter(c => c === code).length; return n; };
export const patternUsage = (code: string, patterns: readonly { days: readonly string[] }[]) =>
  patterns.reduce((a, p) => a + p.days.filter(c => c === code).length, 0);
export function shiftRemovalProblem(s: ShiftType, catalogueSize: number, rotaDays: number, patternDays: number): Problem | null {
  if (catalogueSize < 2) return { field: 'code', message: 'Keep at least one shift type.' };
  if (rotaDays || patternDays)
    return { field: 'code', message: `${s.name} is still in use on ${rotaDays} rota day(s) and ${patternDays} pattern day(s). Clear those first.` };
  return null;
}

/* ------------------------------------------------- per-type rota limits */
export interface TypeRota { shifts: string[]; night: boolean; maxHours: number; restHours: number; maxConsec: number; flexible: boolean }
/* typeRota's default, for a type with no rota block. */
export const DEFAULT_TYPE_ROTA: TypeRota = { shifts: ['E', 'L', 'N'], night: true, maxHours: 48, restHours: 11, maxConsec: 6, flexible: false };
export const typeRotaFor = (types: Readonly<Record<string, TypeRota>>, code: string): TypeRota =>
  (Object.hasOwn(types, code) ? types[code] : undefined) ?? DEFAULT_TYPE_ROTA;
const mapTypes = (types: Readonly<Record<string, TypeRota>>, fn: (t: TypeRota) => TypeRota) =>
  Object.fromEntries(Object.entries(types).map(([k, t]) => [k, fn(t)]));
/* ns-create with "Make every employee type eligible": every type takes it, except a night shift on a type that is not night-eligible. */
export const typesAfterShiftCreate = (types: Readonly<Record<string, TypeRota>>, s: ShiftType, eligibleAll: boolean) =>
  (eligibleAll ? mapTypes(types, t => (s.night && !t.night) || t.shifts.includes(s.code) ? t : { ...t, shifts: [...t.shifts, s.code] }) : { ...types });
/* A shift turned into a night shift leaves every type that is not night-eligible. */
export const typesAfterNightChange = (types: Readonly<Record<string, TypeRota>>, code: string, night: boolean) =>
  (night ? mapTypes(types, t => (t.night ? t : { ...t, shifts: t.shifts.filter(c => c !== code) })) : { ...types });
/* A removed shift type is stripped from every type's rota.shifts (D12). */
export const typesWithoutShift = (types: Readonly<Record<string, TypeRota>>, code: string) =>
  mapTypes(types, t => ({ ...t, shifts: t.shifts.filter(c => c !== code) }));

/* ------------------------------------------------------- rota config */
export interface SafeRules { clearance: boolean; quals: boolean; night: boolean; availability: boolean; conflicts: boolean; maxHours: boolean; rest: boolean; consec: boolean }
export const SAFE_RULE_KEYS = ['clearance', 'quals', 'night', 'availability', 'conflicts', 'maxHours', 'rest', 'consec'] as const;
export const ROTA_BUILT_BY = ['Admins only', 'Admins and managers'] as const;
export interface RotaConfig {
  minDefault: number; maxHours: number; capTolerance: number; restHours: number; restWarn: boolean; maxConsec: number;
  horizon: number; favHeadStart: number; flexMilestones: number[]; flexNotifyTo: string;
  itAccess: boolean; agencyManual: boolean; bhEnhanced: boolean; outlook: boolean; publishBlockOnGap: boolean;
  rotaBuiltBy: string; safeRules: SafeRules;
}
/* The prototype's ROTA_CFG. */
export const DEFAULT_ROTA_CONFIG: RotaConfig = {
  minDefault: 4, maxHours: 45, capTolerance: 1, restHours: 11, restWarn: true, maxConsec: 6, horizon: 12, favHeadStart: 15,
  flexMilestones: [9, 12], flexNotifyTo: 'HR administrators', itAccess: true, agencyManual: true, bhEnhanced: true, outlook: true,
  publishBlockOnGap: true, rotaBuiltBy: 'Admins and managers',
  safeRules: { clearance: true, quals: true, night: true, availability: true, conflicts: true, maxHours: true, rest: true, consec: true },
};
export interface FulfilStage { n: number; audience: string; wait: number; channel: string; next: string }
export const FULFIL_AUDIENCES = ['Employees at location', 'Favourite bank workers', 'All cleared bank workers',
  'Everyone cleared organisation-wide', 'Service Manager', 'Agency partners'] as const;
/* NOTIF_CHANNELS less 'Off': a stage always notifies somebody. */
export const FULFIL_CHANNELS = ['In-app', 'Email', 'In-app + email', 'In-app + email + SMS'] as const;
export const HORIZONS = [12, 6, 3] as const;
/* stage-add's new row. */
export const newFulfilStage = (n: number): FulfilStage =>
  ({ n, audience: 'Everyone cleared organisation-wide', wait: 60, channel: 'In-app + email', next: 'Manager escalation' });
/* Stages are numbered by position, so a removal renumbers the rest. */
export const renumberStages = (stages: readonly FulfilStage[]) => stages.map((s, i) => ({ ...s, n: i + 1 }));

/* The tenant policy above the permission matrix: "Admins only" withholds
   pattern and shift-type building from managers, whatever the matrix says. */
export const rotaPolicyWithholds = (capability: string, userType: string, rotaBuiltBy: string) =>
  (capability === 'rota_pattern' || capability === 'rota_shift') && userType === 'manager' && rotaBuiltBy === 'Admins only';

const whole = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
const num = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
/* Checked on every Rota setup save, so a config the rules could not run on is never stored. */
export function rotaConfigProblem(c: RotaConfig, stages: readonly FulfilStage[], types: Readonly<Record<string, TypeRota>>,
  ctx: { employeeTypes: readonly string[]; shiftCodes: readonly string[] }): Problem | null {
  const bad = (field: string, message: string): Problem => ({ field, message });
  if (!whole(c.minDefault, 1, 50)) return bad('minDefault', 'Default people per shift must be a whole number from 1 to 50.');
  if (!num(c.restHours, 0, 24)) return bad('restHours', 'Minimum rest must be from 0 to 24 hours.');
  if (!num(c.maxHours, 1, 168)) return bad('maxHours', 'Maximum hours must be more than 0 and at most 168.');
  if (!whole(c.maxConsec, 1, 14)) return bad('maxConsec', 'Maximum consecutive days must be a whole number from 1 to 14.');
  if (!(HORIZONS as readonly number[]).includes(c.horizon)) return bad('horizon', 'Choose a rota horizon of 12, 6 or 3 months.');
  if (!whole(c.favHeadStart, 0, 1440)) return bad('favHeadStart', 'The favourite head start must be a whole number of minutes from 0 to 1440.');
  if (!(ROTA_BUILT_BY as readonly string[]).includes(c.rotaBuiltBy)) return bad('rotaBuiltBy', 'Choose who builds the rota from the list.');
  if (!c.flexMilestones.every(m => whole(m, 1, 52))) return bad('flexMilestones', 'Each milestone must be a whole number of weeks from 1 to 52.');
  if (!stages.length) return bad('stages', 'Keep at least one stage.');
  for (const [i, s] of stages.entries()) {
    if (!(FULFIL_AUDIENCES as readonly string[]).includes(s.audience)) return bad(`stages.${i}.audience`, 'Choose an audience from the list.');
    if (!whole(s.wait, 0, 10080)) return bad(`stages.${i}.wait`, 'A wait must be a whole number of minutes from 0 to 10080.');
    if (!(FULFIL_CHANNELS as readonly string[]).includes(s.channel)) return bad(`stages.${i}.channel`, 'Choose a notification channel from the list.');
  }
  for (const [code, t] of Object.entries(types)) {
    if (!ctx.employeeTypes.includes(code)) return bad(`types.${code}`, `There is no employee type with the code ${code}.`);
    const unknown = t.shifts.find(s => !ctx.shiftCodes.includes(s));
    if (unknown) return bad(`types.${code}.shifts`, `${unknown} is not a shift type.`);
    if (!num(t.maxHours, 1, 168)) return bad(`types.${code}.maxHours`, 'Maximum hours must be more than 0 and at most 168.');
    if (!num(t.restHours, 0, 24)) return bad(`types.${code}.restHours`, 'Minimum rest must be from 0 to 24 hours.');
    if (!whole(t.maxConsec, 1, 14)) return bad(`types.${code}.maxConsec`, 'Maximum consecutive days must be a whole number from 1 to 14.');
  }
  return null;
}

/* ----------------------------------------------------- states (D2) */
export const ROTA_STATES = ['draft', 'review', 'published', 'amendment', 'republished'] as const;
export type RotaStateKey = (typeof ROTA_STATES)[number];
export type RotaTone = 'neu' | 'warn' | 'ok';
export interface RotaStateInfo { label: string; tone: RotaTone; glyph: string; next: readonly RotaStateKey[] }
export const ROTA_STATE: Record<RotaStateKey, RotaStateInfo> = {
  draft: { label: 'Draft', tone: 'neu', glyph: '—', next: ['review', 'published'] },
  review: { label: 'In review', tone: 'warn', glyph: '◷', next: ['draft', 'published'] },
  published: { label: 'Published', tone: 'ok', glyph: '✓', next: ['amendment'] },
  amendment: { label: 'Amended', tone: 'warn', glyph: '✎', next: ['republished'] },
  republished: { label: 'Republished', tone: 'ok', glyph: '✓', next: ['amendment'] },
};
export const isRotaState = (s: unknown): s is RotaStateKey => typeof s === 'string' && (ROTA_STATES as readonly string[]).includes(s);
export const rotaState = (s: string): RotaStateInfo => (isRotaState(s) ? ROTA_STATE[s] : ROTA_STATE.draft);
/* Published or republished: publishing again needs a change first. */
export const rotaLive = (s: string) => s === 'published' || s === 'republished';
/* Colleagues can see it (D14): published, amended or republished. Every guard
   that protects what staff see (a change recorded as an amendment, clear,
   copy, repeat and generate) uses this, so an amended week is protected as a
   published one is. */
export const rotaVisible = (s: string) => rotaLive(s) || s === 'amendment';
export const rotaCan = (from: string, to: string) => isRotaState(from) && isRotaState(to) && ROTA_STATE[from].next.includes(to);
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'An' : 'A');
/* null when the move is allowed. P's texts: "A published rota cannot go back to review", "A draft rota cannot be republished". */
export function rotaTransitionProblem(from: string, to: string): RotaRefusal | null {
  if (rotaCan(from, to)) return null;
  const f = rotaState(from), w = f.label.toLowerCase();
  const verb = to === 'review' ? 'go back to review' : to === 'draft' ? 'go back to draft' : to === 'amendment' ? 'be amended' : `be ${to}`;
  const allowed = f.next.map(s => ROTA_STATE[s].label.toLowerCase());
  return { code: 'TRANSITION_NOT_ALLOWED', message: `${article(w)} ${w} rota cannot ${verb}.`,
    next: allowed.length ? `From ${w} it can move to ${allowed.join(' or ')}.` : 'Change a shift first.' };
}

/* -------------------------------------------------------- the week (D1) */
export interface RotaActor { personCode: string; name: string }
/* A row of the week's change log. `afterPublish` marks an amendment to a live week; `version` is the publication it amends. */
export interface RotaChange {
  at: string; by: RotaActor; personCode: string; name: string; date: string;
  from: string; to: string; why: string; afterPublish: boolean; version: number;
}
export interface RotaWeekCore {
  location: string; weekStart: string; lines: Record<string, string[]>;
  state: RotaStateKey; publishVersion: number; publishedAt: string; publishedBy: RotaActor | null; changes: RotaChange[];
}
export const rotaWeekId = (location: string, weekStart: string) => `rw_${location}_${weekStart}`;
/* An untouched week is genuinely empty: it does not inherit another week's lines. */
export const emptyWeek = (location: string, weekStart: string): RotaWeekCore =>
  ({ location, weekStart, lines: {}, state: 'draft', publishVersion: 0, publishedAt: '', publishedBy: null, changes: [] });
export const lineOf = (week: Pick<RotaWeekCore, 'lines'> | undefined, personCode: string) =>
  normLine(week && Object.hasOwn(week.lines, personCode) ? week.lines[personCode] : undefined);
export const dayOf = (weekStart: string, date: string) => daysBetween(weekStart, date);
export const weekStartOf = periodStart;

/* rotaChange: every path that writes a cell records it. A change to a week
   colleagues can see is an amendment: it is marked afterPublish and moves the
   week to amendment (an amended week stays amended). */
export interface CellWrite { personCode: string; name: string; day: number; to: string; by: RotaActor; at: string; why: string }
export function setCell(week: RotaWeekCore, w: CellWrite): { week: RotaWeekCore; change: RotaChange; amended: boolean } {
  const line = lineOf(week, w.personCode), from = line[w.day] ?? '';
  line[w.day] = w.to;
  const live = rotaVisible(week.state);
  const change: RotaChange = { at: w.at, by: w.by, personCode: w.personCode, name: w.name, date: addDays(week.weekStart, w.day),
    from, to: w.to, why: w.why, afterPublish: live, version: week.publishVersion };
  return { week: { ...week, lines: { ...week.lines, [w.personCode]: line }, state: live ? 'amendment' : week.state,
    changes: [change, ...week.changes] }, change, amended: live };
}
/* Several cell writes against one week, as one request (accept plan, clear). */
export function setCells(week: RotaWeekCore, writes: readonly CellWrite[]) {
  let w = week, amended = false;
  const changes: RotaChange[] = [];
  for (const c of writes) { const r = setCell(w, c); w = r.week; changes.push(r.change); amended ||= r.amended; }
  return { week: w, changes, amended };
}
const nameOrNothing = (shifts: readonly ShiftType[], code: string) => (code ? shiftName(shifts, code) || code : 'nothing');
/* "Published rota amended": the audit detail and the colleague's notice. */
export const amendedAuditText = (locName: string, week: RotaWeekCore, c: RotaChange, shifts: readonly ShiftType[]) =>
  `${locName} · week ${isoWeek(week.weekStart)} v${c.version} · ${c.name} · ${nameOrNothing(shifts, c.from)} → ${nameOrNothing(shifts, c.to)}`;
export const amendedNotice = (weekStart: string, day: number) => ({ title: 'Rota amended',
  body: `Week ${isoWeek(weekStart)} · your shift on ${DOW_SHORT[day] ?? ''} has changed. Check your shifts.` });

/* ----------------------------------------------------------- coverage */
/* onShift: people at the location on shift that day. */
export const onShift = (lines: readonly Line[], day: number) => lines.filter(l => isWorking(l[day])).length;
/* minFor: the location's minimum while minimum staffing is on, else no minimum. */
export const minFor = (locationMin: number | undefined, minStaffOn: boolean, cfg: Pick<RotaConfig, 'minDefault'>) =>
  (minStaffOn ? locationMin ?? cfg.minDefault : 0);
export const gapDays = (lines: readonly Line[], min: number) => DAYS.filter(i => onShift(lines, i) < min);
export const gapsAt = (lines: readonly Line[], min: number) => gapDays(lines, min).length;
/* Per day, how many of each shift code is on: the grid's cover row and the live legend. */
export const coverage = (lines: readonly Line[], shifts: readonly ShiftType[]) =>
  DAYS.map(i => Object.fromEntries(shifts.map(s => [s.code, lines.filter(l => l[i] === s.code).length])) as Record<string, number>);
/* rotaKey: what is on the grid, counted. */
export function rotaKeyCounts(lines: readonly Line[]) {
  const shifts: Record<string, number> = {};
  let leave = 0, sick = 0, empty = 0;
  for (const l of lines) for (const c of normLine(l)) {
    if (!c) empty++; else if (c === LEAVE) leave++; else if (c === SICK) sick++; else shifts[c] = (shifts[c] ?? 0) + 1;
  }
  return { shifts, leave, sick, empty };
}
/* The banner when cover falls short. */
export const gapBannerText = (min: number, level: string, blockOnGap: boolean) =>
  `Cover falls below the minimum of ${min} set by the ${level.toLowerCase()} support level.${blockOnGap ? ' This rota cannot be published.' : ''}`;

/* ------------------------------------------------------------ publish (D3) */
export const COVERAGE_GAPS = 'Coverage gaps block publishing.';
export function publishProblem(week: Pick<RotaWeekCore, 'state' | 'publishVersion' | 'weekStart'>, gaps: number, blockOnGap: boolean): RotaRefusal | null {
  if (blockOnGap && gaps)
    return { code: 'COVERAGE_GAPS', message: COVERAGE_GAPS,
      next: 'Fill the days below the minimum first, or turn off "Coverage gaps block publishing" in Rota setup.' };
  if (rotaLive(week.state))
    return { code: 'ALREADY_PUBLISHED', message: `Week ${isoWeek(week.weekStart)} is already ${rotaState(week.state).label.toLowerCase()} at v${week.publishVersion}. Change a shift first if you need to republish.`,
      next: 'Change a shift, then republish.' };
  return rotaTransitionProblem(week.state, publishTarget(week.state));
}
/* An amended week is republished; anything else is published. */
export const publishTarget = (state: string): RotaStateKey => (state === 'amendment' ? 'republished' : 'published');
/* publishWeek: the state and version move together; `amended` counts the changes made against the publication it replaces. */
export function publishWeek(week: RotaWeekCore, by: RotaActor, at: string) {
  const to = publishTarget(week.state);
  const amended = to === 'republished' ? week.changes.filter(c => c.afterPublish && c.version === week.publishVersion).length : 0;
  const version = week.publishVersion + 1;
  return { week: { ...week, state: to, publishVersion: version, publishedAt: at, publishedBy: by }, version, amended, republished: to === 'republished' };
}
export const publishNotice = (locName: string, weekStart: string, version: number, republished: boolean) => ({
  title: republished ? 'Rota republished' : 'Rota published',
  body: `${locName} · ${formatDmy(weekStart)} – ${formatDmy(addDays(weekStart, 6))} · v${version}`,
});
export const publishAuditText = (locName: string, weekStart: string, version: number, amended: number) =>
  `${locName} · week ${isoWeek(weekStart)} · v${version}${amended ? ` · ${amended} amendment(s) included` : ''}`;
export const publishSummary = (version: number, notified: number, amended: number, republished: boolean) =>
  `Rota ${republished ? 'republished' : 'published'} · v${version} · ${notified} colleagues notified${amended ? ` · ${amended} amendment(s) included` : ''}`;

/* ------------------------------------------------- hours and rest helpers */
export interface RotaWorker {
  code: string; name: string; employeeType: string; typeName: string; jobProfile: string; category: string;
  contractedHours: number; maxHours: number; night: boolean;
  /* safe-worker facts (rotaProfiles) */
  cleared: boolean; dbsExpiry: string; qualifications: string; favourite: boolean; preferredDays: readonly number[];
}
export interface RuleContext { shifts: readonly ShiftType[]; typeRota: TypeRota; config: RotaConfig; safeWorker: boolean }
export const rotadHours = (line: Line, shifts: readonly ShiftType[]) => line.reduce((a, c) => a + shiftHours(shifts, c), 0);
export const nightsIn = (line: Line, shifts: readonly ShiftType[]) => line.filter(c => shiftBy(shifts, c)?.night).length;
/* The lowest of the person's own maximum, their type's and the tenant's (Rota setup says the lower applies). */
export const hoursCap = (w: Pick<RotaWorker, 'maxHours'>, tr: TypeRota, cfg: Pick<RotaConfig, 'maxHours'>) =>
  Math.min(w.maxHours || 99, tr.maxHours || 99, cfg.maxHours || 99);
export const restNeed = (tr: TypeRota, cfg: Pick<RotaConfig, 'restHours'>) => tr.restHours || cfg.restHours;
export const consecLimit = (tr: TypeRota, cfg: Pick<RotaConfig, 'maxConsec'>) => tr.maxConsec || cfg.maxConsec;
/* Each day's shift as hours from Monday 00:00 of its day, for restGap. */
export const lineSpans = (line: Line, shifts: readonly ShiftType[]): (ShiftSpan | null)[] =>
  DAYS.map(i => { const s = shiftBy(shifts, line[i] ?? ''); return s ? { start: s.start, end: s.end } : null; });
/* Rest either side of `code` on `day`, against the rest of the line; -1 when they overlap. */
export const restAround = (line: Line, day: number, code: string, shifts: readonly ShiftType[]) => {
  const s = shiftBy(shifts, code);
  return restGap(lineSpans(line, shifts), day, s ? { start: s.start, end: s.end } : null);
};
/* consecRun: the run of working days `day` would sit in, itself included. */
export function consecRun(line: Line, day: number, shifts: readonly ShiftType[]) {
  let run = 1;
  for (let k = day - 1; k >= 0 && shiftHours(shifts, line[k] ?? ''); k--) run++;
  for (let k = day + 1; k < 7 && shiftHours(shifts, line[k] ?? ''); k++) run++;
  return run;
}
/* lineRestIssues: day pairs whose rest is below `need`. */
export function lineRestIssues(line: Line, need: number, shifts: readonly ShiftType[]) {
  const out: { i: number; rest: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = shiftBy(shifts, line[i] ?? ''), b = shiftBy(shifts, line[i + 1] ?? '');
    if (!a || !b) continue;
    const end = (toMin(a.to) ?? 0) + (a.cross ? 1440 : 0);
    const rest = ((toMin(b.from) ?? 0) + 1440 - end) / 60;
    if (rest < need) out.push({ i, rest: Number(rest.toFixed(1)) });
  }
  return out;
}

/* ------------------------------------------------------- eligibility (D4) */
export interface Exclusion { rule: string; reason: string }
/* PEOP167: every exclusion names its rule. The master switch (SAFEWORKER) gates
   every rule beneath it; shift-type eligibility is what the employee type is for,
   so it survives the switch. `line` is the person's week as it stands. */
export function eligibility(w: RotaWorker, line: Line, day: number, code: string, ctx: RuleContext): Exclusion[] {
  const { typeRota: tr, config: cfg, shifts } = ctx, out: Exclusion[] = [];
  const typeRule = (): Exclusion => ({ rule: 'Shift eligibility', reason: `${w.typeName} is not eligible for ${shiftName(shifts, code).toLowerCase()} shifts` });
  if (!ctx.safeWorker) return tr.shifts.includes(code) ? out : [typeRule()];
  const R = cfg.safeRules, c = line[day] ?? '', s = shiftBy(shifts, code);
  if (R.availability && c === LEAVE) out.push({ rule: 'Availability', reason: 'On approved leave' });
  if (R.availability && c === SICK) out.push({ rule: 'Availability', reason: 'Recorded as off sick' });
  if (R.conflicts && isWorking(c)) out.push({ rule: 'Shift conflict', reason: 'Already working that day' });
  if (R.clearance && !w.cleared)
    out.push({ rule: 'Clearance', reason: w.dbsExpiry ? `Not cleared to work. DBS expired ${formatDmy(w.dbsExpiry)}` : 'Not cleared to work' });
  if (R.quals && /expire[d]?\b/i.test(w.qualifications) && /expired/i.test(w.qualifications)) out.push({ rule: 'Qualification', reason: w.qualifications });
  if (R.night && s?.night && (!w.night || !tr.night)) out.push({ rule: 'Night eligibility', reason: 'Not night-trained' });
  if (!tr.shifts.includes(code)) out.push(typeRule());
  const cap = hoursCap(w, tr, cfg);
  if (R.maxHours && rotadHours(line, shifts) + shiftHours(shifts, code) > cap)
    out.push({ rule: 'Maximum hours', reason: `Would pass their ${cap}-hour maximum` });
  const gap = restAround(line, day, code, shifts);
  if (R.rest && cfg.restWarn && gap < restNeed(tr, cfg))
    out.push({ rule: 'Minimum rest', reason: gap < 0 ? 'Clashes with another shift' : `Only ${gap} hours rest before or after` });
  const run = consecRun(line, day, shifts);
  if (R.consec && run > consecLimit(tr, cfg)) out.push({ rule: 'Consecutive days', reason: `Would make ${run} days in a row` });
  return out;
}
/* The refusal sentence for a failed hard rule (D4): "<name>. <reason>." */
export const ineligibleMessage = (name: string, e: Exclusion) => `${name}. ${e.reason}.`;

/* hoursPosition (journey D): contracted, rota'd and worked, and the flags they raise. */
export type FlagTone = 'warn' | 'info' | 'err' | 'neu';
export interface HoursFlag { k: string; c: FlagTone }
export function hoursPosition(w: RotaWorker, line: Line, worked: number, ctx: Omit<RuleContext, 'safeWorker'>) {
  const { shifts, typeRota: tr, config: cfg } = ctx;
  const rot = rotadHours(line, shifts), cap = hoursCap(w, tr, cfg), flags: HoursFlag[] = [];
  if (w.contractedHours > 0 && rot > w.contractedHours) flags.push({ k: 'Over contracted', c: 'warn' });
  if (w.contractedHours > 0 && rot < w.contractedHours) flags.push({ k: 'Under contracted', c: 'info' });
  if (rot > cap) flags.push({ k: 'Over maximum', c: 'err' });
  if (worked > rot + 0.25) flags.push({ k: 'Overtime worked', c: 'warn' });
  /* the prototype read a seeded rest marker; the rest is worked out from the line instead */
  if (cfg.restWarn && lineRestIssues(line, restNeed(tr, cfg), shifts).length) flags.push({ k: 'Rest warning', c: 'err' });
  let maxRun = 0;
  for (const i of DAYS) if (shiftHours(shifts, line[i] ?? '')) maxRun = Math.max(maxRun, consecRun(line, i, shifts));
  if (maxRun > consecLimit(tr, cfg)) flags.push({ k: `${maxRun} consecutive days`, c: 'err' });
  const n = nightsIn(line, shifts);
  if (n) flags.push({ k: `${n} night${n > 1 ? 's' : ''}`, c: 'neu' });
  const r1 = (v: number) => Number(v.toFixed(1));
  return { con: w.contractedHours, rot, wk: worked, rotaVar: r1(rot - w.contractedHours), workVar: r1(worked - w.contractedHours),
    schedVar: r1(worked - rot), flags, cap };
}
/* The over-maximum banner. "Advisory only": hours warnings never block publishing. */
export const overMaximumText = (name: string, rot: number, cap: number) => `${name} is scheduled ${rot}h against a ${cap}h maximum`;
export const OVER_MAXIMUM_NOTE = 'Advisory only. Hours warnings do not block publishing, but the person is excluded from further offers.';

/* --------------------------------------------- the single assignment path */
export type AssignMode = 'assign' | 'change';
export type AssignOutcome =
  | { ok: true; line: string[]; advisories: HoursFlag[] }
  | { ok: false; code: 'UNKNOWN_SHIFT' | 'ON_LEAVE' | 'UNCHANGED' | 'ROTA_INELIGIBLE'; message: string; rule?: string };
/* assignShift: drag, keyboard, touch, the picker, cover assign, claim and accept
   plan all land here. A change replaces the day's shift, so it is judged against
   the line without it (the prototype's change select skipped eligibility).
   Advisories (warn and err hours flags on the new line) never block. */
export function assignCheck(w: RotaWorker, line: Line, day: number, code: string, mode: AssignMode, ctx: RuleContext): AssignOutcome {
  if (!shiftBy(ctx.shifts, code)) return { ok: false, code: 'UNKNOWN_SHIFT', message: `There is no shift type with the code ${code}.` };
  const cur = line[day] ?? '';
  if (isAbsence(cur)) return { ok: false, code: 'ON_LEAVE', message: `${w.name} is already down as ${cur === LEAVE ? 'on leave' : 'off sick'} that day.` };
  if (cur === code) return { ok: false, code: 'UNCHANGED', message: `${w.name} is already on ${shiftName(ctx.shifts, code)} that day.` };
  const base = normLine(line);
  if (mode === 'change') base[day] = '';
  const ex = eligibility(w, base, day, code, ctx)[0];
  if (ex) return { ok: false, code: 'ROTA_INELIGIBLE', message: ineligibleMessage(w.name, ex), rule: ex.rule };
  base[day] = code;
  const advisories = hoursPosition(w, base, 0, ctx).flags.filter(f => f.c === 'warn' || f.c === 'err');
  return { ok: true, line: base, advisories };
}

/* ------------------------------------------------- suggestions (PEOP167) */
export interface Candidate { worker: RotaWorker; line: Line; ctx: RuleContext }
export interface Suggestion { worker: RotaWorker; score: number; why: string[] }
export interface RuledOut { worker: RotaWorker; rule: string; reason: string; all: Exclusion[] }
/* suggest: hard rules first, then a score that only orders those who passed,
   with its reasoning. Nothing is assigned. */
export function suggest(day: number, code: string, people: readonly Candidate[]): { ok: Suggestion[]; no: RuledOut[] } {
  const ok: Suggestion[] = [], no: RuledOut[] = [];
  for (const { worker: p, line, ctx } of people) {
    const ex = eligibility(p, line, day, code, ctx);
    const first = ex[0];
    if (first) { no.push({ worker: p, rule: first.rule, reason: first.reason, all: ex }); continue; }
    const { shifts } = ctx, why: string[] = [], hrs = rotadHours(line, shifts);
    let sc = 0;
    if (p.contractedHours > 0) {
      const head = p.contractedHours - hrs;
      sc += Math.max(Math.min(head, 12), -12);
      if (head >= shiftHours(shifts, code)) why.push(`${head} hours below contracted`);
      else if (head <= 0) why.push('already at contracted hours');
    } else {
      sc += 4 - Math.floor(hrs / 7.5);
      why.push(hrs ? `${hrs}h booked so far this week` : 'Bank worker with no shifts yet this week');
      if (p.favourite) { sc += 3; why.push('Favourite here, so asked first'); }
      if (p.preferredDays.includes(day)) { sc += 3; why.push('Wants shifts on this day'); }
    }
    const s = shiftBy(shifts, code);
    if (s?.night) { const n = nightsIn(line, shifts); sc += (3 - n) * 2; if (n <= 1) why.push('Fewest nights this week'); }
    const run = consecRun(line, day, shifts);
    if (run >= 4) { sc -= 6; why.push(`Would make ${run} days in a row`); }
    const gap = restAround(line, day, code, shifts);
    if (gap >= 11 && gap < 24) why.push(`${gap} hours rest either side`);
    if (p.jobProfile && s && (!s.night || p.jobProfile === 'NS' || p.jobProfile === 'SSW')) sc += 1;
    ok.push({ worker: p, score: sc, why: why.slice(0, 3) });
  }
  ok.sort((a, b) => b.score - a.score);
  return { ok, no };
}
export const NO_REASONS_WHY = 'Available, cleared and qualified';
/* thinnest: the shift with the fewest people on it that day, catalogue order breaking a tie. */
export function thinnest(day: number, lines: readonly Line[], shifts: readonly ShiftType[]): string | undefined {
  const c = new Map(shifts.map(s => [s.code, 0]));
  for (const l of lines) { const v = l[day] ?? ''; const n = c.get(v); if (n !== undefined) c.set(v, n + 1); }
  return [...c.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
}
/* planWeek: up to three suggestions a day while the day is below the minimum.
   Each pick is pencilled into a copy of its line so the next one sees it. */
export type PlanItem = { day: number; code: string; none: true } | { day: number; code: string; none: false; personCode: string; name: string; why: string[] };
export function planWeek(people: readonly Candidate[], min: number, shifts: readonly ShiftType[]): PlanItem[] {
  const plan: PlanItem[] = [];
  const lines = new Map(people.map(c => [c.worker.code, normLine(c.line)]));
  const current = () => people.map(c => ({ ...c, line: lines.get(c.worker.code) ?? normLine(c.line) }));
  for (const day of DAYS) {
    let guard = 0;
    while (onShift([...lines.values()], day) < min && guard < 3) {
      const code = thinnest(day, [...lines.values()], shifts);
      if (code === undefined) break;
      const best = suggest(day, code, current()).ok[0];
      if (!best) { plan.push({ day, code, none: true }); break; }
      plan.push({ day, code, none: false, personCode: best.worker.code, name: best.worker.name, why: best.why });
      const l = lines.get(best.worker.code);
      if (l) l[day] = code;
      guard++;
    }
  }
  return plan;
}
export const planSummary = (n: number) => (n ? `Suggested ${n} assignments for you to review` : 'No suggestions possible. Advertise the gaps through a cover request.');
export const NOBODY_CAN_TAKE = 'Nobody can take that shift without breaking a hard rule.';

/* ----------------------------------------------------- the roster */
export interface RosterPerson { code: string; location: string; state: string; contractedHours: number }
/* activePeople: everyone but leavers and archived records. */
export const isActive = (p: Pick<RosterPerson, 'state'>) => p.state !== 'leaver' && p.state !== 'archived';
/* rosterAt: active people at the location with contracted hours or a shift on the week. */
export const onRoster = (p: RosterPerson, location: string, line: Line) =>
  p.location === location && isActive(p) && (p.contractedHours > 0 || line.some(c => !!c));

/* ------------------------------------------------- working patterns */
export interface PatternPerson { personCode: string; offset: number }
export interface PatternCore {
  code: string; name: string; cycle: number; locations: string[]; jobProfiles: string[]; costCentre: string;
  starts: string; horizon: number; gen: string; genFrom: string; genTo: string; active: boolean; days: string[]; people: PatternPerson[];
}
export interface GenPeriod { k: string; label: string; days?: number; months?: number; custom?: boolean }
export const GEN_PERIODS: readonly GenPeriod[] = [
  { k: '1w', label: 'One week', days: 7 },
  { k: '2w', label: 'Two weeks · fortnightly', days: 14 },
  { k: '4w', label: 'Four weeks', days: 28 },
  { k: '1m', label: 'One month', months: 1 },
  { k: '3m', label: 'Three months', months: 3 },
  { k: '6m', label: 'Six months', months: 6 },
  { k: '12m', label: 'Twelve months', months: 12 },
  { k: 'range', label: 'Between two dates', custom: true },
];
const TWELVE_MONTHS: GenPeriod = { k: '12m', label: 'Twelve months', months: 12 };
export const genBy = (k: string): GenPeriod => GEN_PERIODS.find(x => x.k === k) ?? TWELVE_MONTHS;
/* The day of the cycle a date falls on for one person, 0-based. */
export const cycleIndex = (p: Pick<PatternCore, 'starts' | 'cycle'>, offset: number, date: string) =>
  (((daysBetween(p.starts, date) + (offset - 1)) % p.cycle) + p.cycle) % p.cycle;
export type GenRange = { ok: false; message: string } | { ok: true; from: string; to: string; span: number; shifts: number; label: string; range: string };
/* genRange: the span a run covers and how many shifts it would land. */
export function genRange(p: PatternCore, today: string): GenRange {
  const per = genBy(p.gen || '12m');
  const anchor = isIsoDate(p.starts) ? p.starts : today;
  let from = anchor > today ? anchor : today, to: string;
  if (per.custom) {
    from = isIsoDate(p.genFrom) ? p.genFrom : from;
    if (!isIsoDate(p.genTo)) return { ok: false, message: 'Pick both dates for the range.' };
    to = p.genTo;
    if (daysBetween(from, to) < 0) return { ok: false, message: 'The end date is before the start date.' };
    if (daysBetween(from, to) > 731) return { ok: false, message: 'A single run cannot cover more than two years.' };
  } else {
    to = addDays(per.days ? addDays(from, per.days) : addMonths(from, per.months ?? 12), -1);
  }
  const span = daysBetween(from, to) + 1;
  let shifts = 0;
  if (p.cycle > 0 && p.days.length) {
    const base = isIsoDate(p.starts) ? p.starts : from;
    for (const x of p.people) for (let i = 0; i < span; i++)
      if (p.days[cycleIndex({ starts: base, cycle: p.cycle }, x.offset, addDays(from, i))]) shifts++;
  }
  return { ok: true, from, to, span, shifts, label: per.custom ? 'between two dates' : per.label.toLowerCase(),
    range: `${formatDmy(from)} – ${formatDmy(to)}` };
}
export const genLabel = (p: PatternCore) => genBy(p.gen || '12m').label.replace(' · fortnightly', '');

/* save-pattern's refusals, before anything is written. `scope` is the manager's location; an admin has none. */
export function patternGenerateProblem(p: PatternCore, scope: string | null, locName: (c: string) => string): Problem | null {
  if (!p.days.some(c => !!c)) return { field: 'days', message: 'Nothing to generate. Every day of the cycle is a rest day.' };
  if (!p.locations.length) return { field: 'locations', message: 'Pick at least one location before generating.' };
  if (!p.people.length) return { field: 'people', message: `Nobody is on ${p.name} yet. Add a person first.` };
  if (scope && !p.locations.includes(scope))
    return { field: 'locations', message: `${p.name} does not cover ${locName(scope)}. A manager can only generate for their own location.` };
  return null;
}
export const NO_LANDING = 'That run lands no shifts. Check the cycle and the start day.';

/* The weeks a run reads and writes: by location and Monday. */
export interface WeekSlot { state: string; lines: Readonly<Record<string, Line>> }
export type WeekLookup = (location: string, weekStart: string) => WeekSlot | undefined;
export interface WeekWrite { location: string; weekStart: string; lines: Record<string, string[]>; created: boolean }
export interface PatternPersonInfo { code: string; name: string; location: string; state: string; restNeed: number }
export type ApplyResult =
  | { ok: false; message: string }
  | { ok: true; written: number; occupied: number; absence: number; weeks: number; live: number; rest: string[]; range: string; people: number; writes: WeekWrite[] };
/* applyPattern (IMP-031): writes the run into the week store. It never
   overwrites: a filled cell is left alone and counted, leave and sickness are
   skipped, and a live week is skipped whole (D6). */
export interface ApplyContext {
  today: string; scope: string | null; people: ReadonlyMap<string, PatternPersonInfo>; weekAt: WeekLookup;
  locName: (c: string) => string; shifts: readonly ShiftType[];
}
export function applyPattern(p: PatternCore, ctx: ApplyContext): ApplyResult {
  const { today, scope, people, weekAt, locName, shifts } = ctx;
  const r = genRange(p, today);
  if (!r.ok) return { ok: false, message: r.message };
  const base = isIsoDate(p.starts) ? p.starts : r.from;
  const on = p.people.flatMap(x => { const info = people.get(x.personCode); return info && isActive(info) && (!scope || info.location === scope) ? [{ x, info }] : []; });
  if (!on.length) return { ok: false, message: scope ? `Nobody on this pattern works at ${locName(scope)}.` : 'None of the people on this pattern are on the workforce record.' };
  const writes = new Map<string, WeekWrite>(), skipped = new Set<string>(), touched = new Set<string>();
  let written = 0, occupied = 0, absence = 0;
  for (let i = 0; i < r.span; i++) {
    const dt = addDays(r.from, i), ws = periodStart(dt), dow = dowMon(dt);
    for (const { x, info } of on) {
      const key = rotaWeekId(info.location, ws), slot = weekAt(info.location, ws);
      if (slot && rotaVisible(slot.state)) { skipped.add(key); continue; }
      const code = p.days[cycleIndex({ starts: base, cycle: p.cycle }, x.offset, dt)];
      if (!code) continue;
      let w = writes.get(key);
      if (!w) {
        w = { location: info.location, weekStart: ws, created: !slot,
          lines: Object.fromEntries(Object.entries(slot?.lines ?? {}).map(([k, l]) => [k, normLine(l)])) };
        writes.set(key, w);
      }
      const line = w.lines[x.personCode] ?? emptyLine();
      w.lines[x.personCode] = line;
      const cur = line[dow] ?? '';
      if (isAbsence(cur)) { absence++; continue; }
      if (cur) { occupied++; continue; }
      line[dow] = code; written++; touched.add(key);
    }
  }
  /* rest is checked on what was actually written, per week and person */
  const rest: string[] = [];
  for (const key of touched) {
    const w = writes.get(key);
    if (!w) continue;
    for (const { x, info } of on) {
      if (info.location !== w.location) continue;
      for (const v of lineRestIssues(w.lines[x.personCode] ?? emptyLine(), info.restNeed, shifts))
        rest.push(`${info.name} · week of ${w.weekStart} · ${v.rest}h rest (needs ${info.restNeed}h)`);
    }
  }
  return { ok: true, written, occupied, absence, weeks: touched.size, live: skipped.size, rest, range: r.range, people: on.length,
    writes: [...writes.values()].filter(w => touched.has(rotaWeekId(w.location, w.weekStart))) };
}
/* The generate toast, from what was actually written. */
export function generateSummary(r: Extract<ApplyResult, { ok: true }>) {
  if (!r.written) return `Nothing written · every target cell was already filled${r.live ? ' or in a published week' : ''}`;
  return `${r.written} shift(s) written · ${r.range} · ${r.weeks} week(s) · ${r.people} ${r.people === 1 ? 'person' : 'people'}`
    + (r.occupied ? ` · ${r.occupied} cell(s) already filled, left alone` : '')
    + (r.absence ? ` · ${r.absence} skipped for leave or sickness` : '')
    + (r.live ? ` · ${r.live} published week(s) skipped. Amend those individually` : '')
    + (r.rest.length ? ` · ${r.rest.length} rest warning(s)` : '');
}
export const generateAuditText = (p: PatternCore, r: Extract<ApplyResult, { ok: true }>, scopeName: string | null) =>
  `${p.name} · ${r.range} · ${r.written} shift(s) written across ${r.weeks} week(s) · ${r.people} person(s)`
  + (scopeName ? ` · scoped to ${scopeName}` : '')
  + (r.occupied ? ` · ${r.occupied} cell(s) already filled and left alone` : '')
  + (r.live ? ` · ${r.live} published week(s) skipped` : '');

/* np-create: a new pattern starts as a draft, its cycle clamped to 1–28 days and copied from a base when one is chosen. */
export const clampCycle = (n: number, fallback = 7) => Math.max(1, Math.min(28, Math.trunc(n) || fallback));
export function patternProblem(p: Pick<PatternCore, 'name' | 'cycle' | 'days' | 'people' | 'starts' | 'gen'>, shiftCodes: readonly string[]): Problem | null {
  if (!p.name.trim()) return { field: 'name', message: 'Give the pattern a name.' };
  if (!whole(p.cycle, 1, 28) || p.days.length !== p.cycle) return { field: 'cycle', message: 'A cycle runs for 1 to 28 days.' };
  const bad = p.days.findIndex(c => c !== '' && !shiftCodes.includes(c));
  if (bad >= 0) return { field: `days.${bad}`, message: `Day ${bad + 1} of the cycle uses ${p.days[bad] ?? ''}, which is not a shift type.` };
  if (!isIsoDate(p.starts)) return { field: 'starts', message: 'Give the date the cycle starts.' };
  if (!GEN_PERIODS.some(g => g.k === p.gen)) return { field: 'gen', message: 'Choose how far a run reaches from the list.' };
  const off = p.people.findIndex(x => !whole(x.offset, 1, p.cycle));
  if (off >= 0) return { field: `people.${off}.offset`, message: `A starting day must be from 1 to ${p.cycle}.` };
  return null;
}
/* data-patcycle: shrinking drops the days beyond the new length, growing adds rest days, offsets wrap. */
export function resizeCycle<T extends Pick<PatternCore, 'cycle' | 'days' | 'people'>>(p: T, n: number): T {
  const days = p.days.slice(0, n);
  while (days.length < n) days.push('');
  return { ...p, cycle: n, days, people: p.people.map(x => (x.offset > n ? { ...x, offset: ((x.offset - 1) % n) + 1 } : x)) };
}
export const ACTIVATE_EMPTY = 'Set at least one shift in the cycle first.';
/* pp-add: stagger walks the days that carry a shift, from the chosen one; "same" puts everyone on that day. */
export function staggerOffsets(days: readonly string[], start: number, mode: 'stagger' | 'same', count: number): number[] {
  const shiftDays = days.flatMap((c, i) => (c ? [i + 1] : []));
  const ring = shiftDays.length ? shiftDays : days.map((_, i) => i + 1);
  const k = Math.max(0, ring.indexOf(start));
  return Array.from({ length: count }, (_, n) => Math.max(1, Math.min(days.length, mode === 'same' ? start : ring[(k + n) % ring.length] ?? 1)));
}
export const TICK_SOMEONE = 'Tick at least one person.';
export const alreadyOnPattern = (names: readonly string[]) => `${names.join(', ')} already on this pattern.`;

/* --------------------------------------- repeat, copy and clear (D6) */
export const REPEAT_WEEKS = [2, 4, 8, 13, 26, 52] as const;
export interface CountResult { written: number; occupied: number; absence: number; live: number; weeks: number; writes: WeekWrite[] }
/* Copy one source line into a target line: shifts only, into empty cells only. */
function fillInto(src: Line, target: string[], counts: { written: number; occupied: number; absence: number }) {
  let any = false;
  src.forEach((code, i) => {
    if (!isWorking(code)) return;
    const cur = target[i] ?? '';
    if (isAbsence(cur)) { counts.absence++; return; }
    if (cur) { counts.occupied++; return; }
    target[i] = code; counts.written++; any = true;
  });
  return any;
}
const copyLines = (slot: Pick<WeekSlot, 'lines'> | undefined) => Object.fromEntries(Object.entries(slot?.lines ?? {}).map(([k, l]) => [k, normLine(l)]));
/* repeatWeek (IMP-032): the week forward `weeks` times for the roster. */
export function repeatWeek(location: string, fromWeek: string, src: WeekSlot, roster: readonly string[], weeks: number, weekAt: WeekLookup): CountResult {
  const counts = { written: 0, occupied: 0, absence: 0 }, writes: WeekWrite[] = [];
  let live = 0;
  for (let w = 1; w <= weeks; w++) {
    const ws = addDays(fromWeek, 7 * w), target = weekAt(location, ws);
    if (target && rotaVisible(target.state)) { live++; continue; }
    const lines = copyLines(target);
    let any = false;
    for (const id of roster) {
      const line = src.lines[id];
      if (!line) continue;
      const t = lines[id] ?? emptyLine();
      lines[id] = t;
      if (fillInto(normLine(line), t, counts)) any = true;
    }
    if (any) writes.push({ location, weekStart: ws, lines, created: !target });
  }
  return { ...counts, live, weeks: writes.length, writes };
}
export const repeatProblem = (src: WeekSlot | undefined, roster: readonly string[], weeks: number): Problem | null => {
  if (!(REPEAT_WEEKS as readonly number[]).includes(weeks)) return { field: 'weeks', message: 'Choose how many weeks to repeat for from the list.' };
  if (!src) return { field: 'weekStart', message: 'This week is not stored yet.' };
  if (!roster.some(id => normLine(src.lines[id]).some(isWorking))) return { field: 'weekStart', message: 'This week has no shifts to repeat.' };
  return null;
};
export const repeatSummary = (r: CountResult) => (r.written
  ? `${r.written} shift(s) written across ${r.weeks} week(s)${r.occupied ? ` · ${r.occupied} cell(s) already filled, left alone` : ''}${r.live ? ` · ${r.live} published week(s) skipped` : ''}`
  : 'Nothing written. Every target cell was already filled or in a published week.');
export const repeatAuditText = (locName: string, weekStart: string, weeks: number, r: CountResult) =>
  `${locName} · week ${isoWeek(weekStart)} → ${weeks} week(s) · ${r.written} shift(s) written${r.live ? ` · ${r.live} published week(s) skipped` : ''}`;

/* copy-rota-week: last week's shifts into this one. The prototype overwrote
   filled cells; here, as with generate and repeat, they are left alone (D6). */
export function copyProblem(target: Pick<RotaWeekCore, 'state' | 'weekStart'>, src: WeekSlot | undefined, roster: readonly string[]): RotaRefusal | null {
  if (rotaVisible(target.state))
    return { code: 'WEEK_LIVE', message: `Week ${isoWeek(target.weekStart)} is ${rotaState(target.state).label.toLowerCase()}. Copying over a live rota would replace published shifts.`,
      next: 'Change shifts one at a time, so each change is recorded.' };
  if (!src) return { code: 'NOTHING_TO_COPY', message: 'The previous week has no rota stored, so there is nothing to copy.', next: 'Build this week from the palette or a pattern.' };
  if (!roster.some(id => normLine(src.lines[id]).some(isWorking)))
    return { code: 'NOTHING_TO_COPY', message: 'Nothing to copy. The previous week has no shifts for this location.', next: 'Build this week from the palette or a pattern.' };
  return null;
}
export function copyWeek(src: WeekSlot, target: Pick<RotaWeekCore, 'lines'>, roster: readonly string[]) {
  const counts = { written: 0, occupied: 0, absence: 0 }, lines = copyLines(target);
  for (const id of roster) {
    const line = src.lines[id];
    if (!line) continue;
    const t = lines[id] ?? emptyLine();
    lines[id] = t;
    fillInto(normLine(line), t, counts);
  }
  return { ...counts, lines };
}
export const copySummary = (copied: number, occupied: number, srcWeek: string) =>
  `${copied} shift(s) copied from ${formatDmy(srcWeek)} · review before publishing${occupied ? ` · ${occupied} cell(s) already filled, left alone` : ''}`;
export const copyAuditText = (locName: string, srcWeek: string, weekStart: string, copied: number) =>
  `${locName} · ${formatDmy(srcWeek)} → week ${isoWeek(weekStart)} · ${copied} shift(s)`;

/* clear-week: an empty week to rebuild. Refused on a live week; leave and sickness are kept. */
export function clearPreview(lines: Readonly<Record<string, Line>>, roster: readonly string[]) {
  let shifts = 0, absence = 0, colleagues = 0;
  for (const id of roster) {
    const l = normLine(lines[id]);
    shifts += l.filter(isWorking).length; absence += l.filter(isAbsence).length;
    if (l.some(isWorking)) colleagues++;
  }
  return { shifts, absence, colleagues };
}
export function clearProblem(week: Pick<RotaWeekCore, 'state' | 'weekStart' | 'lines'>, roster: readonly string[], locName: string): RotaRefusal | null {
  if (rotaVisible(week.state))
    return { code: 'WEEK_LIVE', message: `Week ${isoWeek(week.weekStart)} is ${rotaState(week.state).label.toLowerCase()}. Remove shifts individually so each change is recorded.`,
      next: 'Remove shifts one at a time from the grid.' };
  if (!clearPreview(week.lines, roster).shifts)
    return { code: 'NOTHING_TO_CLEAR', message: `Nothing to clear. This week has no shifts at ${locName}.`, next: 'Build this week from the palette or a pattern.' };
  return null;
}
/* The removals a clear makes, each recorded as a change with the reason "Cleared". */
export const clearWrites = (lines: Readonly<Record<string, Line>>, roster: readonly string[], names: ReadonlyMap<string, string>, by: RotaActor, at: string): CellWrite[] =>
  roster.flatMap(id => normLine(lines[id]).flatMap((c, day) => (isWorking(c) ? [{ personCode: id, name: names.get(id) ?? id, day, to: '', by, at, why: 'Cleared' }] : [])));
export const clearSummary = (n: number, weekStart: string) =>
  `${n} shift(s) cleared · week ${isoWeek(weekStart)} · drag from the palette or generate from a pattern to rebuild it`;
export const clearAuditText = (locName: string, weekStart: string, n: number) => `${locName} · week ${isoWeek(weekStart)} · ${n} shift(s) removed`;

/* ------------------------------------------------------------ cover (D7) */
export const COVER_REASONS = ['Sickness', 'Annual leave cover', 'Vacancy', 'Double cover', 'Training', 'Suspension'] as const;
export interface CoverLogEntry { stage: number; at: string; audience: string; channel: string; sent: number }
export interface CoverCore {
  location: string; date: string; shift: string; reason: string; stage: number; open: boolean; urgent: boolean;
  openedAt: string; asked: string; log: CoverLogEntry[];
}
const stageAt = (stages: readonly FulfilStage[], i: number) => stages[Math.max(0, Math.min(i, stages.length - 1))];
const logOf = (s: FulfilStage | undefined, at: string, sent: number): CoverLogEntry[] =>
  (s ? [{ stage: s.n, at, audience: s.audience, channel: s.channel, sent }] : []);
/* One open request per location, day and shift. */
export function openCoverProblem(covers: readonly Pick<CoverCore, 'location' | 'date' | 'shift' | 'open'>[], location: string, date: string, shift: string,
  shifts: readonly ShiftType[]): RotaRefusal | null {
  if (!shiftBy(shifts, shift)) return { code: 'UNKNOWN_SHIFT', message: `There is no shift type with the code ${shift}.`, next: 'Choose a shift from the catalogue.' };
  if (covers.some(c => c.open && c.location === location && c.date === date && c.shift === shift))
    return { code: 'COVER_OPEN', message: `A cover request is already open for ${shiftName(shifts, shift)} on ${formatDay(date)}.`, next: 'Work the open request on Cover requests.' };
  return null;
}
/* openCover, and the urgent extra shift (adhoc-advertise) which asks employees and favourites together. */
export function newCover(o: { location: string; date: string; shift: string; reason: string; urgent: boolean }, stages: readonly FulfilStage[],
  at: string, sent: number, locName: string): CoverCore {
  const asked = !o.reason ? 'Not asked yet' : o.urgent ? `Employees at ${locName} and favourites at the same time` : `Employees at ${locName}, then favourite bank workers`;
  return { location: o.location, date: o.date, shift: o.shift, reason: o.reason, stage: 1, open: true, urgent: o.urgent, openedAt: at, asked,
    log: o.reason ? logOf(stages[0], at, sent) : [] };
}
export const coverClosed = (c: Pick<CoverCore, 'open'>): RotaRefusal | null =>
  (c.open ? null : { code: 'COVER_CLOSED', message: 'This cover request is already closed.', next: 'Nothing more is needed.' });
/* data-reason: the first reason asks the location, then favourites, and moves to stage 2. A later change only relabels it. */
export function coverReasonMove(c: CoverCore, reason: string, stages: readonly FulfilStage[], at: string, sent: number, locName: string): { cover: CoverCore } | { problem: RotaRefusal } {
  const closed = coverClosed(c);
  if (closed) return { problem: closed };
  if (!(COVER_REASONS as readonly string[]).includes(reason))
    return { problem: { code: 'VALIDATION', message: 'Choose a reason.', next: 'Pick why this shift needs filling.', field: 'reason' } };
  if (c.reason) return { cover: { ...c, reason } };
  return { cover: { ...c, reason, asked: `Employees at ${locName}, then favourite bank workers`, stage: Math.min(2, stages.length),
    log: [...c.log, ...logOf(stages[0], at, sent)] } };
}
/* data-askall: straight to every cleared worker (stage 3, or the last there is). */
export function coverAskAllMove(c: CoverCore, stages: readonly FulfilStage[], at: string, sent: number): { cover: CoverCore } | { problem: RotaRefusal } {
  const closed = coverClosed(c);
  if (closed) return { problem: closed };
  if (!c.reason) return { problem: { code: 'VALIDATION', message: 'Choose a reason first.', next: 'Pick why this shift needs filling.', field: 'reason' } };
  const st = stageAt(stages, 2);
  if (!st) return { problem: { code: 'VALIDATION', message: 'Keep at least one stage.', next: 'Add a fulfilment stage in Rota setup.' } };
  return { cover: { ...c, stage: st.n, asked: 'Everyone cleared to work has been asked', log: [...c.log, ...logOf(st, at, sent)] } };
}
/* data-agency: to the last stage, the Service Manager by default. */
export function coverEscalateMove(c: CoverCore, stages: readonly FulfilStage[], at: string): { cover: CoverCore } | { problem: RotaRefusal } {
  const closed = coverClosed(c);
  if (closed) return { problem: closed };
  const last = stages.at(-1);
  if (!last) return { problem: { code: 'VALIDATION', message: 'Keep at least one stage.', next: 'Add a fulfilment stage in Rota setup.' } };
  return { cover: { ...c, stage: last.n, log: [...c.log, ...logOf(last, at, 1)] } };
}
/* What happens next. Stages move on only when somebody acts (D7), so the
   configured wait is stated rather than counted down. */
export function coverNext(c: Pick<CoverCore, 'reason' | 'stage' | 'open'>, stages: readonly FulfilStage[]): string {
  if (!c.open) return '';
  if (!c.reason) return 'Choose a reason to start';
  const cur = stages.find(s => s.n === c.stage), nxt = stages.find(s => s.n === c.stage + 1);
  if (!nxt) return `With the ${cur?.audience ?? 'last stage'}. Next: ${(cur?.next ?? '').toLowerCase()}.`;
  return `Next it opens to ${nxt.audience.toLowerCase()}. The configured wait is ${cur?.wait ?? 0} minutes.`;
}
export const REASON_BEFORE_CLOSE = 'Add a reason before closing the request.';
export const NOBODY_ELIGIBLE = 'Nobody eligible is available. Escalate for agency cover instead.';
export const askFirstText = (firstName: string, wait: number) =>
  `Simulated · ${firstName} would be asked first, with ${wait} minutes to reply. No message is sent in this build.`;

/* A filled shift waits for the manager to confirm it was worked. */
export interface FilledCore { coverId: string; location: string; date: string; shift: string; personCode: string; name: string; confirmed: boolean; itRequest: string }
export const confirmProblem = (f: Pick<FilledCore, 'confirmed'>): RotaRefusal | null =>
  (f.confirmed ? { code: 'ALREADY_CONFIRMED', message: 'This shift is already confirmed as worked.', next: 'Nothing more is needed.' } : null);
export interface ItRequestCore { ref: string; personCode: string; name: string; location: string; shift: string; date: string; worker: string; status: string; raisedAt: string; system: string }
/* raiseITRequest (PEOP156): only with ITACCESS on. Refs run ITR-1007, ITR-1008, ... */
export const itRequestFor = (f: FilledCore, raisedSoFar: number, category: string, at: string, locName: string, shifts: readonly ShiftType[]): ItRequestCore => ({
  ref: `ITR-${1000 + raisedSoFar + 7}`, personCode: f.personCode, name: f.name, location: locName,
  shift: `${shiftName(shifts, f.shift)} · ${shiftTime(shifts, f.shift)}`, date: f.date, worker: category || 'Bank', status: 'Raised',
  raisedAt: at, system: 'IT service desk (simulated)' });
export const confirmSummary = (ref: string) => (ref ? `Confirmed. IT access request ${ref} raised.` : 'Confirmed as worked.');

/* openShiftsFor: open requests with a reason at the person's location. With safe-worker filtering on, anyone ineligible is never offered it. */
export function openShiftsFor<C extends CoverCore>(w: RotaWorker & { location: string }, covers: readonly C[], lineFor: (date: string) => Line, ctx: RuleContext) {
  const out: { cover: C; why: string }[] = [];
  for (const c of covers) {
    if (!c.open || !c.reason || c.location !== w.location) continue;
    if (!ctx.safeWorker) { out.push({ cover: c, why: 'Open at your location' }); continue; }
    const day = dowMon(c.date);
    if (eligibility(w, lineFor(c.date), day, c.shift, ctx).length) continue;
    out.push({ cover: c, why: w.favourite ? 'You are a favourite here, so it is offered to you first'
      : w.preferredDays.includes(day) ? 'Matches the days you said you can work' : 'You are cleared and available for this shift' });
  }
  return out;
}
export const CLAIM_NOT_PERMITTED = 'Claiming open shifts is not permitted for this persona.';
export const claimRefusal = (e: Exclusion) => `You cannot take that shift. ${e.reason}.`;

/* -------------------------------------------- notifications (D8) */
export const shiftAssignedNotice = (shifts: readonly ShiftType[], code: string, date: string, locName: string) =>
  ({ title: 'Shift assigned', body: `${shiftName(shifts, code)} on ${formatDay(date)} at ${locName}` });
export const openShiftNotice = (shifts: readonly ShiftType[], code: string, date: string, locName: string) =>
  ({ title: 'Open shift available', body: `${shiftName(shifts, code)} on ${DOW_SHORT[dowMon(date)] ?? ''} at ${locName}` });
export const coverageIssueNotice = (locName: string, date: string, min: number) =>
  ({ title: `Coverage issue · ${locName}`, body: `${formatDay(date)} is below the minimum of ${min}. A cover request is open.` });
export const coverFilledNotice = (name: string, shifts: readonly ShiftType[], code: string, date: string) =>
  ({ title: 'Cover request filled', body: `${name} has claimed ${shiftName(shifts, code)} on ${formatDay(date)}` });
export const escalationNotice = (shifts: readonly ShiftType[], code: string, date: string, audience: string) =>
  ({ title: 'Fulfilment escalation', body: `${shiftName(shifts, code)} on ${DOW_SHORT[dowMon(date)] ?? ''} escalated to the ${audience}` });
export const itRequestNotice = (r: ItRequestCore) => ({ title: 'IT access request raised', body: `${r.name} · ${r.location} · ${formatDay(r.date)} · ${r.ref}` });

/* ---------------------------------------- the timesheet's rota line (D16) */
/* What the timesheet checks a day against: the person's cell for that date in
   their location's week. Rest, leave and sickness are not a line. */
export function rotaInputFor(line: Line | undefined, day: number, ctx: Omit<RuleContext, 'safeWorker'> & { typeName: string }): RotaInput | undefined {
  const code = line?.[day] ?? '', s = shiftBy(ctx.shifts, code);
  if (!s) return undefined;
  return { line: { code: s.code, name: s.name, hours: s.hours, cross: s.cross },
    rest: { gapHours: restAround(normLine(line), day, code, ctx.shifts), ruleHours: restNeed(ctx.typeRota, ctx.config), typeName: ctx.typeName } };
}
/* What the timesheet shows of one day of the published rota: the shift with
   its times and hours, a rest day (code ''), or leave (V) or sickness (S). A
   code no longer in the catalogue reads as a rest day, because there is no
   shift left to work against. */
export interface RotaDay { code: string; name: string; from: string; to: string; time: string; hours: number; cross: boolean }
export function rotaDayOf(code: string, shifts: readonly ShiftType[]): RotaDay {
  if (isAbsence(code)) return { code, name: code === LEAVE ? 'Annual leave' : 'Sickness', from: '', to: '', time: '', hours: 0, cross: false };
  const s = shiftBy(shifts, code);
  if (!s) return { code: '', name: 'Rest day', from: '', to: '', time: '', hours: 0, cross: false };
  return { code: s.code, name: s.name, from: s.from, to: s.to, time: `${s.from}–${s.to}`, hours: s.hours, cross: s.cross };
}
export const rotaDaysOf = (line: Line | undefined, shifts: readonly ShiftType[]): RotaDay[] => normLine(line).map(c => rotaDayOf(c, shifts));

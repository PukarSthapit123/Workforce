/* Modules and features. Ported from the prototype (qnipay-workforce-v15.html:
   MODULES, MOD_SUBS, FLAGS, moduleLive, flagsFor, modOn, flagOn, MOD_IMPACT,
   MOD_RESTORE, rotaShiftsOff and rotaShiftsOn, the data-mod, data-flag,
   data-brk, data-veh, data-weekgrid and data-weeklayout handlers, and the
   mod-off case). Every function is pure: the tenant's module and flag state
   comes in as arguments, so the server refuses with exactly what the screen
   shows.

   A module is a licence. Timesheet (TS) is made of capabilities (A manual
   entry, B clock, C sites) and is live only while it is on and A or B is on.
   Workforce core (CORE) is locked and always on. A flag is live only while
   the module it belongs to is on (flagOn). Copy is the prototype's, with each
   em-dash and "·" aside rewritten as its own sentence. */
import type { Problem } from './codes';
import { isAbsence } from './rota';

/* ------------------------------------------------------------- catalogue */
export type SubCode = 'A' | 'B' | 'C';
export interface ModuleDef {
  code: string; name: string; icon: string; description: string;
  locked?: true; master?: true; subs?: readonly SubCode[]; liveBy?: readonly SubCode[];
  /* the view that configures it, reached from its drill-in */
  setup?: string; setupLabel?: string;
}
export interface SubDef { code: SubCode; name: string; kind: 'method' | 'capability'; description: string }
export interface FlagDef { code: string; label: string; mod: string; description: string }

export const MODULES: readonly ModuleDef[] = [
  { code: 'CORE', name: 'Workforce core', icon: 'users', description: 'People, employee types, approvals, notifications and the Business Central hand-off.', locked: true },
  { code: 'TS', name: 'Timesheet', icon: 'clock', description: 'How time is captured, checked and sent for approval.',
    subs: ['A', 'B', 'C'], liveBy: ['A', 'B'], master: true, setup: 'mts', setupLabel: 'Timesheet setup' },
  { code: 'R', name: 'Rota', icon: 'grid', description: 'Shift catalogue, working patterns, coverage and the shift fulfilment workflow.', setup: 'mrota', setupLabel: 'Rota setup' },
  { code: 'L', name: 'Leave & absence', icon: 'calendar', description: 'Leave types, entitlement, booking workflow and leaver reconciliation.', setup: 'mleave', setupLabel: 'Leave setup' },
  { code: 'ON', name: 'Onboarding', icon: 'clipboard', description: 'What a new starter completes before their first day, and what the business checks before they can work.', setup: 'monb', setupLabel: 'Onboarding setup' },
];
export const MOD_SUBS: Readonly<Record<SubCode, SubDef>> = {
  A: { code: 'A', name: 'Manual time entry', kind: 'method', description: 'Day form, weekly grid and multi-week catch-up.' },
  B: { code: 'B', name: 'Clock in / out', kind: 'method', description: 'Live timer with breaks, for types set to clock entry.' },
  C: { code: 'C', name: 'Sites & locations', kind: 'capability', description: 'Location field, per-site rules and the location check on clock-in.' },
};
export const FLAGS: readonly FlagDef[] = [
  { code: 'AUTO_OT', label: 'Auto overtime split', mod: 'TS', description: 'Split hours past the weekly threshold into an overtime pay code.' },
  { code: 'LATE_FINISH', label: 'Late finish detection', mod: 'TS', description: 'Flag shifts finishing after the configured cut-off.' },
  { code: 'UNSOCIAL', label: 'Unsocial hours detection', mod: 'TS', description: 'Flag hours worked inside the unsocial window.' },
  { code: 'EMAIL_APPROVAL', label: 'Email approval', mod: 'TS', description: 'Managers can approve a week from an email link.' },
  { code: 'SHOW_PAY', label: 'Show indicative pay to employees', mod: 'CORE', description: 'Off by default. Rates stay in Business Central.' },
  { code: 'VEHICLE', label: 'Vehicle & movement fields', mod: 'TS', description: 'Offered to employee types with the vehicle capability.' },
  { code: 'PROJECT', label: 'Project & costing fields', mod: 'TS', description: 'Project, task, cost centre and billable flag.' },
  { code: 'SHIFT', label: 'Shift & rota fields', mod: 'TS', description: 'Rota line on the entry, and shift premium rules.' },
  { code: 'BREAKS', label: 'Break tracking', mod: 'TS', description: 'Employees record unpaid breaks; deducted from net hours.' },
  { code: 'ONB_RTW', label: 'Right to work', mod: 'ON', description: 'Collect proof of the right to work, with the document type declared.' },
  { code: 'ONB_CONV', label: 'Convictions declaration', mod: 'ON', description: 'Ask whether the person has unspent convictions, with detail where they do.' },
  { code: 'ONB_WTD', label: 'Working time opt-out', mod: 'ON', description: 'Record whether the person opts out of the 48-hour weekly limit.' },
  { code: 'ONB_QUAL', label: 'Qualifications', mod: 'ON', description: 'Collect qualifications and certificates, with expiry where relevant.' },
  { code: 'ONB_POL', label: 'Policy acknowledgement', mod: 'ON', description: 'Require each policy to be read and acknowledged before submission.' },
  { code: 'ONB_SIGN', label: 'Signature on sign-off', mod: 'ON', description: 'Capture a drawn signature rather than a tick alone.' },
  { code: 'ONB_VERIFY', label: 'Document verification', mod: 'ON', description: 'A named person checks each uploaded document before it counts.' },
  { code: 'ONB_PORTAL', label: 'Employee portal', mod: 'ON', description: 'Handbook, company information, vacancies and benefits for people already working.' },
  { code: 'DOCS', label: 'Document centre', mod: 'CORE', description: 'Shared documents in Employee Self-Service.' },
  { code: 'NOTICES', label: 'Notice board', mod: 'CORE', description: 'Managers post to their location, admins to everyone. Colleagues read, and acknowledge where asked.' },
  { code: 'SELF_EDIT', label: 'Self-service profile changes', mod: 'CORE', description: 'Colleagues propose changes to their own contact, emergency and bank details. Every change is approved before it takes effect.' },
  { code: 'DAILY', label: 'Daily entry', mod: 'A', description: 'The day form.' },
  { code: 'WEEKLY', label: 'Weekly grid', mod: 'A', description: 'Seven-day grid capture.' },
  { code: 'MULTIWEEK', label: 'Multi-week submit', mod: 'A', description: 'Catch up on earlier unsubmitted weeks in one action.' },
  { code: 'GPS', label: 'Location check on clock', mod: 'B', description: 'Capture coordinates when a shift starts.' },
  { code: 'GEOFENCE', label: 'Geofence radius per site', mod: 'C', description: 'Warn when a clock-in falls outside the site radius.' },
  { code: 'PATTERNS', label: 'Working patterns', mod: 'R', description: 'Generate the rota from repeating cycles up to the configured horizon.' },
  { code: 'MINSTAFF', label: 'Minimum staffing', mod: 'R', description: 'Coverage is checked against each location’s support level.' },
  { code: 'FULFIL', label: 'Shift fulfilment workflow', mod: 'R', description: 'Timed, staged cover requests with escalation.' },
  { code: 'SAFEWORKER', label: 'Safe-worker filtering', mod: 'R', description: 'Only advertise work to people who are cleared and eligible.' },
  { code: 'FLEXMON', label: 'Flexible worker monitoring', mod: 'R', description: 'Count bank weeks and notify HR at the configured milestones.' },
  { code: 'ITACCESS', label: 'IT access request on fulfilment', mod: 'R', description: 'Raise a site-access request when a shift is filled.' },
  { code: 'RESTRULE', label: 'Minimum rest checking', mod: 'R', description: 'Warn when two shifts leave less than the configured rest.' },
  { code: 'PREFS', label: 'Worker shift preferences', mod: 'R', description: 'Employees choose where and when they want to be offered work.' },
  { code: 'LV_ENT', label: 'Automatic entitlement calculation', mod: 'L', description: 'Derive annual leave from hours, pattern and service.' },
  { code: 'LV_PRORATA', label: 'Pro-rata recalculation', mod: 'L', description: 'Recalculate entitlement when working arrangements change.' },
  { code: 'LV_LEAVER', label: 'Leaver reconciliation', mod: 'L', description: 'Settle over- or under-taken leave at the leaving date.' },
  { code: 'LV_SLA', label: 'Approval SLA & escalation', mod: 'L', description: 'Escalate a request that is not decided within the SLA.' },
  { code: 'LV_ROTA', label: 'Leave affects rota availability', mod: 'L', description: 'Approved leave removes the person from rota allocation.' },
  { code: 'LV_TOIL', label: 'Time off in lieu', mod: 'L', description: 'Accrue and spend TOIL within the configured window.' },
];

const isSub = (c: string): c is SubCode => Object.hasOwn(MOD_SUBS, c);
export const moduleBy = (code: string) => MODULES.find(m => m.code === code);
export const flagBy = (code: string) => FLAGS.find(f => f.code === code);
/* A capability's own name, else the module's, else the code (subName). */
export const subName = (code: string) => (isSub(code) ? MOD_SUBS[code].name : moduleBy(code)?.name ?? code);
export const modSubs = (m: ModuleDef): SubDef[] => (m.subs ?? []).map(c => MOD_SUBS[c]);
/* Every switch a tenant holds: the modules and the capabilities inside them. */
export const SWITCH_CODES: readonly string[] = MODULES.flatMap(m => [m.code, ...(m.subs ?? [])]);
/* The module whose drill-in shows this module, capability or flag owner. */
export const parentOf = (code: string) => MODULES.find(m => m.code === code || (m.subs ?? []).some(c => c === code));
/* Flags shown on a module's drill-in: its own and its capabilities' (flagsFor). */
export const flagsFor = (m: ModuleDef) => FLAGS.filter(f => f.mod === m.code || (m.subs ?? []).some(c => c === f.mod));

/* ------------------------------------------------------------- liveness */
export type Switches = Readonly<Record<string, boolean | undefined>>;
export const modOn = (modules: Switches, code: string) => modules[code] === true;
export function moduleLive(modules: Switches, m: ModuleDef): boolean {
  if (m.locked) return true;
  if (m.master) return modOn(modules, m.code) && (m.liveBy ?? m.subs ?? []).some(c => modOn(modules, c));
  if (m.liveBy?.length) return m.liveBy.some(c => modOn(modules, c));
  if (m.subs?.length) return m.subs.some(c => modOn(modules, c));
  return modOn(modules, m.code);
}
/* A flag counts only while the module it belongs to is on; CORE is always on. */
export function flagOn(modules: Switches, flags: Readonly<Record<string, unknown>>, code: string): boolean {
  const f = flagBy(code);
  if (!f) return false;
  return (f.mod === 'CORE' || modOn(modules, f.mod)) && Boolean(flags[code]);
}
/* Time capture is on while either capture method is (every gate reads A or B). */
export const captureOn = (modules: Switches) => modOn(modules, 'A') || modOn(modules, 'B');

/* --------------------------------------------------------- the off confirm */
export const MOD_IMPACT: Readonly<Record<string, string>> = {
  A: 'Day forms, the weekly grid and multi-week catch-up disappear for everyone.',
  B: 'The clock disappears; types set to clock entry fall back to the day form.',
  C: 'The location field, per-site rules and location checks are removed from capture.',
  R: 'Rota, coverage, working patterns, cover requests and shift fulfilment are removed. Timesheet keeps its own rota-line field where configured.',
  L: 'Leave types, entitlement, balances, the booking workflow and leaver reconciliation are removed. Rota stops treating leave as unavailability.',
  TS: 'All time capture stops: day forms, the weekly grid, the clock and multi-week catch-up disappear for everyone, and every capture method is switched off. Approvals keep any timesheets already submitted. Rota and Leave are unaffected.',
};
export const OFF_TAIL = 'This applies to everyone immediately.';
export const offConfirm = (code: string) => ({
  title: `Turn off ${subName(code)}?`,
  body: [MOD_IMPACT[code], OFF_TAIL].filter(Boolean).join(' '),
  confirm: 'Turn it off', cancel: 'Keep it as it is',
});
/* The note under a module's enable switch on its drill-in (moduleEnableRow). */
export function enableNote(modules: Switches, m: ModuleDef): string {
  const licensed = m.locked === true || modOn(modules, m.code);
  if (m.locked) return 'Workforce core cannot be switched off. Everything else depends on it.';
  if (!licensed) return m.master
    ? 'Not licensed for this tenant. Switching it on restores the capture methods it had.'
    : 'Its features below are inert until it is switched on.';
  if (m.master && !moduleLive(modules, m)) return `Licensed, but no capture method is on. ${m.name} is not doing anything yet.`;
  if (m.master) return 'Switch it off and every capture method below goes with it.';
  return 'Its features below are available to configure.';
}

/* --------------------------------------------------------- feature extras */
/* Settings that hang off a feature rather than standing alone (featExtra). */
export const WEEK_GRIDS = [['hours', 'Captures total hours'], ['times', 'Captures start & finish']] as const;
export const WEEK_LAYOUTS = [
  ['classic', 'Classic · allocation in the first column'],
  ['grid', 'Grid · allocation as a section header'],
  ['days', 'List · one row per day'],
] as const;
export type WeekGridKey = typeof WEEK_GRIDS[number][0];
export type WeekLayoutKey = typeof WEEK_LAYOUTS[number][0];
export interface FlagExtras { weekGrid: WeekGridKey; weekLayout: WeekLayoutKey; breaksMax: number; vehiclesMax: number }
export type ExtraKey = keyof FlagExtras;
export const FLAG_EXTRAS: Readonly<Record<string, readonly ExtraKey[]>> = {
  WEEKLY: ['weekGrid', 'weekLayout'], BREAKS: ['breaksMax'], VEHICLE: ['vehiclesMax'],
};
/* The steppers' bounds (data-brk: 1 to 5, data-veh: 1 to 4). */
export const EXTRA_BOUNDS = { breaksMax: { min: 1, max: 5 }, vehiclesMax: { min: 1, max: 4 } } as const;
export const BREAKS_RANGE = `Breaks per entry must be between ${EXTRA_BOUNDS.breaksMax.min} and ${EXTRA_BOUNDS.breaksMax.max}.`;
export const VEHICLES_RANGE = `Vehicles per entry must be between ${EXTRA_BOUNDS.vehiclesMax.min} and ${EXTRA_BOUNDS.vehiclesMax.max}.`;
export const DEFAULT_EXTRAS: FlagExtras = { weekGrid: 'hours', weekLayout: 'classic', breaksMax: 5, vehiclesMax: 4 };

/* ------------------------------------------------------------- refusals */
export interface Refusal { status: 404 | 409 | 422; code: string; message: string; next: string; field?: string }
export const NOT_A_MODULE = (code: string): Refusal => ({ status: 404, code: 'not-found', message: `There is no module "${code}".`, next: 'Reload the page and choose a module from the list.' });
export const NOT_A_FLAG = (code: string): Refusal => ({ status: 404, code: 'not-found', message: `There is no feature "${code}".`, next: 'Reload the page and choose a feature from the list.' });
export const CORE_LOCKED: Refusal = { status: 409, code: 'LOCKED', message: 'Workforce core cannot be switched off. Everything else depends on it.',
  next: 'Switch off another module, or a feature inside Workforce core, instead.' };
export const capabilityOff = (m: ModuleDef): Refusal => ({ status: 409, code: 'MODULE_OFF',
  message: `${m.name} is not licensed for this tenant, so its capture methods cannot be switched.`,
  next: `Turn ${m.name} on first. It restores the capture methods it had.` });
export const featureModuleOff = (m: ModuleDef): Refusal => ({ status: 409, code: 'MODULE_OFF',
  message: `${m.name} is off, so its features cannot be changed.`, next: `Turn ${m.name} on first in Modules & features.` });
export const featureOff = (f: FlagDef): Refusal => ({ status: 409, code: 'FLAG_OFF',
  message: `${f.label} is off, so its settings cannot be changed.`, next: `Turn ${f.label} on first.` });
export const noSuchExtra = (f: FlagDef, key: string): Refusal => ({ status: 422, code: 'invalid', field: key,
  message: `${f.label} has no ${key} setting.`, next: 'Send only the settings this feature has.' });

/* ----------------------------------------------------------- module switch */
export interface ModuleState { modules: Record<string, boolean>; restore: Record<string, string[]> }
export type ModuleSwitch =
  | { ok: false; refusal: Refusal }
  | { ok: true; changed: false }
  | { ok: true; changed: true; modules: Record<string, boolean>; restore: Record<string, string[]>;
      /* capabilities turned on with a master module, or remembered when it went off */
      brought: string[]; remembered: string[] };

/* The data-mod handler and the mod-off case. Turning Timesheet off remembers
   which capture methods were on and switches them all off; turning it on
   restores them, or the first capture method when it remembers none. A
   capability inside Timesheet can only be switched while Timesheet is on. */
export function switchModule(state: ModuleState, code: string, on: boolean): ModuleSwitch {
  const m = moduleBy(code), parent = parentOf(code);
  if (!parent) return { ok: false, refusal: NOT_A_MODULE(code) };
  if (m?.locked) return on ? { ok: true, changed: false } : { ok: false, refusal: CORE_LOCKED };
  if (!m && parent.master && !modOn(state.modules, parent.code)) return { ok: false, refusal: capabilityOff(parent) };
  if (modOn(state.modules, code) === on) return { ok: true, changed: false };
  const modules = { ...state.modules }, restore = { ...state.restore };
  if (m?.master) {
    const subs = m.subs ?? [];
    if (on) {
      const was = restore[code] ?? [];
      const back = was.length ? was : [(m.liveBy ?? subs)[0] ?? ''].filter(Boolean);
      modules[code] = true;
      for (const c of back) modules[c] = true;
      const rest = Object.fromEntries(Object.entries(restore).filter(([k]) => k !== code));
      return { ok: true, changed: true, modules, restore: rest, brought: back, remembered: [] };
    }
    const remembered = subs.filter(c => modOn(state.modules, c));
    restore[code] = remembered;
    for (const c of subs) modules[c] = false;
    modules[code] = false;
    return { ok: true, changed: true, modules, restore, brought: [], remembered };
  }
  modules[code] = on;
  return { ok: true, changed: true, modules, restore, brought: [], remembered: [] };
}

/* ------------------------------------------------------------- flag switch */
export interface FlagChange { on?: boolean; weekGrid?: WeekGridKey; weekLayout?: WeekLayoutKey; breaksMax?: number; vehiclesMax?: number }
export type FlagSwitch =
  | { ok: false; refusal: Refusal }
  | { ok: true; on: boolean; extras: Partial<FlagExtras> };

/* The data-flag handler and the extras beside it. A feature is switchable only
   while the module whose drill-in shows it is live (the prototype disables the
   row otherwise); its extras only while the feature is on (they are shown only
   then). Bounds are checked here, not clamped. */
export function switchFlag(modules: Switches, flags: Readonly<Record<string, unknown>>, code: string, change: FlagChange): FlagSwitch {
  const f = flagBy(code), parent = parentOf(f?.mod ?? '');
  if (!f || !parent) return { ok: false, refusal: NOT_A_FLAG(code) };
  if (!moduleLive(modules, parent)) return { ok: false, refusal: featureModuleOff(parent) };
  const own = FLAG_EXTRAS[f.code] ?? [];
  const sent = (['weekGrid', 'weekLayout', 'breaksMax', 'vehiclesMax'] as const).filter(k => change[k] !== undefined);
  const stray = sent.find(k => !own.includes(k));
  if (stray) return { ok: false, refusal: noSuchExtra(f, stray) };
  const on = change.on ?? Boolean(flags[f.code]);
  if (sent.length && !on) return { ok: false, refusal: featureOff(f) };
  const range = (k: 'breaksMax' | 'vehiclesMax', v: number | undefined, message: string): Refusal | null =>
    v === undefined || (Number.isInteger(v) && v >= EXTRA_BOUNDS[k].min && v <= EXTRA_BOUNDS[k].max) ? null
      : { status: 422, code: 'invalid', field: k, message, next: 'Choose a number inside the range.' };
  const bad = range('breaksMax', change.breaksMax, BREAKS_RANGE) ?? range('vehiclesMax', change.vehiclesMax, VEHICLES_RANGE);
  if (bad) return { ok: false, refusal: bad };
  const extras: Partial<FlagExtras> = Object.fromEntries(sent.map(k => [k, change[k]]));
  return { ok: true, on, extras };
}

/* --------------------------------------------------- Rota off and back on */
/* rotaShiftsOff: every shift that is not leave or sickness leaves the
   calendar; the lines as they were are kept so turning Rota back on puts
   them back. rotaShiftsOn: a kept shift returns only to a cell that is still
   empty, so leave or sickness recorded in the meantime wins. Both count cells. */
export type WeekLines = Record<string, string[]>;
export function setAsideShifts(weeks: Readonly<Record<string, WeekLines>>): { cleared: Record<string, WeekLines>; kept: Record<string, WeekLines>; count: number } {
  const cleared: Record<string, WeekLines> = {}, kept: Record<string, WeekLines> = {};
  let count = 0;
  for (const [id, lines] of Object.entries(weeks)) {
    kept[id] = structuredClone(lines);
    let touched = false;
    const next: WeekLines = {};
    for (const [person, line] of Object.entries(lines)) next[person] = line.map(c => {
      if (c && !isAbsence(c)) { count++; touched = true; return ''; }
      return c;
    });
    if (touched) cleared[id] = next;
  }
  return { cleared, kept, count };
}
export function restoreShifts(weeks: Readonly<Record<string, WeekLines>>, kept: Readonly<Record<string, WeekLines>>): { restored: Record<string, WeekLines>; count: number } {
  const restored: Record<string, WeekLines> = {};
  let count = 0;
  for (const [id, was] of Object.entries(kept)) {
    const now = weeks[id];
    if (!now) continue;
    let touched = false;
    const next: WeekLines = structuredClone(now);
    for (const [person, line] of Object.entries(was)) {
      const cur = next[person];
      if (!cur) continue;
      line.forEach((c, i) => { if (c && !isAbsence(c) && !cur[i]) { cur[i] = c; count++; touched = true; } });
    }
    if (touched) restored[id] = next;
  }
  return { restored, count };
}

/* ------------------------------------------------------------- outcomes */
const shifts = (n: number) => `${n} scheduled ${n === 1 ? 'shift' : 'shifts'}`;
const types = (n: number) => `${n} employee ${n === 1 ? 'type' : 'types'}`;
export interface SwitchOutcome { cleared?: number; restored?: number; sitesRemovedFrom?: number; brought?: readonly string[] }
/* The toast after a module switch, as the prototype words it. */
export function moduleSwitchText(code: string, on: boolean, o: SwitchOutcome = {}): string {
  const name = subName(code), live = 'It is live for everyone now.';
  if (on) {
    const head = o.brought?.length ? `${name} turned on with ${o.brought.map(subName).join(', ')}.` : `${name} turned on.`;
    return [head, live, o.restored ? `${shifts(o.restored)} restored to the calendar.` : ''].filter(Boolean).join(' ');
  }
  return [`${name} turned off.`, live,
    o.cleared ? `${shifts(o.cleared)} cleared from the calendar and kept to restore.` : '',
    o.sitesRemovedFrom ? `Site & location was taken off ${types(o.sitesRemovedFrom)}.` : ''].filter(Boolean).join(' ');
}
export function flagChangeText(f: FlagDef, was: boolean, on: boolean, extras: Partial<FlagExtras>): string {
  const parts: string[] = [];
  if (was !== on) parts.push(`${f.label} ${on ? 'on' : 'off'}.`);
  if (extras.weekGrid) parts.push(`Weekly grid now captures ${extras.weekGrid === 'times' ? 'start and finish' : 'total hours'}.`);
  if (extras.weekLayout) parts.push({
    days: 'Weekly view: list. One row per day, allocation chosen before the times.',
    grid: 'Weekly view: grid. Days across, one section per allocation.',
    classic: 'Weekly view: classic. Allocation in the first column, days across.',
  }[extras.weekLayout]);
  if (extras.breaksMax !== undefined) parts.push(`Breaks per entry: ${extras.breaksMax}.`);
  if (extras.vehiclesMax !== undefined) parts.push(`Vehicles per entry: ${extras.vehiclesMax}.`);
  if (!parts.length) return `${f.label} is unchanged.`;
  return [...parts, 'It is live for everyone now.'].join(' ');
}

/* ------------------------------------------------------------ role names */
export const ROLE_NAME_MAX = 24;
export const ROLE_NAME_REQUIRED = 'Every role needs a name.';
export const ROLE_NAME_TAKEN = 'Two roles cannot share a name.';
export const ROLE_NAME_TOO_LONG = `A role name can be at most ${ROLE_NAME_MAX} characters.`;
/* The role-names-save rule, for one renamed role against the others. */
export function roleNameProblem(name: string, others: readonly string[]): (Problem & { taken?: true }) | null {
  const v = name.trim();
  if (!v) return { field: 'name', message: ROLE_NAME_REQUIRED };
  if (v.length > ROLE_NAME_MAX) return { field: 'name', message: ROLE_NAME_TOO_LONG };
  if (others.some(o => o.trim().toLowerCase() === v.toLowerCase())) return { field: 'name', message: ROLE_NAME_TAKEN, taken: true };
  return null;
}

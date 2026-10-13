/* 1c group 5: approval chains and delegations (brief D8). Ported from the
   prototype's APPROVAL_CHAIN, CHAIN_SCOPES, CHAIN_WHEN and DELEGATIONS
   (qnipay-workforce-v15.html:2262-2276), admApprovals (8405-8473) and the
   chain-add, deleg-add, data-chain, data-chaindel and data-deldel handlers.

   Where the prototype and the brief part company, the brief wins:
   - one chain per module, saved whole (the prototype edited each cell in
     place and kept one flat list);
   - the approver role is one of four (the prototype took free text), plus
     the fixed Business Central posting step, which ends the Timesheet chain
     and cannot be removed or edited;
   - the Profile chain drives self-service routing, so it holds only a line
     manager and payroll, each once, and only its two conditions;
   - a delegation names people by employee code over ISO dates, both days
     included, and is refused when it covers itself, makes a loop or overlaps
     another for the same approver and module (the prototype pushed a fixed
     row and checked nothing).

   Every function is pure, so the server refuses with exactly what the screen
   shows. Copy is the prototype's, with each "·" or "—" aside rewritten as
   its own sentence. */
import { formatDmy } from './time';
import type { Refusal } from './modules';

/* ---------------------------------------------------------------- shapes */
export const CHAIN_MODULES = ['Timesheet', 'Profile', 'Leave', 'Rota'] as const;
export type ChainModule = (typeof CHAIN_MODULES)[number];
export const isChainModule = (v: unknown): v is ChainModule => typeof v === 'string' && (CHAIN_MODULES as readonly string[]).includes(v);
/* the record id of each module's chain, and back */
export const chainId = (m: ChainModule) => `chain_${m.toLowerCase()}`;
export const chainModuleOf = (id: string): ChainModule | undefined => CHAIN_MODULES.find(m => chainId(m) === id || m.toLowerCase() === id.toLowerCase());

export const APPROVER_ROLES = ['Line manager', 'Service Manager', 'Payroll', 'HR administrator'] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];
export const isApproverRole = (v: unknown): v is ApproverRole => typeof v === 'string' && (APPROVER_ROLES as readonly string[]).includes(v);

/* One layer of a chain, as the prototype's APPROVAL_CHAIN rows. */
export interface ChainStep { module: string; role: string; scope: string; when: string; sla: string; fixed: boolean }

export const CHAIN_SCOPES = ['Own department', 'Own site', 'Own location', 'All departments', 'Named employees', '—'] as const;
/* the dash belongs to the posting step alone */
export const STEP_SCOPES = CHAIN_SCOPES.filter(s => s !== '—');
/* 'Every rota week' is not the prototype's (module 8 group 4): without it no
   Rota layer could apply to every week, so no sign-off could be asked for. */
export const CHAIN_WHEN = ['Every timesheet', 'Every contact detail change', 'Only bank details', 'Every leave request', 'Only above a premium threshold',
  'Only for absence or non-working days', 'Only for proxy entries', 'Only when the SLA is breached',
  'Only for agency booking', 'Every rota week', 'Posts on final approval'] as const;
export const POSTS = 'Posts on final approval';
export const PROFILE_WHEN = ['Every contact detail change', 'Only bank details'] as const;
export const PROFILE_ROLES: readonly ApproverRole[] = ['Line manager', 'Payroll'];

/* The conditions a module's layer may carry: the Profile chain its own two,
   since they decide which fields go to whom. Module 8 group 4: a Timesheet
   layer may only carry a condition the server can read off the day, so each
   one it offers works. */
export const TIMESHEET_WHEN = ['Every timesheet', 'Only above a premium threshold', 'Only for absence or non-working days', 'Only for proxy entries'] as const;
/* Module 8 group 4B: the same for Leave and Rota. A leave layer applies to
   every request, or, as an escalation, to one whose first layer has not
   decided within the SLA; a rota layer to every week, or to a week with a
   shift that has gone to agency partners for cover. */
export const ESCALATION_WHEN = 'Only when the SLA is breached';
export const LEAVE_WHEN = ['Every leave request', ESCALATION_WHEN] as const;
export const ROTA_WHEN = ['Every rota week', 'Only for agency booking'] as const;
const MODULE_WHEN: Readonly<Record<ChainModule, readonly string[]>> = { Profile: PROFILE_WHEN, Timesheet: TIMESHEET_WHEN, Leave: LEAVE_WHEN, Rota: ROTA_WHEN };
export const whenOptions = (m: ChainModule): readonly string[] => MODULE_WHEN[m];

/* Module 8 group 4: the one table of who may sign off each role of each
   module's chain. A role is the capability that decides it; a scoped role
   is decided only for people in the approver's own access scope (their
   location, or everyone with Workforce master data), as a manager's team
   is. A role a module has no row for cannot be put in its chain, since
   nothing would decide it. Line manager and payroll are what the seeded
   Timesheet and Profile chains use; the Service Manager rows are what the
   seeded Leave and Rota chains use. */
export interface RoleRule { capability: string; scoped: boolean }
export const CHAIN_ROLE_RULES: Readonly<Record<ChainModule, Partial<Readonly<Record<ApproverRole, RoleRule>>>>> = {
  Timesheet: { 'Line manager': { capability: 'team_ts', scoped: true }, Payroll: { capability: 'pay_appr', scoped: false } },
  Profile: { 'Line manager': { capability: 'profile_appr', scoped: true }, Payroll: { capability: 'bank_verify', scoped: false } },
  Leave: { 'Line manager': { capability: 'team_leave', scoped: true }, 'Service Manager': { capability: 'team_leave', scoped: true } },
  Rota: { 'Service Manager': { capability: 'team_rota', scoped: true } },
};
export const roleRule = (m: ChainModule, role: string): RoleRule | undefined => (isApproverRole(role) ? CHAIN_ROLE_RULES[m][role] : undefined);
export const roleOptions = (m: ChainModule): readonly ApproverRole[] => APPROVER_ROLES.filter(r => CHAIN_ROLE_RULES[m][r] !== undefined);
/* every capability that decides some layer of the module's chain */
export const chainCapabilities = (m: ChainModule): string[] => [...new Set(roleOptions(m).flatMap(r => CHAIN_ROLE_RULES[m][r]?.capability ?? []))];
const ROLE_PHRASE: Record<ApproverRole, string> = { 'Line manager': 'a line manager', 'Service Manager': 'a Service Manager', Payroll: 'payroll', 'HR administrator': 'an HR administrator' };
const andList = (xs: readonly string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1] ?? ''}`);
/* who a layer waits on, in a sentence: "the line manager", "payroll" */
export const roleWaiting = (role: string) => (role === 'Line manager' ? 'the line manager' : role === 'Payroll' ? 'payroll' : role === 'Service Manager' ? 'the Service Manager' : role);

export const POSTING_ROLE = 'Business Central';
export const POSTING_STEP: ChainStep = { module: 'Timesheet', role: POSTING_ROLE, scope: '—', when: POSTS, sla: '—', fixed: true };
export const FIXED_TIP = 'Not an approver you can remove. This is the posting step. Approval writes the timesheet toward Business Central.';
export const CHAIN_TIP = 'Layers run in order within a module. A timesheet only reaches Business Central once every layer whose condition applies has signed off.';

/* The prototype's APPROVAL_CHAIN: what every tenant runs on until its chains are first saved. */
export const DEFAULT_CHAIN: readonly ChainStep[] = [
  { module: 'Timesheet', role: 'Line manager', scope: 'Own department', when: 'Every timesheet', sla: '24 hours', fixed: false },
  { module: 'Timesheet', role: 'Payroll', scope: 'All departments', when: 'Only above a premium threshold', sla: '48 hours', fixed: false },
  POSTING_STEP,
  { module: 'Profile', role: 'Line manager', scope: 'Own department', when: 'Every contact detail change', sla: '3 days', fixed: false },
  { module: 'Profile', role: 'Payroll', scope: 'All departments', when: 'Only bank details', sla: '2 days', fixed: false },
  { module: 'Leave', role: 'Line manager', scope: 'Own department', when: 'Every leave request', sla: '5 days', fixed: false },
  { module: 'Leave', role: 'Service Manager', scope: 'Own location', when: 'Only when the SLA is breached', sla: '2 days', fixed: false },
  { module: 'Rota', role: 'Service Manager', scope: 'Own location', when: 'Only for agency booking', sla: '4 hours', fixed: false },
];
export const defaultChainFor = (m: ChainModule): ChainStep[] => DEFAULT_CHAIN.filter(s => s.module === m).map(s => ({ ...s }));

/* chain-add: a new layer goes in before the posting step, named and set to apply as the prototype's does. */
export function newLayer(m: ChainModule): ChainStep {
  return { module: m, role: m === 'Rota' ? 'Service Manager' : 'Line manager', scope: 'Own department', when: whenOptions(m)[0] ?? '', sla: m === 'Rota' ? '4 hours' : '24 hours', fixed: false };
}
export function withLayer(steps: readonly ChainStep[], m: ChainModule): ChainStep[] {
  const out = [...steps], fixedAt = out.findIndex(s => s.fixed);
  out.splice(fixedAt < 0 ? out.length : fixedAt, 0, newLayer(m));
  return out;
}

/* ------------------------------------------------------------------ SLA */
export const SLA_UNITS = ['hours', 'days'] as const;
export type SlaUnit = (typeof SLA_UNITS)[number];
export const SLA_BOUNDS: Readonly<Record<SlaUnit, { min: number; max: number }>> = { hours: { min: 1, max: 168 }, days: { min: 1, max: 30 } };
export function parseSla(s: string): { n: number; unit: SlaUnit } | null {
  const m = /^(\d{1,3}) (hour|hours|day|days)$/.exec(s.trim());
  if (!m) return null;
  return { n: Number(m[1]), unit: m[2]?.startsWith('day') ? 'days' : 'hours' };
}
export const slaText = (n: number, unit: SlaUnit) => `${n} ${n === 1 ? unit.slice(0, -1) : unit}`;
/* null when the SLA is fine; otherwise why not */
export function slaProblem(s: string): string | null {
  const p = parseSla(s);
  if (!p) return 'Give the SLA as a number of hours or days, for example 24 hours.';
  const b = SLA_BOUNDS[p.unit];
  if (p.n < b.min || p.n > b.max) return `An SLA is between ${b.min} and ${b.max} ${p.unit}.`;
  return null;
}

/* ----------------------------------------------------------- validation */
export const MAX_LAYERS = 6;
const invalid = (field: string, message: string, next: string): Refusal => ({ status: 422, code: 'invalid', field, message, next });
const FIXED_EDITED: Refusal = { status: 422, code: 'FIXED', field: 'steps',
  message: 'Business Central is not an approver you can remove. It is the posting step and stays last in the Timesheet chain, as it is.',
  next: 'Keep the posting step at the end of the chain and change the layers above it.' };
const FIXED_ELSEWHERE = (m: ChainModule): Refusal => ({ status: 422, code: 'FIXED', field: 'steps',
  message: `The ${m} chain has no posting step. Only the Timesheet chain ends in Business Central.`, next: 'Remove that step, then save.' });
const sameStep = (a: ChainStep, b: ChainStep) => a.role === b.role && a.scope === b.scope && a.when === b.when && a.sla === b.sla && a.fixed === b.fixed;

/* A module's chain, sent whole. Checked top to bottom so the first problem
   named is the one nearest the top of the dialog. */
export function chainProblem(m: ChainModule, steps: readonly ChainStep[]): Refusal | null {
  const fixedAt = steps.flatMap((s, i) => (s.fixed || s.role === POSTING_ROLE ? [i] : []));
  if (m === 'Timesheet') {
    const last = steps[steps.length - 1];
    if (fixedAt.length !== 1 || fixedAt[0] !== steps.length - 1 || !last || !sameStep(last, POSTING_STEP)) return FIXED_EDITED;
  } else if (fixedAt.length) return FIXED_ELSEWHERE(m);
  const layers = steps.filter(s => !s.fixed);
  if (!layers.length) return invalid('steps', 'A chain needs at least one approver.', 'Add an approval layer, then save.');
  if (layers.length > MAX_LAYERS) return invalid('steps', `A chain has at most ${MAX_LAYERS} approval layers.`, 'Remove a layer, then save.');
  const roles = roleOptions(m), whens = whenOptions(m);
  for (const [i, s] of steps.entries()) {
    if (s.fixed) continue;
    if (!isApproverRole(s.role)) return invalid(`steps.${i}.role`, `${s.role || 'That'} is not an approver role. Choose a line manager, a Service Manager, payroll or an HR administrator.`, 'Choose a role from the list.');
    if (!roles.includes(s.role)) return invalid(`steps.${i}.role`, `The ${m} chain can only have ${andList(roles.map(r => ROLE_PHRASE[r]))}.`,
      roles.length === 2 ? 'Choose one of those two.' : roles.length === 1 ? 'Choose that role from the list.' : 'Choose one of those.');
    if (!(STEP_SCOPES as readonly string[]).includes(s.scope)) return invalid(`steps.${i}.scope`, `${s.scope || 'That'} is not a scope an approver can have.`, 'Choose a scope from the list.');
    if (!whens.includes(s.when)) return invalid(`steps.${i}.when`, `A ${m} layer cannot apply "${s.when}".`, 'Choose when it applies from the list.');
    const sla = slaProblem(s.sla);
    if (sla) return invalid(`steps.${i}.sla`, sla, 'Change the SLA, then save.');
  }
  if (m === 'Profile' || m === 'Timesheet') {
    for (const r of roles) if (layers.filter(s => s.role === r).length > 1)
      return invalid('steps', `${r} appears twice in the ${m} chain. Each approver signs off once.`, 'Remove one of them, then save.');
  }
  if (m === 'Profile' && !layers.some(s => s.when === 'Every contact detail change'))
    return invalid('steps', 'Every contact detail change needs an approver.', 'Set one layer to apply to every contact detail change.');
  if (m === 'Leave' && !layers.some(s => s.when === 'Every leave request'))
    return invalid('steps', 'Every leave request needs an approver.', 'Set one layer to apply to every leave request.');
  if (m === 'Timesheet') {
    /* a day reads "approved by manager, waiting on payroll", so the line manager goes first */
    const lm = layers.findIndex(s => s.role === 'Line manager');
    if (lm > 0) return invalid(`steps.${lm}.role`, 'The line manager signs off first in the Timesheet chain.', 'Make layer 1 the line manager, then save.');
    if (!layers.some(s => s.when === 'Every timesheet'))
      return invalid('steps', 'Every timesheet needs an approver.', 'Set one layer to apply to every timesheet.');
  }
  return null;
}
/* The chain in a sentence, for the toast and the audit row: "Line manager, then Payroll, then Business Central." */
export const chainText = (steps: readonly ChainStep[]) => `${steps.map(s => s.role).join(', then ')}.`;

/* ---------------------------------------------------------- delegations */
export interface Delegation { id: string; who: string; to: string; from: string; until: string; modules: ChainModule[] }
export type DelegationDraft = Omit<Delegation, 'id'>;
export interface DelegationContext {
  today: string;
  /* the person's name, when they are someone who can approve; undefined when they cannot */
  approver: (code: string) => string | undefined;
  /* any person's name, for a sentence */
  nameOf: (code: string) => string;
  /* the access a module's stages need that `who` holds and `to` lacks, by its label (a Profile delegate must be able to decide the stage) */
  lacks?: (who: string, to: string, m: ChainModule) => readonly string[];
}
const overlaps = (a: { from: string; until: string }, b: { from: string; until: string }) => a.from <= b.until && b.from <= a.until;
const shared = (a: readonly ChainModule[], b: readonly ChainModule[]) => CHAIN_MODULES.filter(m => a.includes(m) && b.includes(m));
const list = (xs: readonly string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1] ?? ''}`);
export const modulesText = (ms: readonly ChainModule[]) => CHAIN_MODULES.filter(m => ms.includes(m)).join(', ');
export const delegationText = (d: DelegationDraft, nameOf: (code: string) => string) =>
  `${nameOf(d.who)} to ${nameOf(d.to)}, ${formatDmy(d.from)} to ${formatDmy(d.until)}, ${modulesText(d.modules)}.`;
/* in force on that day, inclusive at both ends */
export const delegationActive = (d: Pick<Delegation, 'from' | 'until'>, date: string) => d.from <= date && date <= d.until;

/* Where `start`'s approvals for a module go over a window, following the
   delegations already in force: the path of people, start excluded. */
function pathFrom(start: string, m: ChainModule, window: { from: string; until: string }, existing: readonly Delegation[]): string[] {
  const path: string[] = [];
  let at = start;
  for (let hops = 0; hops <= existing.length; hops++) {
    const next = existing.find(e => e.who === at && e.modules.includes(m) && overlaps(e, window));
    if (!next || path.includes(next.to)) break;
    path.push(next.to);
    at = next.to;
  }
  return path;
}

export function delegationProblem(d: DelegationDraft, existing: readonly Delegation[], ctx: DelegationContext): Refusal | null {
  const whoName = ctx.approver(d.who), toName = ctx.approver(d.to);
  if (!whoName) return invalid('who', d.who ? `${ctx.nameOf(d.who)} does not approve anything, so there is no queue to cover.` : 'Choose whose approvals are covered.',
    'Choose someone with a manager or admin account.');
  if (!toName) return invalid('to', d.to ? `${ctx.nameOf(d.to)} cannot approve, so cannot cover a queue.` : 'Choose who covers the approvals.',
    'Choose someone with a manager or admin account.');
  if (d.to === d.who) return { status: 409, code: 'LOOP', field: 'to', message: `${whoName} cannot cover their own approvals.`, next: 'Choose someone else to cover them.' };
  if (d.until < d.from) return invalid('until', 'The last day cannot be before the first day.', 'Change the dates, then save.');
  if (d.until < ctx.today) return invalid('until', 'That delegation would already have ended.', 'Choose dates from today on.');
  if (!d.modules.length) return invalid('modules', 'Choose at least one module to delegate.', 'Tick the modules whose approvals are covered.');
  for (const m of d.modules) {
    const missing = ctx.lacks?.(d.who, d.to, m) ?? [];
    if (missing.length) return invalid('to', `${toName} cannot cover ${whoName}’s ${m} approvals without ${list(missing.map(x => `"${x}"`))}.`,
      `Choose someone who has ${missing.length > 1 ? 'them' : 'it'} in Permissions, or leave ${m} out.`);
  }
  const clash = existing.find(e => e.who === d.who && overlaps(e, d) && shared(e.modules, d.modules).length);
  if (clash) return { status: 409, code: 'OVERLAP', field: 'from',
    message: `${whoName} already delegates ${list(shared(clash.modules, d.modules))} to ${ctx.nameOf(clash.to)} from ${formatDmy(clash.from)} to ${formatDmy(clash.until)}.`,
    next: 'Remove that delegation first, or choose dates that do not overlap.' };
  for (const m of d.modules) {
    const path = pathFrom(d.to, m, d, existing);
    const back = path.indexOf(d.who);
    if (back < 0) continue;
    const via = path.slice(0, back).map(ctx.nameOf);
    return { status: 409, code: 'LOOP', field: 'to',
      message: via.length
        ? `${toName} already passes ${m} approvals on to ${list(via)}, and from there to ${whoName}, over those dates. They would go round in a circle.`
        : `${toName} already delegates ${m} to ${whoName} over those dates. The approvals would go round in a circle.`,
      next: 'Choose someone else to cover, or change the dates.' };
  }
  return null;
}

/* ---------------------------------------------------------- who decides */
export interface ApproverPerson { code: string; name: string; manager: string; location: string; department: string; active: boolean }
export interface ApproverWorld {
  people: readonly ApproverPerson[];
  /* who holds each role other than line manager, by employee code */
  holders: Readonly<Record<Exclude<ApproverRole, 'Line manager'>, readonly string[]>>;
}
export interface Decider { approver: string; acting: string }
export interface LayerDeciders { role: string; scope: string; when: string; sla: string; deciders: Decider[] }

/* The people a role puts in front of one person's request, before any
   delegation: the line manager is the person's own manager; any other role
   is everyone active who holds it within the layer's scope, never the
   person themself. Named employees has no list to name in this build, so it
   reads as all. */
export function approversFor(role: string, scope: string, personCode: string, world: ApproverWorld): string[] {
  const person = world.people.find(p => p.code === personCode);
  if (!person) return [];
  const active = (code: string) => world.people.find(p => p.code === code && p.active);
  if (role === 'Line manager') {
    const mgr = world.people.find(p => p.active && p.name === person.manager && p.code !== personCode);
    return mgr ? [mgr.code] : [];
  }
  if (!isApproverRole(role) || role === 'Line manager') return [];
  return world.holders[role].filter(code => {
    const h = active(code);
    if (!h || h.code === personCode) return false;
    if (scope === 'Own department') return h.department === person.department;
    if (scope === 'Own location' || scope === 'Own site') return h.location === person.location;
    return true;
  });
}
/* An approver's queue on a day: theirs, or their delegate's while a
   delegation for that module is in force. Followed once; a loop can never
   be saved. */
export function actingFor(approver: string, m: ChainModule, date: string, delegations: readonly Delegation[]): string {
  return delegations.find(d => d.who === approver && d.modules.includes(m) && delegationActive(d, date))?.to ?? approver;
}
/* Who decides each layer of a module's chain for one person on one day:
   the chain's role, then the person who holds it, then any delegation. */
export function whoDecides(steps: readonly ChainStep[], m: ChainModule, personCode: string, date: string, world: ApproverWorld,
  delegations: readonly Delegation[]): LayerDeciders[] {
  return steps.filter(s => !s.fixed).map(s => ({ role: s.role, scope: s.scope, when: s.when, sla: s.sla,
    deciders: approversFor(s.role, s.scope, personCode, world).map(a => ({ approver: a, acting: actingFor(a, m, date, delegations) })) }));
}

/* ------------------------------------------- walking a chain (module 8) */
/* What the server knows about one item that a layer's condition can test.
   Each module fills in the facts it has; a fact left out is false. */
export interface ItemFacts {
  /* Timesheet: the day's work type pays above the base rate */
  premium?: boolean;
  /* Timesheet: a non-working day, or time on a day of leave or sickness */
  absence?: boolean;
  /* Timesheet: entered by a manager on the person's behalf */
  proxy?: boolean;
  /* Profile: the change is to bank details */
  bankDetails?: boolean;
  /* Leave: the request's first layer has not decided within the SLA */
  slaBreached?: boolean;
  /* Rota: a shift of the week has gone to agency partners for cover */
  agency?: boolean;
}
export type Conditions = Readonly<Record<string, (f: ItemFacts) => boolean>>;
/* Every condition a layer can carry, read off the facts. */
export const CONDITIONS: Conditions = {
  'Every timesheet': () => true,
  'Every contact detail change': () => true,
  'Every leave request': () => true,
  'Only bank details': f => f.bankDetails === true,
  'Only above a premium threshold': f => f.premium === true,
  'Only for absence or non-working days': f => f.absence === true,
  'Only for proxy entries': f => f.proxy === true,
  'Only when the SLA is breached': f => f.slaBreached === true,
  'Only for agency booking': f => f.agency === true,
  'Every rota week': () => true,
};

/* Someone who might decide a layer: what the server knows of their record and access. */
export interface DeciderPerson {
  code: string; location: string; department: string; active: boolean; caps: readonly string[];
  /* their access covers every location (Workforce master data), not only their own */
  allLocations: boolean;
}
/* An item of a chain. personCode is '' for a rota week, which belongs to no
   one; department is left out for one, so Own department reads as its
   location. manager is the employee code of the person's line manager, who
   holds a Line manager layer for them whatever their department (Leave). */
export interface ChainItem { personCode: string; location: string; department?: string; manager?: string; facts: ItemFacts }
export interface WalkInput {
  module: ChainModule; steps: readonly ChainStep[]; item: ChainItem;
  /* the roles that have signed the item off since it was last submitted */
  signed: readonly string[];
  /* the day delegations are read on */
  date: string;
  people: readonly DeciderPerson[]; delegations: readonly Delegation[];
  conditions?: Conditions;
  /* Leave and Rota (module 8 group 4B): the people who signed an earlier
     layer. Every role of those chains needs the same capability, so without
     this one person could sign every layer; they decide no later one. */
  signers?: readonly string[];
}
export interface WalkLayer { step: ChainStep; holders: string[]; deciders: string[] }
export interface ChainWalk {
  /* the layers whose condition applies, in chain order, each with who may decide it */
  layers: WalkLayer[];
  /* the layer the item waits on: the first applicable one not yet signed. Once
     every one has signed, the last (a chain changed under the item), and null
     when no layer applies at all, so nothing needs to sign. */
  current: WalkLayer | null;
  /* signing the current layer finishes the chain */
  final: boolean;
}
/* How far an item has gone (module 8 group 4B): the layers already signed, and those an escalation layer took over from. */
export interface WalkProgress { signed: WalkLayer[]; passed: WalkLayer[] }

const layerApplies = (s: ChainStep, facts: ItemFacts, conditions: Conditions) => !s.fixed && (conditions[s.when]?.(facts) ?? false);
/* The layer's own scope, against the approver's record. Named employees has no list in this build, so it reads as all. */
function inLayerScope(scope: string, p: DeciderPerson, item: ChainItem): boolean {
  if (scope === 'Own department') return item.department === undefined ? p.location === item.location : p.department === item.department;
  if (scope === 'Own location' || scope === 'Own site') return p.location === item.location;
  return true;
}
/* Holds the layer's role for this item: the role's capability, the item in
   their access scope when the role is scoped, and in the layer's own scope.
   Never the item's own person. */
export function holdsLayer(m: ChainModule, s: ChainStep, p: DeciderPerson, item: ChainItem): boolean {
  const rule = roleRule(m, s.role);
  if (!rule || !p.active || p.code === item.personCode || !p.caps.includes(rule.capability)) return false;
  if (rule.scoped && !p.allLocations && p.location !== item.location) return false;
  if (s.role === 'Line manager' && item.manager !== undefined && item.manager === p.code) return true;
  return inLayerScope(s.scope, p, item);
}
/* The holders of a layer, then, while a delegation for the module is in
   force on the day, whoever covers each of them, as decidersToday does for
   Profile. A delegate never decides their own item. */
function layerDeciders(m: ChainModule, s: ChainStep, input: WalkInput): WalkLayer {
  const signers = input.signers ?? [];
  const holders = input.people.filter(p => holdsLayer(m, s, p, input.item) && !signers.includes(p.code)).map(p => p.code);
  const active = (code: string) => input.people.some(p => p.code === code && p.active);
  const deciders = [...new Set(holders.flatMap(h => {
    const to = actingFor(h, m, input.date, input.delegations);
    return to !== h && to !== input.item.personCode && !signers.includes(to) && active(to) ? [h, to] : [h];
  }))];
  return { step: s, holders, deciders };
}

/* The shared layer walker (module 8 group 4): Timesheet, Leave and Rota walk
   their chains through it. Each signed role signs off the first applicable
   layer of that role not yet signed, so a chain may hold one role twice (a
   Rota chain is Service Managers only). An escalation layer that applies
   (the SLA is breached) takes over from the unsigned layers before it: they
   are passed, and the item waits on the escalation layer. */
function walkParts(input: WalkInput) {
  const conditions = input.conditions ?? CONDITIONS;
  const layers = input.steps.filter(s => layerApplies(s, input.item.facts, conditions)).map(s => layerDeciders(input.module, s, input));
  const pool = [...input.signed], done = new Set<number>();
  layers.forEach((l, i) => {
    const k = pool.indexOf(l.step.role);
    if (k >= 0) { pool.splice(k, 1); done.add(i); }
  });
  const lastEscalation = layers.reduce((at, l, i) => (l.step.when === ESCALATION_WHEN && !done.has(i) ? i : at), -1);
  const passed = new Set(layers.flatMap((_, i) => (i < lastEscalation && !done.has(i) ? [i] : [])));
  const left = layers.filter((_, i) => !done.has(i) && !passed.has(i));
  return { layers, left, signed: layers.filter((_, i) => done.has(i)), passed: layers.filter((_, i) => passed.has(i)) };
}
export function walkChain(input: WalkInput): ChainWalk {
  const { layers, left } = walkParts(input);
  const current = left[0] ?? layers[layers.length - 1] ?? null;
  return { layers, current, final: left.length <= 1 };
}
export function walkProgress(input: WalkInput): WalkProgress {
  const { signed, passed } = walkParts(input);
  return { signed, passed };
}

/* Why someone may not decide the item at its current layer, or null when
   they may: it is their own; they signed an earlier layer of it (Leave and
   Rota); they hold the current layer's role but the item is outside their
   scope; they sign off another layer of this chain; or nothing in the chain
   is theirs. */
export type DecisionBlock = 'self' | 'signed' | 'scope' | 'layer' | 'capability';
export function decisionBlock(walk: ChainWalk, input: Pick<WalkInput, 'module' | 'item' | 'people' | 'signers'>, code: string): DecisionBlock | null {
  if (code === input.item.personCode) return 'self';
  if (input.signers?.includes(code)) return 'signed';
  if (walk.current?.deciders.includes(code)) return null;
  const caps = input.people.find(p => p.code === code)?.caps ?? [];
  const rule = walk.current ? roleRule(input.module, walk.current.step.role) : undefined;
  if (rule && caps.includes(rule.capability)) return 'scope';
  if (walk.layers.some(l => l.deciders.includes(code)) || chainCapabilities(input.module).some(c => caps.includes(c))) return 'layer';
  return 'capability';
}

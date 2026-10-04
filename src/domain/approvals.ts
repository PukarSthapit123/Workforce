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
export const CHAIN_WHEN = ['Every timesheet', 'Every contact detail change', 'Only bank details', 'Every leave request', 'Only above a premium threshold',
  'Only for absence or non-working days', 'Only for proxy entries', 'Only when the SLA is breached',
  'Only for agency booking', 'Posts on final approval'] as const;
export const POSTS = 'Posts on final approval';
export const PROFILE_WHEN = ['Every contact detail change', 'Only bank details'] as const;
export const PROFILE_ROLES: readonly ApproverRole[] = ['Line manager', 'Payroll'];

/* The conditions a module's layer may carry: the Profile chain its own two,
   since they decide which fields go to whom; every other chain any of the
   prototype's, less the posting step's and the Profile two. */
export const whenOptions = (m: ChainModule): readonly string[] =>
  m === 'Profile' ? PROFILE_WHEN : CHAIN_WHEN.filter(w => w !== POSTS && !(PROFILE_WHEN as readonly string[]).includes(w));
export const roleOptions = (m: ChainModule): readonly ApproverRole[] => (m === 'Profile' ? PROFILE_ROLES : APPROVER_ROLES);

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
    if (!roles.includes(s.role)) return invalid(`steps.${i}.role`, 'The Profile chain can only have a line manager and payroll.', 'Choose one of those two.');
    if (!(STEP_SCOPES as readonly string[]).includes(s.scope)) return invalid(`steps.${i}.scope`, `${s.scope || 'That'} is not a scope an approver can have.`, 'Choose a scope from the list.');
    if (!whens.includes(s.when)) return invalid(`steps.${i}.when`, `A ${m} layer cannot apply "${s.when}".`, 'Choose when it applies from the list.');
    const sla = slaProblem(s.sla);
    if (sla) return invalid(`steps.${i}.sla`, sla, 'Change the SLA, then save.');
  }
  if (m === 'Profile') {
    for (const r of PROFILE_ROLES) if (layers.filter(s => s.role === r).length > 1)
      return invalid('steps', `${r} appears twice in the Profile chain. Each approver signs off once.`, 'Remove one of them, then save.');
    if (!layers.some(s => s.when === 'Every contact detail change'))
      return invalid('steps', 'Every contact detail change needs an approver.', 'Set one layer to apply to every contact detail change.');
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

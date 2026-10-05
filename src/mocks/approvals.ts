/* 1c group 5: approval chains and delegations (brief D8). Every rule is
   src/domain/approvals.ts's; the handlers read the store into it. A chain
   is stored once it is first saved, one record per module, and until then
   reads as the prototype's default at version 0, as the notification matrix
   does. A refusal or a fault writes nothing, because serve() restores the
   store. One audit row per write. */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, capsFor, accountForPerson } from './auth';
import { writeAudit } from './audit';
import { effectiveCode, people, personByCode, recordAt, today } from './world';
import { tenantRec, tsConfig } from './tenant';
import {
  createDelegation, getApprovalSetup, listDelegations, listMyDelegations, removeDelegation, saveApprovalChain,
  type ApprovalChain, type Delegation as DelegationView, type SignOff,
} from '@/contract/approvals';
import {
  CHAIN_MODULES, actingFor, approversFor, chainId, chainModuleOf, chainProblem, chainText, defaultChainFor, delegationActive, delegationProblem,
  delegationText, type ApproverWorld, type ChainModule, type ChainStep, type Delegation,
} from '@/domain/approvals';
import type { Refusal as DomainRefusal } from '@/domain/modules';
import { STAGE_CAPABILITY, STAGE_CAPABILITY_LABEL, type Stage } from '@/domain/selfService';
import { addDays, clockFromIso, periodStart } from '@/domain/time';
import { DEFAULT_RULES, periodLocked } from '@/domain/timesheet';

export interface StoredChain { id: string; version: number; updatedAt: string; module: ChainModule; steps: ChainStep[] }
export interface StoredDelegation extends Delegation { version: number; updatedAt: string }
const chains = () => store.coll<StoredChain>('approvalChains');
export const delegations = () => store.coll<StoredDelegation>('delegations');
const refuseWith = (r: DomainRefusal): never =>
  refuse(r.status, { code: r.code, message: r.message, next: r.next, ...(r.field ? { field: r.field } : {}) });

/* ---------------------------------------------------------------- chains */
export const chainRecord = (m: ChainModule): StoredChain =>
  recordAt(chains(), chainId(m)) ?? { id: chainId(m), version: 0, updatedAt: store.now(), module: m, steps: defaultChainFor(m) };
/* every module's chain as one list, in the prototype's order: what a template captures */
export const chainsNow = (): ChainStep[] => CHAIN_MODULES.flatMap(m => chainRecord(m).steps.map(s => ({ ...s, module: m })));
/* Writes one module's chain; the caller has checked it and writes the audit row. */
export function writeChain(m: ChainModule, steps: readonly ChainStep[]): StoredChain {
  const rec = chainRecord(m);
  const saved = bump(rec, { steps: steps.map(s => ({ ...s, module: m })) });
  chains()[rec.id] = saved;
  return saved;
}
const chainView = (c: StoredChain): ApprovalChain => ({ id: c.id, version: c.version, updatedAt: c.updatedAt, module: c.module,
  steps: c.steps.map(s => ({ role: s.role, scope: s.scope, when: s.when, sla: s.sla, fixed: s.fixed })) });

function signOff(): SignOff {
  const tc = tsConfig(), clock = clockFromIso(store.now());
  const enforceLock = tc?.rules.enforceLock ?? DEFAULT_RULES.enforceLock, cutoff = tc?.cutoff ?? 'Monday 12:00';
  const from = periodStart(clock.date), prev = addDays(from, -7);
  return {
    emailApproval: tenantRec().flags.EMAIL_APPROVAL === true, cutoff, enforceLock, returnReasonRequired: tc?.returnReasonRequired ?? true,
    current: { from, to: addDays(from, 6) },
    previous: { from: prev, to: addDays(prev, 6), closed: periodLocked(prev, { enforceLock, cutoff }, clock) },
  };
}

/* ------------------------------------------------------------ approvers */
/* The capability that makes someone a holder of each role other than line
   manager: Service Manager decides team leave; payroll verifies bank
   details; HR administration keeps the workforce master data. */
const ROLE_CAP = { 'Service Manager': 'team_leave', Payroll: 'bank_verify', 'HR administrator': 'master_data' } as const;
/* Someone can approve, and so give or cover a queue, while they are active and hold any approving capability. */
const APPROVING = ['team_ts', 'team_leave', 'profile_appr', 'bank_verify'];
const capsOf = (code: string) => { const a = accountForPerson(code); return a ? capsFor(a) : []; };
const isActive = (code: string) => personByCode(code)?.state === 'active';
export const canApprove = (code: string) => isActive(code) && capsOf(code).some(c => APPROVING.includes(c));
const nameOf = (code: string) => personByCode(code)?.name ?? code;
export function approverWorld(): ApproverWorld {
  const all = Object.values(people());
  const holders = (cap: string) => all.filter(p => p.state === 'active' && capsOf(p.code).includes(cap)).map(p => p.code);
  return {
    people: all.map(p => ({ code: p.code, name: p.name, manager: p.manager, location: p.location, department: p.department, active: p.state === 'active' })),
    holders: { 'Service Manager': holders(ROLE_CAP['Service Manager']), Payroll: holders(ROLE_CAP.Payroll), 'HR administrator': holders(ROLE_CAP['HR administrator']) },
  };
}
const delegationList = (): StoredDelegation[] => Object.values(delegations()).sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id));
/* Who is told today for one role of a module's chain, for one person: the
   people the role names and, while a delegation is in force, their delegate
   as well, so the approver they cover still hears of it. Used to address
   notifications. */
export function decidersToday(m: ChainModule, role: string, scope: string, personCode: string): string[] {
  const list = delegationList(), day = today();
  return [...new Set(approversFor(role, scope, personCode, approverWorld()).flatMap(a => { const act = actingFor(a, m, day, list); return act === a ? [a] : [act, a]; }))];
}
/* A Profile delegate must hold the access each stage the approver decides needs. */
const PROFILE_STAGES: readonly Stage[] = ['manager', 'payroll'];
const lacks = (who: string, to: string, m: ChainModule): string[] => {
  if (m !== 'Profile') return [];
  const mine = capsOf(who), theirs = capsOf(to);
  return PROFILE_STAGES.filter(s => mine.includes(STAGE_CAPABILITY[s]) && !theirs.includes(STAGE_CAPABILITY[s])).map(s => STAGE_CAPABILITY_LABEL[s]);
};

/* ----------------------------------------------------------- delegations */
const delegationView = (d: StoredDelegation): DelegationView => ({ id: d.id, version: d.version, updatedAt: d.updatedAt, who: d.who, whoName: nameOf(d.who),
  to: d.to, toName: nameOf(d.to), from: d.from, until: d.until, modules: CHAIN_MODULES.filter(m => d.modules.includes(m)), active: delegationActive(d, today()) });
const DLG = /^dlg_(\d+)$/;
function nextDelegationId(): string {
  let max = 0;
  for (const id of Object.keys(delegations())) max = Math.max(max, Number(DLG.exec(id)?.[1] ?? 0));
  return `dlg_${String(max + 1)}`;
}
const NO_CHAIN = (m: string) => ({ code: 'not-found', message: `There is no approval chain for "${m}".`, next: 'Reload the page and choose a module from the list.' });
const NO_DELEGATION = { code: 'not-found', message: 'That delegation no longer exists.', next: 'Reload the page.' };

export const approvalHandlers = [
  serve(getApprovalSetup, () => ({ chains: CHAIN_MODULES.map(m => chainView(chainRecord(m))), signOff: signOff() })),

  serve(saveApprovalChain, ({ session, params, body, checkVersion }) => {
    const m = chainModuleOf(params.module) ?? refuse(404, NO_CHAIN(params.module));
    const rec = chainRecord(m);
    checkVersion(rec);
    const steps: ChainStep[] = body.steps.map(s => ({ ...s, module: m }));
    const problem = chainProblem(m, steps);
    if (problem) return refuseWith(problem);
    const same = rec.steps.length === steps.length && rec.steps.every((s, i) => {
      const n = steps[i];
      return n !== undefined && s.role === n.role && s.scope === n.scope && s.when === n.when && s.sla === n.sla && s.fixed === n.fixed;
    });
    if (same) return { record: chainView(rec), auditId: null, message: 'Nothing has changed.' };
    const saved = writeChain(m, steps);
    const message = `${m} approval chain saved: ${chainText(steps)}`;
    const auditId = writeAudit({ who: actor(session), act: 'Approval chain changed', entity: 'approvalChain', entityId: saved.id,
      before: { steps: rec.steps.map(s => `${s.role} · ${s.when}`) }, after: { steps: steps.map(s => `${s.role} · ${s.when}`), detail: message } });
    return { record: chainView(saved), auditId, message };
  }),

  serve(listDelegations, () => ({
    items: delegationList().map(delegationView),
    approvers: Object.values(people()).filter(p => canApprove(p.code)).sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ code: p.code, name: p.name })),
  })),

  serve(listMyDelegations, ({ session }) => {
    const me = effectiveCode(session);
    return delegationList().filter(d => d.who === me || d.to === me).map(delegationView);
  }),

  serve(createDelegation, ({ session, body }) => {
    const draft = { who: body.who, to: body.to, from: body.from, until: body.until, modules: CHAIN_MODULES.filter(m => body.modules.includes(m)) };
    const problem = delegationProblem(draft, delegationList(), { today: today(), approver: c => (canApprove(c) ? nameOf(c) : undefined), nameOf, lacks });
    if (problem) return refuseWith(problem);
    const id = nextDelegationId();
    const rec: StoredDelegation = { id, version: 1, updatedAt: store.now(), ...draft };
    delegations()[id] = rec;
    const message = `Delegation added: ${delegationText(draft, nameOf)} Every decision records who acted.`;
    const auditId = writeAudit({ who: actor(session), act: 'Delegation added', entity: 'delegation', entityId: id, before: null,
      after: { who: draft.who, to: draft.to, from: draft.from, until: draft.until, modules: draft.modules, detail: delegationText(draft, nameOf) } });
    return { record: delegationView(rec), auditId, message };
  }),

  serve(removeDelegation, ({ session, params, checkVersion }) => {
    const rec = recordAt(delegations(), params.id) ?? refuse(404, NO_DELEGATION);
    checkVersion(rec);
    Reflect.deleteProperty(delegations(), rec.id);
    const auditId = writeAudit({ who: actor(session), act: 'Delegation removed', entity: 'delegation', entityId: rec.id,
      before: { who: rec.who, to: rec.to, from: rec.from, until: rec.until, modules: rec.modules, detail: delegationText(rec, nameOf) }, after: null });
    return { auditId, message: 'Delegation removed.' };
  }),
];


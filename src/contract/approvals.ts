/* 1c group 5: approval chains and delegations (brief D8). One chain per
   module, read at the prototype's defaults (version 0) until it is first
   saved, and saved whole with If-Match. The Timesheet chain ends in the
   fixed Business Central posting step. A delegation hands one approver's
   queue to another for a date range, both days included; covering yourself,
   a loop and an overlap are refused. Everything here needs the approval
   framework, except a manager's own delegations, which Team leave shows. */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta } from './common';
import { IsoDate } from './people';

/* the same four as src/domain/approvals.ts CHAIN_MODULES (the contract test holds them together) */
export const ChainModule = z.enum(['Timesheet', 'Profile', 'Leave', 'Rota']);
export type ChainModule = z.infer<typeof ChainModule>;
/* A layer as sent and as read. The role is one of the four approver roles,
   or Business Central on the fixed posting step; the server says which. */
export const ChainLayer = z.strictObject({ role: z.string().max(40), scope: z.string().max(60), when: z.string().max(80), sla: z.string().max(40), fixed: z.boolean() });
export type ChainLayer = z.infer<typeof ChainLayer>;
export const ApprovalChain = RecordMeta.extend({ module: ChainModule, steps: z.array(ChainLayer) });
export type ApprovalChain = z.infer<typeof ApprovalChain>;
/* Sign-off settings, read here and changed where they live: the approval
   method is the Email approval feature (Modules and features), the cut-off,
   its enforcement and the return reason are on Timesheet setup. */
const Period = z.object({ from: IsoDate, to: IsoDate });
export const SignOff = z.object({
  emailApproval: z.boolean(), cutoff: z.string(), enforceLock: z.boolean(), returnReasonRequired: z.boolean(),
  current: Period, previous: Period.extend({ closed: z.boolean() }),
});
export type SignOff = z.infer<typeof SignOff>;
export const ApprovalSetup = z.object({ chains: z.array(ApprovalChain), signOff: SignOff });
export type ApprovalSetup = z.infer<typeof ApprovalSetup>;
export const SaveChain = z.strictObject({ steps: z.array(ChainLayer).max(12) });
export type SaveChain = z.infer<typeof SaveChain>;
export const ChainSaved = z.object({ record: ApprovalChain, auditId: z.string().nullable(), message: z.string() });
export type ChainSaved = z.infer<typeof ChainSaved>;

export const Delegation = RecordMeta.extend({
  who: z.string(), whoName: z.string(), to: z.string(), toName: z.string(), from: IsoDate, until: IsoDate, modules: z.array(ChainModule),
  /* in force today */
  active: z.boolean(),
});
export type Delegation = z.infer<typeof Delegation>;
/* the people who can approve, for the two pickers */
export const Approver = z.object({ code: z.string(), name: z.string() });
export const Delegations = z.object({ items: z.array(Delegation), approvers: z.array(Approver) });
export type Delegations = z.infer<typeof Delegations>;
export const CreateDelegation = z.strictObject({
  who: z.string().max(20), to: z.string().max(20),
  from: IsoDate.or(z.literal('')).refine(v => v !== '', 'Choose the first day.'),
  until: IsoDate.or(z.literal('')).refine(v => v !== '', 'Choose the last day.'),
  modules: z.array(ChainModule).max(4),
});
export type CreateDelegation = z.infer<typeof CreateDelegation>;
export const DelegationSaved = z.object({ record: Delegation, auditId: z.string(), message: z.string() });
export type DelegationSaved = z.infer<typeof DelegationSaved>;

const cap = 'framework';
const ModuleParams = z.object({ module: z.string().min(1).max(20) });
const IdParams = z.object({ id: z.string().min(1).max(40) });
export const getApprovalSetup = defineEndpoint({ method: 'GET', path: '/api/v1/approvals/chains', response: ApprovalSetup, capability: cap,
  summary: 'Every module\'s approval chain (the prototype\'s defaults at version 0 until first saved) and the sign-off settings, read from where they live' });
export const saveApprovalChain = defineEndpoint({ method: 'PUT', path: '/api/v1/approvals/chains/:module', params: ModuleParams, request: SaveChain,
  response: ChainSaved, capability: cap, versioned: true, errors: [404],
  summary: 'Save one module\'s chain whole (If-Match). Roles are Line manager, Service Manager, Payroll or HR administrator; the Business Central posting step stays last in the Timesheet chain (FIXED); the Profile chain has only a line manager and payroll. One audit row.' });
export const listDelegations = defineEndpoint({ method: 'GET', path: '/api/v1/approvals/delegations', response: Delegations, capability: cap,
  summary: 'Every delegation, soonest first, and the people who can approve' });
export const createDelegation = defineEndpoint({ method: 'POST', path: '/api/v1/approvals/delegations', request: CreateDelegation, response: DelegationSaved,
  capability: cap, errors: [409],
  summary: 'Hand an approver\'s queue to another for a date range, both days included. Covering yourself or a circle of delegations is LOOP; a second one for the same approver, module and days is OVERLAP. One audit row.' });
export const removeDelegation = defineEndpoint({ method: 'DELETE', path: '/api/v1/approvals/delegations/:id', params: IdParams,
  response: z.object({ auditId: z.string(), message: z.string() }), capability: cap, versioned: true, errors: [404],
  summary: 'Remove a delegation (If-Match). One audit row.' });
export const listMyDelegations = defineEndpoint({ method: 'GET', path: '/api/v1/approvals/delegations/mine', response: z.array(Delegation), capability: 'team_leave',
  summary: 'The delegations a manager gives or covers, for the While you are away card on Team leave' });

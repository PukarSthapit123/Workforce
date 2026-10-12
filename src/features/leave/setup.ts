/* The setup draft stays local until its versioned Leave config save succeeds. */
import type { LeaveConfigRecord, LeavePolicy, LeaveStage, LeaveTypeRecord, UpdateLeaveConfig } from '@/api/leave';
import {
  LEAVE_METHODS, LEAVE_UNITS, newLeavePolicy, newLeaveStage, newLeaveType, renumberLeaveStages, typeLeaveFor,
  type LeaveMethod, type LeaveUnit, type TypeLeave,
} from '@/domain/leave';

export const NUM_KEYS = ['toilMax', 'absenceTrigger', 'slaDays', 'minNotice', 'cancelWindow'] as const;
export type NumKey = (typeof NUM_KEYS)[number];
export const TOGGLE_KEYS = ['bhPaid', 'blocksTimesheet'] as const;
export type ToggleKey = (typeof TOGGLE_KEYS)[number];
export const POLICY_NUM_KEYS = ['base', 'carry', 'sla'] as const;
export type PolicyNumKey = (typeof POLICY_NUM_KEYS)[number];

export interface PolicyDraft {
  code: string; name: string; method: LeaveMethod; unit: LeaveUnit; prorata: boolean; approval: boolean;
  bankHolidayHandling: LeavePolicy['bankHolidayHandling']; serviceRules: LeavePolicy['serviceRules']; nums: Record<PolicyNumKey, string>;
}
export interface StageDraft { who: string; action: string; wait: string; channel: string }
export interface LeaveDraft {
  nums: Record<NumKey, string>; toggles: Record<ToggleKey, boolean>; toilWindow: number;
  types: LeaveTypeRecord[]; policies: PolicyDraft[]; stages: StageDraft[]; typeLeave: Record<string, TypeLeave>; sicknessReasons: string[];
}

export const leaveUnit = (v: string): LeaveUnit | undefined => LEAVE_UNITS.find(u => u === v);
export const leaveMethod = (v: string): LeaveMethod | undefined => LEAVE_METHODS.find(m => m === v);
const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? -1 : Number(s));
const pick = <K extends string, V>(keys: readonly K[], fn: (k: K) => V) => Object.fromEntries(keys.map(k => [k, fn(k)])) as Record<K, V>;
const TYPE_KEYS = ['code', 'name', 'icon', 'short', 'policy', 'paid', 'evidence', 'unit', 'active'] as const;
const sameTypes = (a: readonly LeaveTypeRecord[], b: readonly LeaveTypeRecord[]) =>
  a.length === b.length && a.every((t, i) => { const u = b[i]; return !!u && TYPE_KEYS.every(k => t[k] === u[k]); });
const sameStages = (a: readonly LeaveStage[], b: readonly LeaveStage[]) => a.length === b.length
  && a.every((s, i) => { const t = b[i]; return !!t && s.who === t.who && s.action === t.action && s.wait === t.wait && s.channel === t.channel; });
const samePolicies = (a: readonly LeavePolicy[], b: readonly LeavePolicy[]) => a.length === b.length
  && a.every((p, i) => {
    const q = b[i];
    return !!q && p.code === q.code && p.name === q.name && p.method === q.method && p.unit === q.unit && p.base === q.base
      && p.prorata === q.prorata && p.carry === q.carry && p.approval === q.approval && p.sla === q.sla
      && p.bankHolidayHandling === q.bankHolidayHandling && p.serviceRules.length === q.serviceRules.length
      && p.serviceRules.every((r, j) => {
        const s = q.serviceRules[j];
        return !!s && r.afterYears === s.afterYears && r.add === s.add && r.cap === s.cap;
      });
  });
const stageDraft = (s: LeaveStage): StageDraft => ({ who: s.who, action: s.action, wait: String(s.wait), channel: s.channel });
const policyDraft = (p: LeavePolicy): PolicyDraft => ({
  ...p, nums: { base: String(p.base), carry: String(p.carry), sla: p.sla === null ? '' : String(p.sla) },
});

export function draftOf(c: LeaveConfigRecord, typeCodes: readonly string[]): LeaveDraft {
  return {
    nums: pick(NUM_KEYS, k => String(c[k])), toggles: pick(TOGGLE_KEYS, k => c[k]),
    toilWindow: c.toilWindow,
    types: c.types.map(t => ({ ...t })), policies: c.policies.map(policyDraft),
    stages: c.stages.map(stageDraft), sicknessReasons: [...c.sicknessReasons],
    typeLeave: Object.fromEntries(typeCodes.map(code => [code, { ...typeLeaveFor(c.typeLeave, code) }])),
  };
}

/* Module 8 group 3: the code and name are given in the Add dialog, and the code is read-only from then on */
export function addedType(code: string, name: string, policies: readonly PolicyDraft[]): LeaveTypeRecord {
  const policy = policies.some(p => p.code === 'FIX') ? 'FIX' : policies[0]?.code ?? '';
  return { ...newLeaveType(0), code, name, short: name.slice(0, 20), policy };
}
export const addedPolicy = (code: string, name: string): PolicyDraft => policyDraft({ ...newLeavePolicy(0), code, name });
export const newStageDraft = (n: number): StageDraft => stageDraft(newLeaveStage(n));

const policyOf = (p: PolicyDraft): LeavePolicy => ({
  code: p.code, name: p.name, method: p.method, unit: p.unit, prorata: p.prorata, approval: p.approval,
  bankHolidayHandling: p.bankHolidayHandling, serviceRules: p.serviceRules,
  base: num(p.nums.base), carry: num(p.nums.carry), sla: p.nums.sla.trim() ? num(p.nums.sla) : null,
});

export function leaveBody(c: LeaveConfigRecord, d: LeaveDraft): UpdateLeaveConfig {
  const body: UpdateLeaveConfig = {};
  for (const k of NUM_KEYS) if (num(d.nums[k]) !== c[k]) body[k] = num(d.nums[k]);
  for (const k of TOGGLE_KEYS) if (d.toggles[k] !== c[k]) body[k] = d.toggles[k];
  if (d.toilWindow !== c.toilWindow) body.toilWindow = d.toilWindow;
  if (!sameTypes(d.types, c.types)) body.types = d.types;
  const policies = d.policies.map(policyOf);
  if (!samePolicies(policies, c.policies)) body.policies = policies;
  const stages = renumberLeaveStages(d.stages.map(s => ({ n: 0, who: s.who, action: s.action, wait: num(s.wait), channel: s.channel })));
  if (!sameStages(stages, c.stages)) body.stages = stages;
  if (JSON.stringify(d.sicknessReasons) !== JSON.stringify(c.sicknessReasons)) body.sicknessReasons = d.sicknessReasons;
  const changed = Object.entries(d.typeLeave).filter(([code, t]) => {
    const was = typeLeaveFor(c.typeLeave, code);
    return t.policy !== was.policy || t.unit !== was.unit;
  });
  if (changed.length) body.typeLeave = Object.fromEntries(changed);
  return body;
}

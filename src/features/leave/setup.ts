/* Leave setup's draft: what the page edits before Save, and the PATCH body it
   sends (D11). Numbers are kept as typed, so a half-typed value is not
   rewritten under the cursor; a value that is not a number is sent as -1,
   which the server refuses on that field with its own message. Only what
   changed is sent: the scalar settings one by one, the leave types, policies
   and stages each as one list when any of them changed, and the per-type
   leave policy by employee type code (the server merges it). */
import type { LeaveConfigRecord, LeaveStage, LeaveTypeRecord, UpdateLeaveConfig } from '@/api/leave';
import { LEAVE_UNITS, newLeaveStage, newLeaveType, renumberLeaveStages, typeLeaveFor, type LeaveUnit, type TypeLeave } from '@/domain/leave';

export const NUM_KEYS = ['carry', 'toilMax', 'absenceTrigger', 'slaDays', 'minNotice', 'cancelWindow'] as const;
export type NumKey = (typeof NUM_KEYS)[number];
export const TOGGLE_KEYS = ['bhPaid', 'buySell', 'blocksTimesheet'] as const;
export type ToggleKey = (typeof TOGGLE_KEYS)[number];
export const POLICY_NUM_KEYS = ['base', 'carry', 'sla'] as const;
export type PolicyNumKey = (typeof POLICY_NUM_KEYS)[number];

export interface PolicyDraft { unit: LeaveUnit; nums: Record<PolicyNumKey, string> }
export interface StageDraft { who: string; action: string; wait: string; channel: string }
export interface LeaveDraft {
  nums: Record<NumKey, string>; toggles: Record<ToggleKey, boolean>; unit: string; finYearStart: string; toilWindow: number; escalateTo: string;
  types: LeaveTypeRecord[]; policies: PolicyDraft[]; stages: StageDraft[]; typeLeave: Record<string, TypeLeave>;
}

/* a select's value back to its unit, or undefined if it is not one */
export const leaveUnit = (v: string): LeaveUnit | undefined => LEAVE_UNITS.find(u => u === v);
const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? -1 : Number(s));
const pick = <K extends string, V>(keys: readonly K[], fn: (k: K) => V) => Object.fromEntries(keys.map(k => [k, fn(k)])) as Record<K, V>;
const TYPE_KEYS = ['code', 'name', 'icon', 'short', 'policy', 'paid', 'evidence', 'unit', 'active'] as const;
const sameTypes = (a: readonly LeaveTypeRecord[], b: readonly LeaveTypeRecord[]) =>
  a.length === b.length && a.every((t, i) => { const u = b[i]; return !!u && TYPE_KEYS.every(k => t[k] === u[k]); });
const sameStages = (a: readonly LeaveStage[], b: readonly LeaveStage[]) => a.length === b.length
  && a.every((s, i) => { const t = b[i]; return !!t && s.who === t.who && s.action === t.action && s.wait === t.wait && s.channel === t.channel; });

const stageDraft = (s: LeaveStage): StageDraft => ({ who: s.who, action: s.action, wait: String(s.wait), channel: s.channel });

/* Every employee type gets a per-type policy: one with none stored starts from the default the rules already apply to it. */
export function draftOf(c: LeaveConfigRecord, typeCodes: readonly string[]): LeaveDraft {
  return {
    nums: pick(NUM_KEYS, k => String(c[k])), toggles: pick(TOGGLE_KEYS, k => c[k]),
    unit: c.unit, finYearStart: c.finYearStart, toilWindow: c.toilWindow, escalateTo: c.escalateTo,
    types: c.types.map(t => ({ ...t })),
    policies: c.policies.map(p => ({ unit: p.unit, nums: pick(POLICY_NUM_KEYS, k => String(p[k])) })),
    stages: c.stages.map(stageDraft),
    typeLeave: Object.fromEntries(typeCodes.map(code => [code, { ...typeLeaveFor(c.typeLeave, code) }])),
  };
}

/* lvt-add: NEW<n>, inactive, on the fixed allowance; n moves on past a code already taken. */
export function addedType(types: readonly LeaveTypeRecord[]): LeaveTypeRecord {
  let n = types.length;
  while (types.some(t => t.code === `NEW${n}`)) n += 1;
  return newLeaveType(n);
}
export const newStageDraft = (n: number): StageDraft => stageDraft(newLeaveStage(n));

export function leaveBody(c: LeaveConfigRecord, d: LeaveDraft): UpdateLeaveConfig {
  const body: UpdateLeaveConfig = {};
  for (const k of NUM_KEYS) if (num(d.nums[k]) !== c[k]) body[k] = num(d.nums[k]);
  for (const k of TOGGLE_KEYS) if (d.toggles[k] !== c[k]) body[k] = d.toggles[k];
  if (d.unit !== c.unit) body.unit = d.unit;
  if (d.finYearStart !== c.finYearStart) body.finYearStart = d.finYearStart;
  if (d.toilWindow !== c.toilWindow) body.toilWindow = d.toilWindow;
  if (d.escalateTo !== c.escalateTo) body.escalateTo = d.escalateTo;
  if (!sameTypes(d.types, c.types)) body.types = d.types;
  const policies = c.policies.map((p, i) => {
    const x = d.policies[i];
    return x ? { ...p, unit: x.unit, ...pick(POLICY_NUM_KEYS, k => num(x.nums[k])) } : p;
  });
  if (policies.some((p, i) => { const was = c.policies[i]; return !was || p.unit !== was.unit || POLICY_NUM_KEYS.some(k => p[k] !== was[k]); }))
    body.policies = policies;
  const stages = renumberLeaveStages(d.stages.map(s => ({ n: 0, who: s.who, action: s.action, wait: num(s.wait), channel: s.channel })));
  if (!sameStages(stages, c.stages)) body.stages = stages;
  const changed = Object.entries(d.typeLeave).filter(([code, t]) => {
    const was = typeLeaveFor(c.typeLeave, code);
    return t.policy !== was.policy || t.unit !== was.unit;
  });
  if (changed.length) body.typeLeave = Object.fromEntries(changed);
  return body;
}

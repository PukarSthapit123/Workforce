/* Rota setup's draft: what the page edits before Save, and the PATCH body it
   sends. Numbers are kept as typed, so a half-typed value is not rewritten
   under the cursor; a value that is not a number is sent as -1, which the
   server refuses on that field with its own message. Only what changed is
   sent: per-type limits by type code (the server merges them), safe-worker
   rules by rule, and the stages as one list when any of them changed. */
import type { RotaConfigRecord, UpdateRotaConfig } from '@/api/rota';
import { SAFE_RULE_KEYS, newFulfilStage, renumberStages, typeRotaFor, type FulfilStage, type SafeRules, type TypeRota } from '@/domain/rota';

export const NUM_KEYS = ['minDefault', 'favHeadStart', 'restHours', 'maxHours', 'maxConsec'] as const;
export type NumKey = (typeof NUM_KEYS)[number];
export const TOGGLE_KEYS = ['publishBlockOnGap', 'agencyManual', 'outlook', 'bhEnhanced'] as const;
export type ToggleKey = (typeof TOGGLE_KEYS)[number];
export const TYPE_NUM_KEYS = ['maxHours', 'restHours', 'maxConsec'] as const;
export type TypeNumKey = (typeof TYPE_NUM_KEYS)[number];

export interface StageDraft { audience: string; wait: string; channel: string; next: string }
export interface TypeDraft { shifts: string[]; night: boolean; flexible: boolean; nums: Record<TypeNumKey, string> }
export interface RotaDraft {
  nums: Record<NumKey, string>; toggles: Record<ToggleKey, boolean>; horizon: number; rotaBuiltBy: string;
  safeRules: SafeRules; stages: StageDraft[]; types: Record<string, TypeDraft>;
}

const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? -1 : Number(s));
/* field by field, so the order keys were stored in, or shifts were ticked in, is not a change */
const sameType = (a: TypeRota, b: TypeRota) => a.night === b.night && a.flexible === b.flexible && TYPE_NUM_KEYS.every(k => a[k] === b[k])
  && [...a.shifts].sort().join() === [...b.shifts].sort().join();
const sameStages = (a: readonly FulfilStage[], b: readonly FulfilStage[]) => a.length === b.length
  && a.every((s, i) => { const t = b[i]; return !!t && s.audience === t.audience && s.wait === t.wait && s.channel === t.channel && s.next === t.next; });
const pick = <K extends string, V>(keys: readonly K[], fn: (k: K) => V) => Object.fromEntries(keys.map(k => [k, fn(k)])) as Record<K, V>;

const stageDraft = (s: FulfilStage): StageDraft => ({ audience: s.audience, wait: String(s.wait), channel: s.channel, next: s.next });
const typeDraft = (t: TypeRota): TypeDraft => ({ shifts: [...t.shifts], night: t.night, flexible: t.flexible, nums: pick(TYPE_NUM_KEYS, k => String(t[k])) });
const typeOf = (d: TypeDraft): TypeRota => ({ shifts: d.shifts, night: d.night, flexible: d.flexible, ...pick(TYPE_NUM_KEYS, k => num(d.nums[k])) });

/* Every employee type gets a block: one with no stored limits starts from the defaults the rules already apply to it. */
export function draftOf(c: RotaConfigRecord, typeCodes: readonly string[]): RotaDraft {
  return {
    nums: pick(NUM_KEYS, k => String(c[k])), toggles: pick(TOGGLE_KEYS, k => c[k]), horizon: c.horizon, rotaBuiltBy: c.rotaBuiltBy,
    safeRules: { ...c.safeRules }, stages: c.fulfilStages.map(stageDraft),
    types: Object.fromEntries(typeCodes.map(code => [code, typeDraft(typeRotaFor(c.types, code))])),
  };
}

export const newStageDraft = (n: number): StageDraft => stageDraft(newFulfilStage(n));

export function rotaBody(c: RotaConfigRecord, d: RotaDraft): UpdateRotaConfig {
  const body: UpdateRotaConfig = {};
  for (const k of NUM_KEYS) if (num(d.nums[k]) !== c[k]) body[k] = num(d.nums[k]);
  for (const k of TOGGLE_KEYS) if (d.toggles[k] !== c[k]) body[k] = d.toggles[k];
  if (d.horizon !== c.horizon) body.horizon = d.horizon;
  if (d.rotaBuiltBy !== c.rotaBuiltBy) body.rotaBuiltBy = d.rotaBuiltBy;
  const rules = SAFE_RULE_KEYS.filter(k => d.safeRules[k] !== c.safeRules[k]);
  if (rules.length) body.safeRules = pick(rules, k => d.safeRules[k]);
  const stages = renumberStages(d.stages.map(s => ({ n: 0, audience: s.audience, wait: num(s.wait), channel: s.channel, next: s.next })));
  if (!sameStages(stages, c.fulfilStages)) body.fulfilStages = stages;
  const types = Object.entries(d.types).filter(([code, t]) => !sameType(typeOf(t), typeRotaFor(c.types, code)));
  if (types.length) body.types = Object.fromEntries(types.map(([code, t]) => [code, typeOf(t)]));
  return body;
}

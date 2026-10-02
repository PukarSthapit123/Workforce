/* Timesheet setup (mts): the rules the screen applies to its draft before a
   save. Ported from the prototype's typeFieldRows, the data-fvis, data-fmand,
   data-allow, allow-add and rule-add handlers (qnipay-workforce-v15.html:
   8175-8198, 11143-11171, 12521-12531). The prototype wrote each change as it
   was made; here they edit a draft that one Save sends (D12). */
import type { CaptureRules, TimesheetConfig, TimesheetField, TypeCapture, UpdateTimesheetConfig } from '@/contract/timesheets';
import type { AllowanceDef, TypeRule } from '@/domain/timesheet';

type FieldMap = TypeCapture['fields'];
export interface FieldEnvLite { modules: Record<string, boolean>; flags: Record<string, boolean>; capabilities: readonly string[] }

/* A row of the capture fields table: the field, the label it shows, and the
   most a repeating group may hold ("up to 5"). */
export interface SetupFieldRow { field: TimesheetField; label: string; max?: number }
export interface SetupFieldGroup { cat: string; rows: SetupFieldRow[] }

const repeatMax = (fields: readonly TimesheetField[], repeat: string) =>
  Math.max(...fields.filter(f => f.repeat === repeat).map(f => f.seq ?? 1));
const isMovement = (c: string) => c.startsWith('movement');

/* typeFieldRows: allowances are set further down, a repeating group shows its
   first occurrence once (breaks by their start), and a field whose module,
   flag or capability is off is not offered. Grouped by category, each category
   once, in the order it first appears (the prototype started a new heading
   each time the category changed, so Project could head two groups). */
export function setupFieldGroups(fields: readonly TimesheetField[], env: FieldEnvLite, labels: Record<string, { label: string }>): SetupFieldGroup[] {
  const groups: SetupFieldGroup[] = [];
  for (const f of fields) {
    if (f.cat === 'Allowance') continue;
    if (f.repeat && (f.seq ?? 1) > 1) continue;
    if (f.repeat === 'breaks' && f.c !== 'break_s') continue;
    if (f.mod && !env.modules[f.mod]) continue;
    if (f.flag && !env.flags[f.flag]) continue;
    if (f.driverOnly && !env.capabilities.includes('vehicle')) continue;
    if (f.req && !env.capabilities.includes(f.req)) continue;
    const label = f.repeat
      ? (f.repeat === 'breaks' ? 'Breaks' : isMovement(f.c) ? 'Movement details' : 'Vehicle registration')
      : (Object.hasOwn(labels, f.c) ? labels[f.c]?.label : undefined) || f.label;
    const row: SetupFieldRow = f.repeat ? { field: f, label, max: repeatMax(fields, f.repeat) } : { field: f, label };
    const group = groups.find(g => g.cat === f.cat);
    if (group) group.rows.push(row);
    else groups.push({ cat: f.cat, rows: [row] });
  }
  return groups;
}

/* The codes a Visible switch moves together: every occurrence of a repeating
   group (vehicles split into registrations and movements), or the one field. */
function groupCodes(fields: readonly TimesheetField[], f: TimesheetField): string[] {
  if (!f.repeat) return [f.c];
  return fields.filter(x => x.repeat === f.repeat && (f.repeat !== 'vehicle' || isMovement(x.c) === isMovement(f.c))).map(x => x.c);
}
const settingOf = (map: FieldMap, c: string) => (Object.hasOwn(map, c) ? map[c] : undefined);

/* data-fvis: hiding a field also makes it optional. */
export function toggleVisible(map: FieldMap, fields: readonly TimesheetField[], f: TimesheetField): FieldMap {
  const on = !settingOf(map, f.c)?.vis;
  const next = { ...map };
  for (const c of groupCodes(fields, f)) next[c] = { vis: on, mand: on ? (settingOf(map, c)?.mand ?? false) : false };
  return next;
}
/* data-fmand: only the first occurrence of a repeating group can be mandatory. */
export function toggleMandatory(map: FieldMap, fields: readonly TimesheetField[], f: TimesheetField): FieldMap {
  const was = settingOf(map, f.c) ?? { vis: true, mand: false };
  const next: FieldMap = { ...map, [f.c]: { ...was, mand: !was.mand } };
  if (f.repeat) for (const x of fields) {
    const s = settingOf(next, x.c);
    if (x.repeat === f.repeat && x.c !== f.c && s) next[x.c] = { ...s, mand: false };
  }
  return next;
}

/* An allowance needs the capability its pack belongs to. */
const NEED: Record<string, string> = { logistics: 'vehicle', site: 'site', shift: 'shift' };
export const allowanceNeed = (tier: string): string | undefined => (Object.hasOwn(NEED, tier) ? NEED[tier] : undefined);
/* allow-add: the code is the name in capitals, 18 characters at most. */
export const allowanceCode = (name: string) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 18);
export const ALLOWANCE_EXISTS = 'An allowance with that code already exists.';
/* rule-add: a new rule matches nothing until a trigger is chosen. */
export const newRule = (): TypeRule => ({ trigger: 'New trigger', when: '', code: 'OT15', value: '1.5×', how: 'Auto (BC)' });
export const HOW_APPLIED = ['Auto (BC)', 'Auto (rota)', 'Auto (date)'] as const;
export const DEFAULT_OVERTIME = { threshold: 40, multiplier: 1.5, weekendMultiplier: 1.5 } as const;
export const emptyType = (): TypeCapture => ({ fields: {}, allowances: [], rules: [], overtime: null });

/* What the page edits: the server's config as last read, changed in place. */
export interface SetupDraft {
  rules: CaptureRules; weekGrid: TimesheetConfig['weekGrid']; weekLayout: TimesheetConfig['weekLayout'];
  allowances: Record<string, AllowanceDef>; types: Record<string, TypeCapture>;
}
export const draftOf = (c: TimesheetConfig): SetupDraft =>
  ({ rules: c.rules, weekGrid: c.weekGrid, weekLayout: c.weekLayout, allowances: c.allowances, types: c.types });

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/* The PATCH body: only what differs. Rules go as the changed keys (the server
   merges them), types as each changed type whole (merged by type code), the
   allowance library whole when any allowance changed. Empty when nothing did. */
export function setupBody(c: TimesheetConfig, d: SetupDraft): UpdateTimesheetConfig {
  const body: UpdateTimesheetConfig = {};
  const rules = Object.fromEntries(Object.entries(d.rules).filter(([k, v]) => !same(c.rules[k as keyof CaptureRules], v)));
  if (Object.keys(rules).length) body.rules = rules;
  const types = Object.fromEntries(Object.entries(d.types).filter(([k, v]) => !same(Object.hasOwn(c.types, k) ? c.types[k] : undefined, v)));
  if (Object.keys(types).length) body.types = types;
  if (!same(c.allowances, d.allowances)) body.allowances = d.allowances;
  if (d.weekGrid !== c.weekGrid) body.weekGrid = d.weekGrid;
  if (d.weekLayout !== c.weekLayout) body.weekLayout = d.weekLayout;
  return body;
}

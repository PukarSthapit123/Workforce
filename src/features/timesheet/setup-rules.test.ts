import meta from '@/mocks/seed/meta.json';
import qnipay from '@/mocks/seed/qnipay.json';
import type { TimesheetConfig, TimesheetField } from '@/contract/timesheets';
import { allowanceCode, allowanceNeed, draftOf, setupBody, setupFieldGroups, toggleMandatory, toggleVisible } from './setup';

const FIELDS = meta.timesheetFields as TimesheetField[];
const config = Object.values(qnipay.data.timesheetConfig)[0] as unknown as TimesheetConfig;
const field = (c: string) => {
  const f = FIELDS.find(x => x.c === c);
  if (!f) throw new Error(`no field ${c}`);
  return f;
};
const env = (over: Partial<{ modules: Record<string, boolean>; flags: Record<string, boolean>; capabilities: string[] }> = {}) =>
  ({ modules: { C: false }, flags: { BREAKS: true, PROJECT: true, VEHICLE: true }, capabilities: ['project'], ...over });
const codes = (e = env()) => setupFieldGroups(FIELDS, e, config.fieldDefaults).flatMap(g => g.rows.map(r => r.field.c));

test('typeFieldRows: allowances are left out, breaks show once with their limit, a repeating group only its first occurrence', () => {
  const groups = setupFieldGroups(FIELDS, env({ capabilities: ['project', 'vehicle'] }), config.fieldDefaults);
  const rows = groups.flatMap(g => g.rows);
  expect(rows.some(r => r.field.cat === 'Allowance')).toBe(false);
  expect(rows.filter(r => r.field.repeat === 'breaks')).toEqual([expect.objectContaining({ label: 'Breaks', max: 5 })]);
  expect(rows.filter(r => r.field.repeat === 'vehicle').map(r => [r.label, r.max])).toEqual([['Vehicle registration', 4], ['Movement details', 4]]);
  expect(groups.map(g => g.cat)).toEqual([...new Set(groups.map(g => g.cat))]);
});
test('typeFieldRows: a field whose module, flag or capability is off is not offered', () => {
  expect(codes()).not.toContain('site');
  expect(codes(env({ modules: { C: true }, capabilities: ['project', 'site'] }))).toContain('site');
  expect(codes(env({ flags: { BREAKS: false, PROJECT: true } }))).not.toContain('break_s');
  expect(codes(env({ capabilities: [] }))).not.toContain('project');
  expect(codes()).not.toContain('drive');
});
test('Visible moves a whole repeating group, and hiding a field makes it optional', () => {
  const on = toggleVisible({}, FIELDS, field('break_s'));
  expect(Object.keys(on).sort()).toEqual(FIELDS.filter(f => f.repeat === 'breaks').map(f => f.c).sort());
  const map = { start: { vis: true, mand: true } };
  expect(toggleVisible(map, FIELDS, field('start')).start).toEqual({ vis: false, mand: false });
  const vehicles = toggleVisible({}, FIELDS, field('vehicle'));
  expect(Object.keys(vehicles).sort()).toEqual(['vehicle', 'vehicle2', 'vehicle3', 'vehicle4']);
});
test('only the first occurrence of a repeating group can be mandatory', () => {
  const map = toggleVisible({}, FIELDS, field('break_s'));
  const withLater = { ...map, break_s2: { vis: true, mand: true } };
  const next = toggleMandatory(withLater, FIELDS, field('break_s'));
  expect(next.break_s?.mand).toBe(true);
  expect(next.break_s2?.mand).toBe(false);
});
test('the save body carries only what changed, and nothing when nothing did', () => {
  const d = draftOf(config);
  expect(setupBody(config, d)).toEqual({});
  const hourly = config.types.hourly;
  if (!hourly) throw new Error('no hourly type');
  const body = setupBody(config, { ...d, rules: { ...d.rules, maxDaily: 14 }, types: { ...d.types, hourly: { ...hourly, allowances: [] } } });
  expect(body).toEqual({ rules: { maxDaily: 14 }, types: { hourly: { ...hourly, allowances: [] } } });
});
test('a new allowance takes its code from its name; a pack allowance needs its capability', () => {
  expect(allowanceCode(' Waking night ')).toBe('WAKING_NIGHT');
  expect(allowanceCode('A very long allowance name indeed')).toHaveLength(18);
  expect(allowanceNeed('logistics')).toBe('vehicle');
  expect(allowanceNeed('core')).toBeUndefined();
});

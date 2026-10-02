import social from '@/mocks/seed/social.json';
import qnipay from '@/mocks/seed/qnipay.json';
import { DEFAULT_RULES, timesheetConfigProblem, type ConfigInput } from './timesheet';

const ctx = { employeeTypes: ['shift', 'salaried'], payCodes: ['STD', 'OT15'] };
const base = (): ConfigInput => ({
  rules: { ...DEFAULT_RULES }, cutoff: 'Monday 12:00',
  allowances: { SLEEP_IN: { code: 'SLEEP_IN', label: 'Sleep-in', payCode: 'SLEEP_IN', tier: 'care' } },
  types: { shift: { fields: {}, allowances: ['OT15', 'SLEEP_IN'], rules: [{ trigger: 'Saturday', when: 'sat', code: 'OT15', value: '1.5×', how: 'Auto (BC)' }],
    overtime: { threshold: 40, multiplier: 1.5, weekendMultiplier: 1.5 } } },
});
type Rule = ConfigInput['types'][string]['rules'][number];
function withRule(c: ConfigInput, rule: Rule) { const t = c.types.shift; if (t) c.types.shift = { ...t, rules: [rule] }; }
const field = (c: ConfigInput) => timesheetConfigProblem(c, ctx)?.field;

test('both seeds\' configs pass the setup checks', () => {
  for (const s of [social, qnipay]) {
    const d = s.data as unknown as { timesheetConfig: { timesheetConfig: ConfigInput }; employeeTypes: Record<string, { code: string }>; payCodes: Record<string, { code: string }> };
    expect(timesheetConfigProblem(d.timesheetConfig.timesheetConfig, {
      employeeTypes: Object.values(d.employeeTypes).map(t => t.code), payCodes: Object.values(d.payCodes).map(p => p.code),
    })).toBeNull();
  }
});
test('a sound config has no problem', () => expect(timesheetConfigProblem(base(), ctx)).toBeNull());

const cases: [string, (c: ConfigInput) => void, string, string][] = [
  ['daily maximum above 24', c => { c.rules.maxDaily = 25; }, 'rules.maxDaily', 'The daily maximum must be more than 0 and at most 24 hours.'],
  ['review threshold above the maximum', c => { c.rules.warnDaily = 17; }, 'rules.warnDaily', 'The review threshold must be more than 0 and no higher than the daily maximum.'],
  ['minimum net at the maximum', c => { c.rules.minNet = 16; }, 'rules.minNet', 'The minimum net time must be 0 or more and below the daily maximum.'],
  ['negative variance', c => { c.rules.varianceWarn = -1; }, 'rules.varianceWarn', 'The rota variance must be 0 or more hours.'],
  ['daily overtime of 0', c => { c.rules.otDaily = 0; }, 'rules.otDaily', 'The daily overtime threshold must be more than 0 and at most 24 hours.'],
  ['weekly overtime above a week', c => { c.rules.otWeekly = 169; }, 'rules.otWeekly', 'The weekly overtime threshold must be more than 0 and at most 168 hours.'],
  ['night window start', c => { c.rules.nightFrom = '25:00'; }, 'rules.nightFrom', 'The night window must start at a 24-hour time such as 20:00.'],
  ['night window end', c => { c.rules.nightTo = 'six'; }, 'rules.nightTo', 'The night window must end at a 24-hour time such as 06:00.'],
  ['a Friday cut-off', c => { c.cutoff = 'Friday 12:00'; }, 'cutoff', 'The cut-off must be a day from Sunday to Thursday and a 24-hour time, such as Monday 12:00.'],
  ['an allowance under the wrong key', c => { c.allowances.X = { code: 'Y', label: 'Y', payCode: 'Y', tier: 'core' }; }, 'allowances.X.code', 'The allowance stored as X must have the code X.'],
  ['an allowance with no label', c => { c.allowances.X = { code: 'X', label: ' ', payCode: 'X', tier: 'core' }; }, 'allowances.X.label', 'Give the allowance a label.'],
  ['an allowance label carrying an amount', c => { c.allowances.X = { code: 'X', label: 'Sleep-in £30', payCode: 'X', tier: 'core' }; }, 'allowances.X.label',
    'An allowance label names the allowance, never an amount. Business Central holds the rates.'],
  ['an unknown employee type', c => { c.types.agency = { fields: {}, allowances: [], rules: [], overtime: null }; }, 'types.agency', 'There is no employee type with the code agency.'],
  ['a type allowance that does not exist', c => { const t = c.types.shift; if (t) c.types.shift = { ...t, allowances: ['NOPE'] }; }, 'types.shift.allowances', 'NOPE is neither an allowance nor a pay code.'],
  ['a rule trigger the engine does not know', c => { withRule(c, { trigger: 'Full moon', when: 'moon', code: 'OT15', value: '2×', how: 'Auto (BC)' }); }, 'types.shift.rules.0.when', 'Choose a trigger from the list.'],
  ['a rule pay code that does not exist', c => { withRule(c, { trigger: 'Saturday', when: 'sat', code: 'OT99', value: '2×', how: 'Auto (BC)' }); }, 'types.shift.rules.0.code', 'OT99 is not a pay code.'],
  ['a rule value that is an amount (D11)', c => { withRule(c, { trigger: 'Saturday', when: 'sat', code: 'OT15', value: '£12', how: 'Auto (BC)' }); }, 'types.shift.rules.0.value',
    'A rule value is a multiplier or a threshold, never an amount. Business Central holds the rates.'],
  ['an overtime threshold of 0', c => { const t = c.types.shift; if (t) c.types.shift = { ...t, overtime: { threshold: 0, multiplier: 1.5, weekendMultiplier: 1.5 } }; }, 'types.shift.overtime.threshold', 'The overtime threshold must be more than 0 and at most 168 hours.'],
  ['an overtime multiplier below 1', c => { const t = c.types.shift; if (t) c.types.shift = { ...t, overtime: { threshold: 40, multiplier: 0.5, weekendMultiplier: 1.5 } }; }, 'types.shift.overtime.multiplier', 'An overtime multiplier must be at least 1.'],
];
for (const [what, change, expectedField, message] of cases) {
  test(`refuses ${what}`, () => {
    const c = base();
    change(c);
    expect(field(c)).toBe(expectedField);
    expect(timesheetConfigProblem(c, ctx)?.message).toBe(message);
  });
}
test('a rule with no trigger yet is allowed, as the seed has one', () => {
  const c = base();
  withRule(c, { trigger: 'New trigger', when: '', code: 'OT15', value: '1.5×', how: 'Auto (BC)' });
  expect(timesheetConfigProblem(c, ctx)).toBeNull();
});

import {
  claimedBy, normalisePayCode, payCodeChanges, payCodeInUse, payCodeOf, payCodeProblem, payCodeUsage, type PayCodeInput, type PayUsageWorld,
} from './pay-codes';

const STD: PayCodeInput = { code: 'STD', label: 'Standard time', basis: 'multiplier', value: '1', element: 'PE-STD', workType: true };
const ABS: PayCodeInput = { code: 'ABS', label: 'Absence', basis: 'units', value: '', element: 'PE-ABS', workType: false };
const world = { codes: [STD, ABS], allowances: ['SLEEP_IN'] };
const make = (patch: Partial<PayCodeInput>): PayCodeInput =>
  ({ code: 'OT-BH', label: 'Overtime bank holiday', basis: 'multiplier', value: '2', element: 'PE-OTBH', workType: true, ...patch });
const message = (input: PayCodeInput, editing?: string) => payCodeProblem(input, world, editing)?.message;

describe('the refusals, in the prototype\'s order', () => {
  test('a code is required, and its format is checked', () => {
    expect(payCodeProblem(make({ code: ' ' }), world)).toEqual({ field: 'code', message: 'A code is required.' });
    for (const bad of ['x', '1AB', 'TOO-LONG-CODE-1', 'OT£'])
      expect(payCodeProblem(make({ code: bad }), world)?.field).toBe('code');
    expect(message(make({ code: 'x' }))).toMatch(/2 to 12 characters/);
  });
  test('a code is upper-cased and its spaces become dashes', () => {
    expect(normalisePayCode(' ot bh ')).toBe('OT-BH');
    expect(payCodeProblem(make({ code: 'ot bh' }), world)).toBeNull();
  });
  test('a name and an element are required', () => {
    expect(payCodeProblem(make({ label: '' }), world)?.field).toBe('label');
    expect(message(make({ element: '' }))).toBe('A Business Central pay element is required. One code maps to one element.');
    expect(payCodeProblem(make({ element: 'PE OT' }), world)?.field).toBe('element');
  });
  test('a duplicate is refused, against the base codes and the allowance codes, before a missing value', () => {
    expect(message(make({ code: 'std', value: '' }))).toBe('STD already exists. Codes must be unique because Business Central matches on them.');
    expect(payCodeProblem(make({ code: 'SLEEP_IN' }), world)?.field).toBe('code');
  });
  test('an element already mapped to another code is refused, but a code keeps its own', () => {
    expect(message(make({ element: 'pe-std' }))).toBe('PE-STD is already mapped to STD. One element, one code.');
    expect(payCodeProblem({ ...STD, label: 'Standard' }, world, 'STD')).toBeNull();
  });
  test('a multiplier, hours or days code needs a positive value; a flat or units code has none (no money)', () => {
    expect(message(make({ value: '' }))).toBe('A value is required for a multiplier on base rate.');
    expect(message(make({ basis: 'days', value: '' }))).toBe('A value is required for a number of day units.');
    expect(payCodeProblem(make({ value: '0' }), world)?.field).toBe('value');
    expect(payCodeProblem(make({ value: '£21' }), world)?.field).toBe('value');
    expect(payCodeProblem(make({ basis: 'hours', value: '7.5' }), world)).toBeNull();
    expect(message(make({ basis: 'flat', value: '21' }))).toBe('A flat code has no value here. The amount is set in Business Central.');
    expect(message(make({ basis: 'units', value: '1' }))).toBe('A units code posts as a marker, so it has no value.');
    expect(payCodeProblem(make({ basis: 'flat', value: '' }), world)).toBeNull();
  });
  test('an edit is checked against its stored code, so the code check is skipped', () => {
    expect(payCodeProblem({ ...STD, value: '' }, world, 'STD')?.field).toBe('value');
  });
});

test('payCodeOf stores the code and element in capitals and trims the rest', () => {
  expect(payCodeOf(make({ code: 'ot bh', element: ' pe-otbh ', label: ' Bank holiday ', value: ' 2 ' })))
    .toEqual({ code: 'OT-BH', label: 'Bank holiday', basis: 'multiplier', value: '2', element: 'PE-OTBH', workType: true });
});
test('an edit names the fields it changes, in order', () => {
  expect(payCodeChanges(STD, { ...STD, value: '2.5', workType: false })).toEqual(['value', 'workType']);
  expect(payCodeChanges(STD, { ...STD })).toEqual([]);
});

describe('who claims a code and what uses it', () => {
  const w: PayUsageWorld = {
    types: [
      { code: 'shift', name: 'Support Worker', uom: 'hour', allowances: ['OT15'], ruleCodes: ['UNSOC'] },
      { code: 'salaried', name: 'Service Manager', uom: 'day', allowances: [], ruleCodes: ['ABS'] },
    ],
    fields: [{ label: 'Overtime', pay: 'OT15' }, { label: 'Notes' }],
    dayWorkTypes: ['STD', 'STD', 'OT15'],
  };
  test('Standard time and the day rate are claimed by the hourly and daily types; any other code by the types naming it', () => {
    expect(claimedBy('STD', w).map(t => t.code)).toEqual(['shift']);
    expect(claimedBy('DAY_RATE', w).map(t => t.code)).toEqual(['salaried']);
    expect(claimedBy('UNSOC', w).map(t => t.code)).toEqual(['shift']);
    expect(claimedBy('OT20', w)).toEqual([]);
  });
  test('usage counts the types, the capture fields and the timesheet days, and the refusal names them', () => {
    const u = payCodeUsage('OT15', w);
    expect(u).toEqual([
      { kind: 'employee-types', count: 1, examples: ['Support Worker'] },
      { kind: 'fields', count: 1, examples: ['Overtime'] },
      { kind: 'timesheet-days', count: 1, examples: [] },
    ]);
    expect(payCodeInUse('OT15', u)).toEqual({
      message: 'OT15 is used by 1 employee type, 1 capture field and 1 timesheet day.',
      next: 'Remove those references first. A rule pointing at a code that no longer exists would post nothing.',
    });
    expect(payCodeInUse('STD', payCodeUsage('STD', w)).message).toBe('STD is used by 1 employee type and 2 timesheet days.');
    expect(payCodeUsage('OT20', w)).toEqual([]);
  });
});

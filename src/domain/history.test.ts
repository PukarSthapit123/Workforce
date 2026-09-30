import { diffFields, fieldLabel, historyValue } from './history';

test('a diff lists only the fields that changed, before → after', () => {
  expect(diffFields({ contractedHours: 30, name: 'A', night: true }, { contractedHours: 37.5, name: 'A', night: false },
    ['contractedHours', 'name', 'night'])).toEqual([
    { field: 'contractedHours', from: '30', to: '37.5' },
    { field: 'night', from: 'yes', to: 'no' },
  ]);
});
test('keys outside the list are ignored', () => {
  expect(diffFields({ version: 1 }, { version: 2 }, ['name'])).toEqual([]);
});
test('values read the way the audit shows them', () => {
  expect(historyValue('')).toBe('');
  expect(historyValue(null)).toBe('');
  expect(historyValue(undefined)).toBe('');
  expect(historyValue(false)).toBe('no');
  expect(historyValue(['site', 'project'])).toBe('site, project');
  expect(historyValue(40)).toBe('40');
});
test('fields have plain labels, and an unknown one reads as itself', () => {
  expect(fieldLabel('contractedHours')).toBe('Contracted hours');
  expect(fieldLabel('state')).toBe('State');
  expect(fieldLabel('somethingNew')).toBe('somethingNew');
});

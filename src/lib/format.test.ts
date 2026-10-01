import { formatDate, formatDateTime, describeChange, todayIso } from './format';
test('British date and time in London time', () => {
  expect(formatDateTime('2026-08-13T13:30:00.000Z')).toBe('13/08/2026 14:30');
});
test('a change reads before -> after, field by field', () => {
  expect(describeChange({ proxy: false }, { proxy: true })).toBe('proxy: no → yes');
  expect(describeChange({ grants: [] }, { grants: ['proxy'] })).toBe('grants: none → proxy');
  expect(describeChange(null, { viewingAs: 'CP-1042' })).toBe('viewingAs: none → CP-1042');
});
test('an ISO date reads the British way, and a missing one reads as a dash', () => {
  expect(formatDate('2026-08-13')).toBe('13/08/2026');
  expect(formatDate('')).toBe('—');
});
test('today is the London date, even when UTC has not reached it yet', () => {
  expect(todayIso(new Date('2026-08-13T23:30:00.000Z'))).toBe('2026-08-14');
  expect(todayIso(new Date('2026-01-13T23:30:00.000Z'))).toBe('2026-01-13');
});

import { SELF_FIELDS, afterDecision, maskBank, routeFor, selfField, STAGE_CAPABILITY } from './selfService';

test('the six self-service fields are the prototype\'s, and only bank details are sensitive', () => {
  expect(SELF_FIELDS.map(f => f.key)).toEqual(['phone', 'address', 'emergencyName', 'emergencyPhone', 'bankAccount', 'bankSortCode']);
  expect(SELF_FIELDS.filter(f => f.sensitive).map(f => f.key)).toEqual(['bankAccount', 'bankSortCode']);
  expect(selfField('phone').label).toBe('Mobile number');
});
test('contact and emergency changes go to the line manager; bank changes go to payroll as well', () => {
  expect(routeFor('phone')).toEqual(['manager']);
  expect(routeFor('emergencyName')).toEqual(['manager']);
  expect(routeFor('bankAccount')).toEqual(['manager', 'payroll']);
  expect(routeFor('bankSortCode')).toEqual(['manager', 'payroll']);
});
test('approval moves along the route and finishes only at its end', () => {
  expect(afterDecision({ stage: 'manager', route: ['manager'] }, 'approve')).toEqual({ status: 'approved', stage: 'done' });
  expect(afterDecision({ stage: 'manager', route: ['manager', 'payroll'] }, 'approve')).toEqual({ status: 'pending', stage: 'payroll' });
  expect(afterDecision({ stage: 'payroll', route: ['manager', 'payroll'] }, 'approve')).toEqual({ status: 'approved', stage: 'done' });
});
test('a decline at any stage ends it', () => {
  expect(afterDecision({ stage: 'manager', route: ['manager', 'payroll'] }, 'decline')).toEqual({ status: 'declined', stage: 'done' });
  expect(afterDecision({ stage: 'payroll', route: ['manager', 'payroll'] }, 'decline')).toEqual({ status: 'declined', stage: 'done' });
});
test('a decided change cannot be decided again', () => {
  expect(() => afterDecision({ stage: 'done', route: ['manager'] }, 'approve')).toThrow('already decided');
});
test('each stage has its capability', () => {
  expect(STAGE_CAPABILITY).toEqual({ manager: 'profile_appr', payroll: 'bank_verify' });
});
test('a bank account shows only its last four characters', () => {
  expect(maskBank('12345678')).toBe('****5678');
  expect(maskBank('****8715')).toBe('****8715');
  expect(maskBank('')).toBe('');
  expect(maskBank('12')).toBe('****12');
});

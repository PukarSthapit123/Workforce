import { newEmployeeProblem, employeeEditProblem, type EmployeeContext, type EmployeeDraft } from './employees';

const ctx: EmployeeContext = {
  employees: [
    { code: 'CP-1042', name: 'Amara Okafor', email: 'amara.okafor@brightpath.org' },
    { code: 'EMP014', name: 'Manish Nepal', email: 'manish.nepal@dogmagroup.co.uk' },
    { code: 'EMP015', name: 'Prashesh', email: 'manish.nepal@dogmagroup.co.uk' },
  ],
  locations: ['WH', 'BC'], departments: ['CARE'], jobProfiles: ['SW'], employeeTypes: ['shift', 'casual'],
};
const draft = (over: Partial<EmployeeDraft> = {}): EmployeeDraft => ({
  code: 'CP-9001', name: 'Test Employee', email: 'test.employee@brightpath.org', contractedHours: 30, maxHours: 45,
  location: 'WH', employeeType: 'shift', department: 'CARE', jobProfile: 'SW', ...over });

describe('newEmployeeProblem, in the prototype\'s order', () => {
  test('a valid draft passes', () => { expect(newEmployeeProblem(draft(), ctx)).toBeNull(); });
  test('a name is required', () => {
    expect(newEmployeeProblem(draft({ name: '  ' }), ctx)).toEqual({ field: 'name', message: 'A full name is required.' });
  });
  test('CR The employee ID format is checked, with an example from this roster', () => {
    expect(newEmployeeProblem(draft({ code: 'no spaces' }), ctx)?.message).toMatch(/employee ID is letters.*like CP-1042/);
  });
  test('a duplicate employee ID is refused', () => {
    expect(newEmployeeProblem(draft({ code: 'CP-1042' }), ctx)?.message).toMatch(/already in use/);
  });
  test('a work email is required, because it is how they sign in', () => {
    expect(newEmployeeProblem(draft({ email: '' }), ctx)).toEqual({ field: 'email', message: 'A work email address is required. It is how they sign in.' });
  });
  test('an email must look like one', () => {
    expect(newEmployeeProblem(draft({ email: 'not-an-email' }), ctx)?.message).toBe('That does not look like an email address.');
  });
  test('one address, one account', () => {
    expect(newEmployeeProblem(draft({ email: 'Amara.Okafor@brightpath.org' }), ctx)?.message)
      .toBe('amara.okafor@brightpath.org is already used by Amara Okafor. One address, one account.');
  });
  test('contracted hours are bounded', () => {
    expect(newEmployeeProblem(draft({ contractedHours: 90 }), ctx)).toEqual({ field: 'contractedHours', message: 'Contracted hours must be between 0 and 80.' });
    expect(newEmployeeProblem(draft({ contractedHours: Number.NaN }), ctx)?.field).toBe('contractedHours');
  });
  test('contracted hours cannot exceed the maximum', () => {
    expect(newEmployeeProblem(draft({ contractedHours: 50, maxHours: 40 }), ctx)).toEqual({ field: 'contractedHours', message: 'Contracted hours cannot exceed the maximum.' });
  });
  test('a zero maximum is "no maximum", as in the prototype', () => {
    expect(newEmployeeProblem(draft({ contractedHours: 30, maxHours: 0 }), ctx)).toBeNull();
  });
  test('a location and an employee type are required and must exist', () => {
    expect(newEmployeeProblem(draft({ location: '' }), ctx)).toEqual({ field: 'location', message: 'A location is required.' });
    expect(newEmployeeProblem(draft({ location: 'ZZ' }), ctx)).toEqual({ field: 'location', message: 'There is no location with the code ZZ.' });
    expect(newEmployeeProblem(draft({ employeeType: '' }), ctx)).toEqual({ field: 'employeeType', message: 'An employee type is required.' });
    expect(newEmployeeProblem(draft({ employeeType: 'robot' }), ctx)?.field).toBe('employeeType');
  });
  test('an optional department or job profile must exist when given', () => {
    expect(newEmployeeProblem(draft({ department: '' }), ctx)).toBeNull();
    expect(newEmployeeProblem(draft({ department: 'OPS' }), ctx)).toEqual({ field: 'department', message: 'There is no department with the code OPS.' });
    expect(newEmployeeProblem(draft({ jobProfile: 'XX' }), ctx)?.field).toBe('jobProfile');
  });
});

describe('employeeEditProblem', () => {
  const emp015: EmployeeDraft = draft({ code: 'EMP015', name: 'Prashesh', email: 'manish.nepal@dogmagroup.co.uk', contractedHours: 40, maxHours: 48 });
  test('editing hours on a record whose seed email is shared does not trip the email rule', () => {
    expect(employeeEditProblem(emp015, { contractedHours: 30 }, ctx)).toBeNull();
  });
  test('an unchanged email, even in the patch, is not re-checked', () => {
    expect(employeeEditProblem(emp015, { email: 'Manish.Nepal@dogmagroup.co.uk' }, ctx)).toBeNull();
  });
  test('a changed email is checked for clashes, ignoring the employee themself', () => {
    expect(employeeEditProblem(emp015, { email: 'amara.okafor@brightpath.org' }, ctx)?.message).toMatch(/already used by Amara Okafor/);
    const amara = draft({ code: 'CP-1042', email: 'amara.okafor@brightpath.org' });
    expect(employeeEditProblem(amara, { email: 'amara.okafor+x@brightpath.org' }, ctx)).toBeNull();
  });
  test('a record with no email can be edited without adding one', () => {
    expect(employeeEditProblem(draft({ email: '' }), { maxHours: 40 }, ctx)).toBeNull();
  });
  test('the hours rule reads the merged record', () => {
    expect(employeeEditProblem(draft({ contractedHours: 30, maxHours: 45 }), { maxHours: 20 }, ctx)?.message).toBe('Contracted hours cannot exceed the maximum.');
  });
  test('a name cannot be blanked, and a location cannot be removed', () => {
    expect(employeeEditProblem(draft(), { name: '' }, ctx)?.field).toBe('name');
    expect(employeeEditProblem(draft(), { location: '' }, ctx)?.field).toBe('location');
    expect(employeeEditProblem(draft(), { location: 'ZZ' }, ctx)?.field).toBe('location');
  });
});

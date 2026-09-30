import { newPersonProblem, personEditProblem, type PersonContext, type PersonDraft } from './people';

const ctx: PersonContext = {
  people: [
    { code: 'CP-1042', name: 'Amara Okafor', email: 'amara.okafor@brightpath.org' },
    { code: 'EMP014', name: 'Manish Nepal', email: 'manish.nepal@dogmagroup.co.uk' },
    { code: 'EMP015', name: 'Prashesh', email: 'manish.nepal@dogmagroup.co.uk' },
  ],
  locations: ['WH', 'BC'], departments: ['CARE'], jobProfiles: ['SW'], employeeTypes: ['shift', 'casual'],
};
const draft = (over: Partial<PersonDraft> = {}): PersonDraft => ({
  code: 'CP-9001', name: 'Test Person', email: 'test.person@brightpath.org', contractedHours: 30, maxHours: 45,
  location: 'WH', employeeType: 'shift', department: 'CARE', jobProfile: 'SW', ...over });

describe('newPersonProblem, in the prototype\'s order', () => {
  test('a valid draft passes', () => { expect(newPersonProblem(draft(), ctx)).toBeNull(); });
  test('a name is required', () => {
    expect(newPersonProblem(draft({ name: '  ' }), ctx)).toEqual({ field: 'name', message: 'A full name is required.' });
  });
  test('CR The employee ID format is checked, with an example from this roster', () => {
    expect(newPersonProblem(draft({ code: 'no spaces' }), ctx)?.message).toMatch(/employee ID is letters.*like CP-1042/);
  });
  test('a duplicate employee ID is refused', () => {
    expect(newPersonProblem(draft({ code: 'CP-1042' }), ctx)?.message).toMatch(/already in use/);
  });
  test('a work email is required, because it is how they sign in', () => {
    expect(newPersonProblem(draft({ email: '' }), ctx)).toEqual({ field: 'email', message: 'A work email address is required. It is how they sign in.' });
  });
  test('an email must look like one', () => {
    expect(newPersonProblem(draft({ email: 'not-an-email' }), ctx)?.message).toBe('That does not look like an email address.');
  });
  test('one address, one account', () => {
    expect(newPersonProblem(draft({ email: 'Amara.Okafor@brightpath.org' }), ctx)?.message)
      .toBe('amara.okafor@brightpath.org is already used by Amara Okafor. One address, one account.');
  });
  test('contracted hours are bounded', () => {
    expect(newPersonProblem(draft({ contractedHours: 90 }), ctx)).toEqual({ field: 'contractedHours', message: 'Contracted hours must be between 0 and 80.' });
    expect(newPersonProblem(draft({ contractedHours: Number.NaN }), ctx)?.field).toBe('contractedHours');
  });
  test('contracted hours cannot exceed the maximum', () => {
    expect(newPersonProblem(draft({ contractedHours: 50, maxHours: 40 }), ctx)).toEqual({ field: 'contractedHours', message: 'Contracted hours cannot exceed the maximum.' });
  });
  test('a zero maximum is "no maximum", as in the prototype', () => {
    expect(newPersonProblem(draft({ contractedHours: 30, maxHours: 0 }), ctx)).toBeNull();
  });
  test('a location and an employee type are required and must exist', () => {
    expect(newPersonProblem(draft({ location: '' }), ctx)).toEqual({ field: 'location', message: 'A location is required.' });
    expect(newPersonProblem(draft({ location: 'ZZ' }), ctx)).toEqual({ field: 'location', message: 'There is no location with the code ZZ.' });
    expect(newPersonProblem(draft({ employeeType: '' }), ctx)).toEqual({ field: 'employeeType', message: 'An employee type is required.' });
    expect(newPersonProblem(draft({ employeeType: 'robot' }), ctx)?.field).toBe('employeeType');
  });
  test('an optional department or job profile must exist when given', () => {
    expect(newPersonProblem(draft({ department: '' }), ctx)).toBeNull();
    expect(newPersonProblem(draft({ department: 'OPS' }), ctx)).toEqual({ field: 'department', message: 'There is no department with the code OPS.' });
    expect(newPersonProblem(draft({ jobProfile: 'XX' }), ctx)?.field).toBe('jobProfile');
  });
});

describe('personEditProblem', () => {
  const emp015: PersonDraft = draft({ code: 'EMP015', name: 'Prashesh', email: 'manish.nepal@dogmagroup.co.uk', contractedHours: 40, maxHours: 48 });
  test('editing hours on a record whose seed email is shared does not trip the email rule', () => {
    expect(personEditProblem(emp015, { contractedHours: 30 }, ctx)).toBeNull();
  });
  test('an unchanged email, even in the patch, is not re-checked', () => {
    expect(personEditProblem(emp015, { email: 'Manish.Nepal@dogmagroup.co.uk' }, ctx)).toBeNull();
  });
  test('a changed email is checked for clashes, ignoring the person themself', () => {
    expect(personEditProblem(emp015, { email: 'amara.okafor@brightpath.org' }, ctx)?.message).toMatch(/already used by Amara Okafor/);
    const amara = draft({ code: 'CP-1042', email: 'amara.okafor@brightpath.org' });
    expect(personEditProblem(amara, { email: 'amara.okafor+x@brightpath.org' }, ctx)).toBeNull();
  });
  test('a record with no email can be edited without adding one', () => {
    expect(personEditProblem(draft({ email: '' }), { maxHours: 40 }, ctx)).toBeNull();
  });
  test('the hours rule reads the merged record', () => {
    expect(personEditProblem(draft({ contractedHours: 30, maxHours: 45 }), { maxHours: 20 }, ctx)?.message).toBe('Contracted hours cannot exceed the maximum.');
  });
  test('a name cannot be blanked, and a location cannot be removed', () => {
    expect(personEditProblem(draft(), { name: '' }, ctx)?.field).toBe('name');
    expect(personEditProblem(draft(), { location: '' }, ctx)?.field).toBe('location');
    expect(personEditProblem(draft(), { location: 'ZZ' }, ctx)?.field).toBe('location');
  });
});

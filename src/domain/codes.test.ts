import {
  codeChangeProblem, dimensionCodeProblem, employeeCodeProblem, nextEmployeeCode, normaliseCode, typeCodeProblem,
} from './codes';

describe('nextEmployeeCode follows the scheme the tenant already uses', () => {
  test('a mixed roster carries on from its highest number, in that number\'s scheme', () => {
    expect(nextEmployeeCode(['CP-1042', 'CP-1502', 'EMP-2088', 'EMP-2044'])).toBe('EMP-2089');
  });
  test('a zero-padded roster keeps its width', () => {
    expect(nextEmployeeCode(Array.from({ length: 20 }, (_, i) => `EMP${String(i + 1).padStart(3, '0')}`))).toBe('EMP021');
  });
  test('an empty roster starts at EMP001', () => {
    expect(nextEmployeeCode([])).toBe('EMP001');
  });
  test('codes without a number are ignored', () => {
    expect(nextEmployeeCode(['ALPHA', 'BETA'])).toBe('EMP001');
  });
  test('the width comes from the highest code, and a taken code is skipped', () => {
    expect(nextEmployeeCode(['EMP010', 'EMP11', 'EMP12'])).toBe('EMP13');
    expect(nextEmployeeCode(['A9', 'A10', 'a11'])).toBe('A12');
  });
});

describe('employeeCodeProblem', () => {
  const roster = ['CP-1042', 'CP-1088'];
  test('the format is checked, with an example from this roster', () => {
    expect(employeeCodeProblem('no spaces allowed here', roster, 'CP-1042')).toEqual({
      field: 'code', message: 'An employee ID is letters, digits, a dash or an underscore, like CP-1042.' });
    expect(employeeCodeProblem('', roster, 'CP-1042')?.field).toBe('code');
  });
  test('a duplicate is refused, whatever its case, because payroll maps on it', () => {
    expect(employeeCodeProblem('cp-1042', roster, 'CP-1042')).toEqual({
      field: 'code', message: 'CP-1042 is already in use. Employee IDs must be unique because payroll maps on them.' });
  });
  test('a free, well-formed code passes', () => {
    expect(employeeCodeProblem('CP-9001', roster, 'CP-1042')).toBeNull();
    expect(employeeCodeProblem('emp_021', roster, 'CP-1042')).toBeNull();
  });
});

describe('dimensionCodeProblem', () => {
  test('a code is required', () => {
    expect(dimensionCodeProblem('  ', ['WH'])).toEqual({ field: 'code', message: 'Code is required.' });
  });
  test('a duplicate is refused, because rota lines and timesheets reference it', () => {
    expect(dimensionCodeProblem('wh', ['WH'])).toEqual({
      field: 'code', message: 'WH already exists. Codes must be unique because rota lines and timesheets reference them.' });
  });
  test('spaces are refused', () => {
    expect(dimensionCodeProblem('TEST QUAY', [])?.message).toBe('A code is letters, digits, a dash, a dot or an underscore, with no spaces.');
  });
  test('the prototype\'s own codes pass', () => {
    for (const c of ['WH', 'WH-CAM-01', 'CC-100', 'JOB00030', 'LEAVE', 'PRJ-114', 'SCONS'])
      expect(dimensionCodeProblem(c, []), c).toBeNull();
  });
});

describe('typeCodeProblem', () => {
  test('a type code is a lower-case slug', () => {
    expect(typeCodeProblem('Waking Night', [])).toEqual({
      field: 'code', message: 'A type code is lower-case letters, digits and underscores, like waking_night.' });
    expect(typeCodeProblem('waking_night', [])).toBeNull();
  });
  test('a duplicate type code is refused', () => {
    expect(typeCodeProblem('shift', ['shift', 'casual'])?.message).toBe('shift already exists. People reference a type by its code.');
  });
});

describe('codeChangeProblem: codes are immutable once they exist', () => {
  test('a different code in the patch is refused', () => {
    expect(codeChangeProblem('code', 'Employee ID', 'CP-1042', { code: 'CP-9999' })).toEqual({
      field: 'code', message: 'Employee ID cannot change once it exists. Existing records reference it.' });
  });
  test('the same code, or no code, is not a change', () => {
    expect(codeChangeProblem('code', 'Employee ID', 'CP-1042', { code: 'cp-1042' })).toBeNull();
    expect(codeChangeProblem('code', 'Employee ID', 'CP-1042', { name: 'x' })).toBeNull();
  });
});

test('normaliseCode trims and upper-cases', () => {
  expect(normaliseCode('  cp-9001 ')).toBe('CP-9001');
});

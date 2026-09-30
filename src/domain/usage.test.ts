import { inUseRefusal, totalUses, usageOf, type UsageWorld } from './usage';

const world: UsageWorld = {
  people: [
    { code: 'CP-1042', name: 'Amara Okafor', location: 'WH', department: 'CARE', jobProfile: 'SW', employeeType: 'shift' },
    { code: 'CP-1088', name: 'Marcus Reilly', location: 'WH', department: 'CARE', jobProfile: 'SW', employeeType: 'shift' },
    { code: 'CP-1153', name: 'Jo Baptiste', location: 'WH', department: 'CARE', jobProfile: 'SSW', employeeType: 'shift' },
    { code: 'CP-1201', name: 'Priya Shah', location: 'WH', department: 'CARE', jobProfile: 'SW', employeeType: 'casual' },
    { code: 'CP-1288', name: 'Grace Whitmore', location: 'BC', department: 'CARE', jobProfile: 'SW', employeeType: 'shift' },
  ],
  locations: [
    { code: 'WH', name: 'Willow House', department: 'CARE', costCentre: 'WH-CAM-01' },
    { code: 'BC', name: 'Beacon Court', department: 'CARE', costCentre: 'BC-ISL-02' },
  ],
  projects: [{ code: 'PRJ-204', name: 'Camden Supported Living', costCentre: 'WH-CAM-01', location: 'WH' }],
};

test('a location in use names the people and projects that use it, with at most three examples', () => {
  expect(usageOf('locations', 'WH', world)).toEqual([
    { kind: 'people', count: 4, examples: ['Amara Okafor (CP-1042)', 'Marcus Reilly (CP-1088)', 'Jo Baptiste (CP-1153)'] },
    { kind: 'projects', count: 1, examples: ['Camden Supported Living (PRJ-204)'] },
  ]);
});
test('a department is used by locations and people', () => {
  expect(usageOf('departments', 'CARE', world).map(u => [u.kind, u.count])).toEqual([['locations', 2], ['people', 5]]);
});
test('a cost centre is used by locations and projects', () => {
  expect(usageOf('cost-centres', 'WH-CAM-01', world).map(u => [u.kind, u.count])).toEqual([['locations', 1], ['projects', 1]]);
});
test('a job profile and an employee type are used by people', () => {
  expect(usageOf('job-profiles', 'SSW', world)).toEqual([{ kind: 'people', count: 1, examples: ['Jo Baptiste (CP-1153)'] }]);
  expect(usageOf('employee-types', 'casual', world)).toEqual([{ kind: 'people', count: 1, examples: ['Priya Shah (CP-1201)'] }]);
});
test('a leaver still counts, because the record keeps its references', () => {
  expect(totalUses(usageOf('locations', 'BC', world))).toBe(1);
});
test('an unused entry has no users', () => {
  expect(usageOf('locations', 'TQ', world)).toEqual([]);
  expect(usageOf('projects', 'PRJ-204', world)).toEqual([]);
});
test('the refusal names what uses it and what to do', () => {
  expect(inUseRefusal('WH', usageOf('locations', 'WH', world))).toEqual({
    message: 'WH is used by 4 people and 1 project.',
    next: 'Move those first. Removing it would leave them pointing at nothing.' });
  expect(inUseRefusal('SSW', usageOf('job-profiles', 'SSW', world)).message).toBe('SSW is used by 1 person.');
  expect(inUseRefusal('CARE', usageOf('departments', 'CARE', world)).message).toBe('CARE is used by 2 locations and 5 people.');
});

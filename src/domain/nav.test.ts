import { buildNav, type NavGroup } from './nav';

const ALL_MODULES = { A: true, B: true, TS: true, R: true, L: true, ON: true, CORE: true };
const flags = { DOCS: true, NOTICES: true, FULFIL: true };
const caps = (...c: string[]) => new Set(c);

/* Array indexing and Array#find both return T | undefined here
   (noUncheckedIndexedAccess), so a missing entry fails loudly with a clear
   message instead of a bare non-null assertion. */
function must<T>(v: T | undefined, msg = 'expected a value, got undefined'): T {
  if (v === undefined) throw new Error(msg);
  return v;
}

test('an employee gets My Work only, in prototype order', () => {
  const g = buildNav({ caps: caps('own_home', 'own_ts', 'own_shifts', 'own_leave', 'own_hours', 'own_notices'), modules: ALL_MODULES, flags, onboarding: false });
  expect(g.map(x => x.key)).toEqual(['work']);
  expect(must(g[0]).tabs.map(t => t.label)).toEqual(['Home', 'Timesheet', 'Shifts', 'Leave', 'Hours', 'Profile', 'Documents', 'Notices']);
});
test('a manager also gets My Team, with Team Home and Approvals in the strip and the rest under headings', () => {
  const g = buildNav({ caps: caps('own_home', 'team_ts', 'team_rota', 'team_cover', 'team_leave', 'team_sick', 'team_hours', 'team_people', 'onb_track', 'notice_post'), modules: ALL_MODULES, flags, onboarding: false });
  const team = must(g.find((x): x is NavGroup => x.key === 'team'));
  expect(team.tabs.filter(t => !t.group).map(t => t.label)).toEqual(['Team Home', 'Approvals']);
  expect([...new Set(team.tabs.filter(t => t.group).map(t => t.group))]).toEqual(['Scheduling', 'Requests', 'People']);
});
test('a module switched off removes its tabs', () => {
  const g = buildNav({ caps: caps('own_home', 'own_shifts', 'own_leave'), modules: { ...ALL_MODULES, R: false, L: false }, flags, onboarding: false });
  expect(must(g[0]).tabs.map(t => t.label)).not.toContain('Shifts');
  expect(must(g[0]).tabs.map(t => t.label)).not.toContain('Leave');
});
test('someone still onboarding sees onboarding and nothing else', () => {
  const g = buildNav({ caps: caps('own_home', 'own_onb', 'own_ts'), modules: ALL_MODULES, flags, onboarding: true });
  expect(g.flatMap(x => x.tabs).map(t => t.label)).toEqual(['Onboarding']);
});
test('views outside plan 1a are marked not built and name their sub-project', () => {
  const g = buildNav({ caps: caps('own_home', 'own_ts'), modules: ALL_MODULES, flags, onboarding: false });
  const ts = must(must(g[0]).tabs.find(t => t.view === 'ts'));
  expect(ts).toMatchObject({ built: false, subProject: 'Timesheet' });
});

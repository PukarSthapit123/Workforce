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

test('team tabs carry a stable groupKey distinct from their display label (never derived from it)', () => {
  const g = buildNav({ caps: caps('own_home', 'team_rota', 'rota_pattern', 'rota_shift', 'team_leave', 'team_sick', 'team_hours'), modules: ALL_MODULES, flags, onboarding: false });
  const team = must(g.find((x): x is NavGroup => x.key === 'team'));
  const scheduling = team.tabs.filter(t => t.group === 'Scheduling');
  const requests = team.tabs.filter(t => t.group === 'Requests');
  expect(scheduling.length).toBeGreaterThan(0);
  expect(scheduling.every(t => t.groupKey === 'scheduling')).toBe(true);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(t => t.groupKey === 'requests')).toBe(true);
});

test('setup pages are grouped into the prototype\'s five sections (SETUP_SECTIONS), in order', () => {
  const g = buildNav({
    caps: caps('perm_cfg', 'master_data', 'mod_cfg', 'type_cfg', 'framework', 'integration'),
    modules: ALL_MODULES, flags: { ...flags, ITACCESS: true }, onboarding: false,
  });
  const setup = must(g.find((x): x is NavGroup => x.key === 'setup'));
  const sectionKeys = [...new Set(setup.tabs.filter(t => t.sectionKey).map(t => t.sectionKey))];
  expect(sectionKeys).toEqual(['org', 'mods', 'people', 'gov', 'int']);
});

test('the module setup and integration pages the prototype\'s SETUP_NEED lists are reachable, gated and named for their sub-project', () => {
  const g = buildNav({ caps: caps('mod_cfg', 'integration'), modules: ALL_MODULES, flags: { ...flags, ITACCESS: true }, onboarding: false });
  const setup = must(g.find((x): x is NavGroup => x.key === 'setup'));
  const byView = (v: string) => must(setup.tabs.find(t => t.view === v), `no setup tab for view "${v}"`);
  expect(byView('mts')).toMatchObject({ built: false, subProject: 'Timesheet', section: 'Modules' });
  expect(byView('mrota')).toMatchObject({ built: false, subProject: 'Rota', section: 'Modules' });
  expect(byView('mleave')).toMatchObject({ built: false, subProject: 'Leave', section: 'Modules' });
  expect(byView('mpay')).toMatchObject({ built: false, subProject: 'Timesheet', section: 'Integrations' });
  expect(byView('ipay')).toMatchObject({ built: false, subProject: 'Payroll and Business Central', section: 'Integrations' });
  expect(byView('ibc')).toMatchObject({ built: false, subProject: 'Payroll and Business Central', section: 'Integrations' });
  expect(byView('iit')).toMatchObject({ built: false, subProject: 'Rota', section: 'Integrations' });
});

test('mts, mrota and mleave each still need their own module switched on, not just mod_cfg', () => {
  const g = buildNav({ caps: caps('mod_cfg'), modules: { ...ALL_MODULES, A: false, B: false, R: false, L: false }, flags, onboarding: false });
  const setup = must(g.find((x): x is NavGroup => x.key === 'setup'));
  const views = setup.tabs.map(t => t.view);
  expect(views).not.toContain('mts');
  expect(views).not.toContain('mrota');
  expect(views).not.toContain('mleave');
});

test('iit additionally needs the ITACCESS flag', () => {
  const withFlag = buildNav({ caps: caps('integration'), modules: ALL_MODULES, flags: { ...flags, ITACCESS: true }, onboarding: false });
  const withoutFlag = buildNav({ caps: caps('integration'), modules: ALL_MODULES, flags: { ...flags, ITACCESS: false }, onboarding: false });
  const setupWith = must(withFlag.find((x): x is NavGroup => x.key === 'setup'));
  const setupWithout = must(withoutFlag.find((x): x is NavGroup => x.key === 'setup'));
  expect(setupWith.tabs.map(t => t.view)).toContain('iit');
  expect(setupWithout.tabs.map(t => t.view)).not.toContain('iit');
});

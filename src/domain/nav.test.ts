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
  /* module 3 builds My shifts */
  expect(must(must(g[0]).tabs.find(t => t.view === 'shifts'))).toMatchObject({ built: true, path: '/work/shifts' });
  expect(must(must(g[0]).tabs.find(t => t.view === 'shifts')).subProject).toBeUndefined();
  /* module 4 builds My leave */
  expect(must(must(g[0]).tabs.find(t => t.view === 'leave'))).toMatchObject({ built: true, path: '/work/leave' });
  expect(must(must(g[0]).tabs.find(t => t.view === 'leave')).subProject).toBeUndefined();
});
test('a manager also gets My Team, with Team Home and Approvals in the strip and the rest under headings', () => {
  const g = buildNav({ caps: caps('own_home', 'team_ts', 'team_rota', 'team_cover', 'team_leave', 'team_sick', 'team_hours', 'team_people', 'onb_track', 'notice_post'), modules: ALL_MODULES, flags, onboarding: false });
  const team = must(g.find((x): x is NavGroup => x.key === 'team'));
  expect(team.tabs.filter(t => !t.group).map(t => t.label)).toEqual(['Team Home', 'Approvals']);
  expect([...new Set(team.tabs.filter(t => t.group).map(t => t.group))]).toEqual(['Scheduling', 'Requests', 'People']);
  /* module 2 builds Team timesheets */
  expect(must(team.tabs.find(t => t.view === 'tteam'))).toMatchObject({ built: true, path: '/team/tteam' });
  expect(must(team.tabs.find(t => t.view === 'tteam')).subProject).toBeUndefined();
  /* module 3 builds Team rota and Cover requests */
  expect(must(team.tabs.find(t => t.view === 'trota'))).toMatchObject({ built: true, path: '/team/trota', group: 'Scheduling' });
  expect(must(team.tabs.find(t => t.view === 'trota')).subProject).toBeUndefined();
  expect(must(team.tabs.find(t => t.view === 'tcover'))).toMatchObject({ built: true, path: '/team/tcover', group: 'Scheduling' });
  expect(must(team.tabs.find(t => t.view === 'tcover')).subProject).toBeUndefined();
  /* module 4 builds Team leave and Sickness */
  expect(must(team.tabs.find(t => t.view === 'tleave'))).toMatchObject({ built: true, path: '/team/tleave', group: 'Requests', label: 'Requests' });
  expect(must(team.tabs.find(t => t.view === 'tleave')).subProject).toBeUndefined();
  expect(must(team.tabs.find(t => t.view === 'tsick'))).toMatchObject({ built: true, path: '/team/tsick', group: 'Requests', label: 'Sickness' });
  expect(must(team.tabs.find(t => t.view === 'tsick')).subProject).toBeUndefined();
});
test('a manager who builds the rota gets the Shift catalogue and Working patterns, built, in the prototype order', () => {
  const g = buildNav({ caps: caps('own_home', 'team_rota', 'team_cover', 'rota_shift', 'rota_pattern'), modules: ALL_MODULES, flags, onboarding: false });
  const team = must(g.find((x): x is NavGroup => x.key === 'team'));
  expect(team.tabs.filter(t => t.group === 'Scheduling').map(t => t.label)).toEqual(['Rota', 'Cover requests', 'Shift catalogue', 'Working patterns']);
  expect(team.tabs.filter(t => t.group === 'Scheduling').every(t => t.built && !t.subProject)).toBe(true);
  expect(must(team.tabs.find(t => t.view === 'tshifts')).path).toBe('/team/tshifts');
  expect(must(team.tabs.find(t => t.view === 'tpat')).path).toBe('/team/tpat');
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
  const g = buildNav({ caps: caps('own_home', 'own_ts', 'own_hours'), modules: ALL_MODULES, flags, onboarding: false });
  const hours = must(must(g[0]).tabs.find(t => t.view === 'hours'));
  expect(hours).toMatchObject({ built: false, subProject: 'Timesheet' });
  /* module 2 builds My timesheet */
  expect(must(must(g[0]).tabs.find(t => t.view === 'ts'))).toMatchObject({ built: true });
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
  expect(byView('mts')).toMatchObject({ built: true, path: '/setup/mts', section: 'Modules' });
  expect(byView('mts').subProject).toBeUndefined();
  expect(byView('mrota')).toMatchObject({ built: true, path: '/setup/mrota', section: 'Modules' });
  expect(byView('mrota').subProject).toBeUndefined();
  expect(byView('mleave')).toMatchObject({ built: true, path: '/setup/mleave', section: 'Modules' });
  expect(byView('mleave').subProject).toBeUndefined();
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

/* MANAGER NAV GROUPED BY MODULE: "The manager keeps their own employee
   surface" (prototype: tabsIn('work').length>4). A manager's capability set
   always includes the employee-level caps too ("everything an employee can
   do, plus their team" — seed/social.json), so the work group is never
   trimmed down to nothing just because team caps were added. */
test('a manager keeps their own employee surface: the work group still has more than a handful of tabs', () => {
  const g = buildNav({
    caps: caps('own_home', 'own_ts', 'own_shifts', 'own_leave', 'own_hours', 'own_notices', 'team_ts', 'team_rota', 'team_people'),
    modules: ALL_MODULES, flags, onboarding: false,
  });
  const work = must(g.find((x): x is NavGroup => x.key === 'work'));
  expect(work.tabs.length).toBeGreaterThan(4);
});

/* MANAGER NAV GROUPED BY MODULE: "Turning it back on restores them". buildNav
   is a pure function of `modules`, so re-enabling one is just calling it
   again with that flag true; this proves the round trip rather than only
   half of it (a module switched off removes its tabs, tested above). */
test('re-enabling a module brings its tabs back', () => {
  const caps_ = caps('own_home', 'team_leave', 'team_sick');
  const off = buildNav({ caps: caps_, modules: { ...ALL_MODULES, L: false }, flags, onboarding: false });
  const on = buildNav({ caps: caps_, modules: ALL_MODULES, flags, onboarding: false });
  const teamOff = must(off.find((x): x is NavGroup => x.key === 'team'));
  const teamOn = must(on.find((x): x is NavGroup => x.key === 'team'));
  expect(teamOff.tabs.map(t => t.label)).not.toContain('Requests');
  expect(teamOn.tabs.map(t => t.label)).toContain('Requests');
});

/* MANAGER NAV GROUPED BY MODULE: "Admin has no duplicate Rota group — it uses
   Qnipay setup". An admin's capability set holds no team_* capability at all
   (seed/social.json), so buildNav never produces a 'team' group for one; rota
   configuration is reached through the setup group's Modules section instead. */
test('an admin capability set produces no team rota group; rota setup lives under Qnipay setup instead', () => {
  const g = buildNav({
    caps: caps('perm_cfg', 'master_data', 'mod_cfg', 'type_cfg', 'framework', 'integration'),
    modules: ALL_MODULES, flags: { ...flags, ITACCESS: true }, onboarding: false,
  });
  expect(g.some(x => x.key === 'team')).toBe(false);
  const setup = must(g.find((x): x is NavGroup => x.key === 'setup'));
  expect(setup.tabs.map(t => t.view)).toContain('mrota');
});

/* ADMIN LAYOUT: "One place called setup, not two top-level groups". The same
   admin capability set above produces exactly one top-level group, 'setup':
   no second admin-only group duplicating it, and (per the row above) no
   'team' group either. */
test('an admin capability set produces exactly one top-level group: setup, not two', () => {
  const g = buildNav({
    caps: caps('perm_cfg', 'master_data', 'mod_cfg', 'type_cfg', 'framework', 'integration'),
    modules: ALL_MODULES, flags: { ...flags, ITACCESS: true }, onboarding: false,
  });
  expect(g.map(x => x.key)).toEqual(['setup']);
});
test('plan 1b builds the people, profile, dimensions, contracts and employee types pages', () => {
  const g = buildNav({ caps: caps('own_home', 'master_data', 'team_people', 'type_cfg'), modules: ALL_MODULES, flags, onboarding: false });
  const tabs = g.flatMap(x => x.tabs);
  for (const view of ['apeople', 'tpeople', 'profile', 'aloc', 'acon', 'atypes']) expect(tabs.find(t => t.view === view), view).toMatchObject({ built: true });
  expect(tabs.filter(t => t.subProject?.includes('plan 1b'))).toEqual([]);
});

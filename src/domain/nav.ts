/* Ported from the prototype's NAV() (qnipay-workforce-v15.html, "function NAV()").
   Order is screen order; a run of tabs sharing `group` becomes one menu. */
export interface NavInput { caps: Pick<ReadonlySet<string>, 'has'>; modules: Record<string, boolean>; flags: Record<string, boolean>; onboarding: boolean }
export interface NavTab {
  view: string; label: string; path: string; built: boolean; subProject?: string;
  /* team tabs: a run sharing `group` becomes one dropdown menu in the strip.
     `groupKey` is the stable, copy-independent id behind that display label
     (never derived from it: a copy change must not silently change a test id). */
  group?: string; groupKey?: string;
  /* setup tabs: which of the five setup sections a page belongs to. `section`
     is the display label, `sectionKey` its stable id, same reasoning as above. */
  section?: string; sectionKey?: string;
  /* What the section configures, shown behind hover on its setup card
     (prototype SETUP_SECTIONS desc, html:3975-3991). */
  sectionDescription?: string;
  /* a strip's way back ("‹ All setup", "‹ All modules"): never the page you are on */
  back?: true;
  /* a module's own setup page (mts, mrota, mleave): the code of the module
     whose drill-in reaches it, so it is not listed with its section's pages */
  module?: string;
}
export interface NavGroup { key: 'work' | 'team' | 'setup'; label: string; tabs: NavTab[] }

/* which sub-project brings each view; a view not listed here is built in plan 1a */
const LATER: Record<string, string> = {
  hours: 'Timesheet',
  thours: 'Timesheet',
  texc: 'Timesheet', tonb: 'Onboarding',
  mpay: 'Timesheet',
  ipay: 'Payroll and Business Central', ibc: 'Payroll and Business Central', iit: 'Rota',
};
const tab = (group: NavGroup['key'], view: string, label: string, extra: Partial<NavTab> = {}): NavTab =>
  ({ view, label, path: `/${group}/${view}`, built: !(view in LATER), ...(view in LATER ? { subProject: LATER[view] } : {}), ...extra });

/* The prototype's SETUP_SECTIONS (qnipay-workforce-v15.html:3975-3991): the
   fixed order and grouping an administrator sees setup in. Its "Modules"
   section there only lists 'amods'; mts/mrota/mleave are reached one level
   deeper, after choosing a specific module (its MODULE_SEC drill-down, e.g.
   "Timesheet features" -> "Timesheet setup"). They are routes of the
   Modules section here, gated exactly as the prototype's SETUP_NEED
   (html:4002-4011) gates them, and carry `module` so the strip and the
   setup index leave them to their module's drill-in (Shell.tsx stripTabsFor). */
function setupSections(can: (c: string) => boolean, on: (m: string) => boolean, flag: (f: string) => boolean, ts: boolean) {
  const sec = (key: string, label: string, description: string, pages: [boolean, NavTab][]) => ({ key, label, description, pages });
  return [
    sec('org', 'Organisation', 'Who this organisation is, the template it runs on, the calendar, and how it looks', [
      [can('master_data'), tab('setup', 'aorg', 'Organisation')],
      [can('master_data'), tab('setup', 'acal', 'Calendar')],
    ]),
    sec('mods', 'Modules', 'What this tenant runs, the features inside each module, and how each behaves', [
      [can('mod_cfg'), tab('setup', 'amods', 'Modules & features')],
      [can('mod_cfg') && ts, tab('setup', 'mts', 'Timesheet', { module: 'TS' })],
      [can('mod_cfg') && on('R'), tab('setup', 'mrota', 'Rota', { module: 'R' })],
      [can('mod_cfg') && on('L'), tab('setup', 'mleave', 'Leave', { module: 'L' })],
    ]),
    sec('people', 'People', 'The canonical employee record, what each person is, and the structure work is costed to', [
      [can('master_data'), tab('setup', 'apeople', 'People')],
      [can('type_cfg'), tab('setup', 'atypes', 'Employee types')],
      [can('master_data'), tab('setup', 'acon', 'Contracts')],
      [can('master_data'), tab('setup', 'aloc', 'Dimensions')],
    ]),
    sec('gov', 'Governance', 'Who may do what, who is told, and who signs it off', [
      [can('perm_cfg'), tab('setup', 'aperm', 'Permissions')],
      [can('framework'), tab('setup', 'anotif', 'Notifications')],
      [can('framework'), tab('setup', 'aappr', 'Approvals')],
    ]),
    sec('int', 'Integrations', 'What crosses to payroll, what is recorded, and what is raised with IT', [
      [can('integration'), tab('setup', 'ipay', 'Payroll readiness')],
      [can('mod_cfg'), tab('setup', 'mpay', 'Pay codes')],
      [can('integration'), tab('setup', 'ibc', 'Business Central')],
      [can('integration'), tab('setup', 'iaudit', 'Audit log')],
      [can('integration') && flag('ITACCESS'), tab('setup', 'iit', 'IT service desk')],
    ]),
  ];
}

export function buildNav({ caps, modules, flags, onboarding }: NavInput): NavGroup[] {
  const can = (c: string) => caps.has(c), on = (m: string) => !!modules[m], flag = (f: string) => !!flags[f];
  const ts = on('A') || on('B');
  const work: [boolean, NavTab][] = [
    [can('own_onb') && on('ON') && onboarding, tab('work', 'onb', 'Onboarding')],
    [can('own_home') && !onboarding, tab('work', 'home', 'Home')],
    [can('own_ts') && ts && !onboarding, tab('work', 'ts', 'Timesheet')],
    [can('own_shifts') && on('R') && !onboarding, tab('work', 'shifts', 'Shifts')],
    [can('own_leave') && on('L') && !onboarding, tab('work', 'leave', 'Leave')],
    [can('own_hours') && !onboarding, tab('work', 'hours', 'Hours')],
    [can('own_home') && !onboarding, tab('work', 'profile', 'Profile')],
    [can('own_home') && flag('DOCS') && !onboarding, tab('work', 'docs', 'Documents')],
    [can('own_notices') && flag('NOTICES') && !onboarding, tab('work', 'notices', 'Notices')],
  ];
  const teamHome = ['team_ts', 'team_rota', 'team_leave', 'team_people', 'team_hours'].some(can);
  const team: [boolean, NavTab][] = [
    [teamHome, tab('team', 'thome', 'Team Home')],
    [can('team_ts') && ts, tab('team', 'tteam', 'Approvals')],
    [can('team_hours') && ts, tab('team', 'thours', 'Hours position', { group: 'Scheduling', groupKey: 'scheduling' })],
    [can('team_rota') && on('R'), tab('team', 'trota', 'Rota', { group: 'Scheduling', groupKey: 'scheduling' })],
    [can('team_cover') && on('R') && flag('FULFIL'), tab('team', 'tcover', 'Cover requests', { group: 'Scheduling', groupKey: 'scheduling' })],
    [can('rota_shift') && can('team_rota') && on('R'), tab('team', 'tshifts', 'Shift catalogue', { group: 'Scheduling', groupKey: 'scheduling' })],
    [can('rota_pattern') && can('team_rota') && on('R'), tab('team', 'tpat', 'Working patterns', { group: 'Scheduling', groupKey: 'scheduling' })],
    [can('team_leave') && on('L'), tab('team', 'tleave', 'Requests', { group: 'Requests', groupKey: 'requests' })],
    [can('team_sick') && on('L'), tab('team', 'tsick', 'Sickness', { group: 'Requests', groupKey: 'requests' })],
    [can('team_hours'), tab('team', 'texc', 'Exceptions', { group: 'Requests', groupKey: 'requests' })],
    [can('team_people'), tab('team', 'tpeople', 'People', { group: 'People', groupKey: 'people' })],
    [can('onb_track') && on('ON'), tab('team', 'tonb', 'Onboarding', { group: 'People', groupKey: 'people' })],
    [can('notice_post') && flag('NOTICES'), tab('team', 'tnotices', 'Notices', { group: 'People', groupKey: 'people' })],
  ];
  const keep = (xs: [boolean, NavTab][]) => xs.filter(([ok]) => ok).map(([, t]) => t);
  const sections = setupSections(can, on, flag, ts)
    .map(s => ({ ...s, tabs: keep(s.pages).map(t => ({ ...t, section: s.label, sectionKey: s.key, sectionDescription: s.description })) }))
    .filter(s => s.tabs.length);
  const setupTabs = sections.flatMap(s => s.tabs);
  const groups: NavGroup[] = [
    { key: 'work', label: 'My Work', tabs: keep(work) },
    { key: 'team', label: 'My Team', tabs: onboarding ? [] : keep(team) },
    { key: 'setup', label: 'Qnipay setup', tabs: onboarding || !setupTabs.length ? [] : [tab('setup', 'asetup', 'Qnipay setup'), ...setupTabs] },
  ];
  return groups.filter(g => g.tabs.length);
}

/* Every page the app knows, whoever can reach it: a link to anything else is
   unknown, and a link to one of these that is not on your own nav is
   unavailable to you (brief D9). */
export function everyTab(): NavTab[] {
  const all = { has: () => true };
  const modules = { A: true, B: true, C: true, TS: true, R: true, L: true, ON: true, CORE: true };
  const flags = { DOCS: true, NOTICES: true, FULFIL: true, ITACCESS: true };
  const tabs = [true, false].flatMap(onboarding => buildNav({ caps: all, modules, flags, onboarding }).flatMap(g => g.tabs));
  return tabs.filter((t, i) => tabs.findIndex(x => x.path === t.path) === i);
}

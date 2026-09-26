/* Ported from the prototype's NAV() (qnipay-workforce-v15.html, "function NAV()").
   Order is screen order; a run of tabs sharing `group` becomes one menu. */
export interface NavInput { caps: Set<string>; modules: Record<string, boolean>; flags: Record<string, boolean>; onboarding: boolean }
export interface NavTab { view: string; label: string; group?: string; path: string; built: boolean; subProject?: string }
export interface NavGroup { key: 'work' | 'team' | 'setup'; label: string; tabs: NavTab[] }

/* which sub-project brings each view; a view not listed here is built in plan 1a */
const LATER: Record<string, string> = {
  home: 'Workforce core (plan 1c)', ts: 'Timesheet', shifts: 'Rota', leave: 'Leave', hours: 'Timesheet',
  profile: 'Workforce core (plan 1b)', docs: 'Workforce core (plan 1c)', notices: 'Workforce core (plan 1c)', onb: 'Onboarding',
  thome: 'Workforce core (plan 1c)', tteam: 'Timesheet', thours: 'Timesheet', trota: 'Rota', tcover: 'Rota', tshifts: 'Rota',
  tpat: 'Rota', tleave: 'Leave', tsick: 'Leave', texc: 'Timesheet', tpeople: 'Workforce core (plan 1b)', tonb: 'Onboarding',
  tnotices: 'Workforce core (plan 1c)',
  aorg: 'Workforce core (plan 1c)', acal: 'Workforce core (plan 1c)', amods: 'Workforce core (plan 1c)', apeople: 'Workforce core (plan 1b)',
  atypes: 'Workforce core (plan 1b)', acon: 'Workforce core (plan 1b)', aloc: 'Workforce core (plan 1b)', anotif: 'Workforce core (plan 1c)',
  aappr: 'Workforce core (plan 1c)', mts: 'Timesheet', mrota: 'Rota', mleave: 'Leave', mpay: 'Timesheet',
  ipay: 'Payroll and Business Central', ibc: 'Payroll and Business Central', iit: 'Rota',
};
const tab = (group: NavGroup['key'], view: string, label: string, extra: Partial<NavTab> = {}): NavTab =>
  ({ view, label, path: `/${group}/${view}`, built: !(view in LATER), ...(view in LATER ? { subProject: LATER[view] } : {}), ...extra });

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
    [can('team_hours') && ts, tab('team', 'thours', 'Hours position', { group: 'Scheduling' })],
    [can('team_rota') && on('R'), tab('team', 'trota', 'Rota', { group: 'Scheduling' })],
    [can('team_cover') && on('R') && flag('FULFIL'), tab('team', 'tcover', 'Cover requests', { group: 'Scheduling' })],
    [can('rota_shift') && can('team_rota') && on('R'), tab('team', 'tshifts', 'Shift catalogue', { group: 'Scheduling' })],
    [can('rota_pattern') && can('team_rota') && on('R'), tab('team', 'tpat', 'Working patterns', { group: 'Scheduling' })],
    [can('team_leave') && on('L'), tab('team', 'tleave', 'Requests', { group: 'Requests' })],
    [can('team_sick') && on('L'), tab('team', 'tsick', 'Sickness', { group: 'Requests' })],
    [can('team_hours'), tab('team', 'texc', 'Exceptions', { group: 'Requests' })],
    [can('team_people'), tab('team', 'tpeople', 'People', { group: 'People' })],
    [can('onb_track') && on('ON'), tab('team', 'tonb', 'Onboarding', { group: 'People' })],
    [can('notice_post') && flag('NOTICES'), tab('team', 'tnotices', 'Notices', { group: 'People' })],
  ];
  const setupPages: [boolean, NavTab][] = [
    [can('master_data'), tab('setup', 'aorg', 'Organisation')], [can('master_data'), tab('setup', 'acal', 'Calendar')],
    [can('mod_cfg'), tab('setup', 'amods', 'Modules & features')], [can('master_data'), tab('setup', 'apeople', 'People')],
    [can('type_cfg'), tab('setup', 'atypes', 'Employee types')], [can('master_data'), tab('setup', 'acon', 'Contracts')],
    [can('master_data'), tab('setup', 'aloc', 'Dimensions')], [can('perm_cfg'), tab('setup', 'aperm', 'Permissions')],
    [can('framework'), tab('setup', 'anotif', 'Notifications')], [can('framework'), tab('setup', 'aappr', 'Approvals')],
    [can('integration'), tab('setup', 'iaudit', 'Audit log')],
  ];
  const keep = (xs: [boolean, NavTab][]) => xs.filter(([ok]) => ok).map(([, t]) => t);
  const setupTabs = keep(setupPages);
  const groups: NavGroup[] = [
    { key: 'work', label: 'My Work', tabs: keep(work) },
    { key: 'team', label: 'My Team', tabs: onboarding ? [] : keep(team) },
    { key: 'setup', label: 'Qnipay setup', tabs: onboarding || !setupTabs.length ? [] : [tab('setup', 'asetup', 'Qnipay setup'), ...setupTabs] },
  ];
  return groups.filter(g => g.tabs.length);
}

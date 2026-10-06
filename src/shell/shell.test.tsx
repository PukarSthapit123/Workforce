import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/query';
import { ShellView, isHere, roleLabelOf, stripTabsFor } from './Shell';
import { emptyInbox } from './Inbox';
import { buildNav } from '@/domain/nav';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { tid } from '@/testids';
import type { MenuAccount } from './AccountMenu';

const menuAccount = (name: string): MenuAccount => ({ name, email: 'someone@example.org', personCode: 'CP-0001', roleName: 'Admin', roleDescription: 'Configure how this workforce operates', locationName: 'Head office' });

test('the shell has full test id coverage for a manager', () => {
  const nav = buildNav({ caps: new Set(['own_home', 'team_ts', 'team_people', 'notice_post']), modules: { TS: true, A: true, CORE: true }, flags: { NOTICES: true }, onboarding: false });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Manager" viewingAs={null} account={menuAccount('Rachel Hussain')} inbox={emptyInbox(2)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expectTestIdCoverage();
});

/* Spec §6: "The role pill shows the account's role, and says so while viewing
   as someone else." Ported from the prototype (qnipay-workforce-v15.html:
   10605-10608: the `.viewing` toggle and the composed title) and CSS
   (html:1164, `.rolepill.viewing{opacity:.85;border-style:dashed}`). */
test('viewing as someone else shows a dashed role pill naming both people, a way back, and full test id coverage', () => {
  const nav = buildNav({ caps: new Set(['own_home']), modules: { CORE: true }, flags: {}, onboarding: false });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Employee" viewingAs="Amara Okafor" account={menuAccount('Priya Shah')} inbox={emptyInbox(0)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.shell.viewAsEnd)).toBeInTheDocument();
  expect(screen.getByText(/Amara Okafor/)).toBeInTheDocument();
  const pill = screen.getByTestId(tid.shell.rolePill);
  expect(pill).toHaveTextContent('Employee');
  expect(pill.className).toMatch(/border-dashed/);
  expect(pill.className).toMatch(/opacity-85/);
  expect(pill).toHaveAttribute('title', 'Looking at the app as Amara Okafor · your account is Priya Shah');
  expectTestIdCoverage();
});

test('not viewing as anyone shows a plain role pill with no title and no dashed style', () => {
  const nav = buildNav({ caps: new Set(['own_home']), modules: { CORE: true }, flags: {}, onboarding: false });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Employee" viewingAs={null} account={menuAccount('Priya Shah')} inbox={emptyInbox(0)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  const pill = screen.getByTestId(tid.shell.rolePill);
  expect(pill).not.toHaveAttribute('title');
  expect(pill.className).not.toMatch(/border-dashed/);
});

/* Plan review focus: a valid session whose capabilities resolve to nothing
   (e.g. everything revoked) must not render an empty shell. It gets a clear
   page saying there is nothing to open and what to do, while the header
   (account menu, sign-out) stays reachable. */
test('an account with no reachable capability sees a clear page, not an empty shell', () => {
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/']}>
    <ShellView nav={[]} roleLabel="Employee" viewingAs={null} account={menuAccount('Priya Shah')} inbox={emptyInbox(0)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.page('none'))).toHaveTextContent(/administrator/i);
  expect(screen.getByTestId(tid.shell.account)).toBeInTheDocument();
  expectTestIdCoverage();
});

/* Item 4: setup is sectioned, not one flat strip. Inside a section the strip
   shows a "‹ All setup" way back plus that section's own pages, and every
   page it can reach still carries full test id coverage. */
test('inside a setup section the strip shows a way back plus that section\'s pages, with full test id coverage', () => {
  const nav = buildNav({ caps: new Set(['perm_cfg', 'framework']), modules: { CORE: true }, flags: {}, onboarding: false });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/setup/aperm']}>
    <ShellView nav={nav} roleLabel="Admin" viewingAs={null} account={menuAccount('Dee Fitzgerald')} inbox={emptyInbox(0)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.nav.tab('asetup'))).toHaveTextContent(/All setup/);
  expect(screen.getByTestId(tid.nav.tab('aperm'))).toBeInTheDocument();
  expect(screen.getByTestId(tid.nav.tab('anotif'))).toBeInTheDocument();
  expect(screen.getByTestId(tid.nav.tab('aappr'))).toBeInTheDocument();
  expect(screen.queryByTestId(tid.nav.tab('aorg'))).not.toBeInTheDocument();
  expectTestIdCoverage();
});

/* Rendering ShellView all the way to the 'asetup' route would mount the real
   SetupIndex, which needs a full SessionProvider; that belongs to
   shell-data.test.tsx. This checks the same rule at the level it actually
   lives: the pure helper Shell.tsx uses to decide what the strip shows. */
test('at the setup index the strip holds the index tab alone, as in the prototype (SetupIndex itself shows the section cards)', () => {
  const nav = buildNav({ caps: new Set(['perm_cfg']), modules: { CORE: true }, flags: {}, onboarding: false });
  const setup = nav.find(g => g.key === 'setup');
  if (!setup) throw new Error('expected a setup group to exist for this capability set');
  expect(stripTabsFor(setup, '/setup/asetup').map(t => [t.view, t.label])).toEqual([['asetup', 'Qnipay setup']]);
});

/* MANAGER NAV GROUPED BY MODULE: "The secondary strip stays scannable"
   (prototype: `#tabs>button,#tabs>.tabgrp).length<=7`, "the strip carries
   five items, not twelve: two pages and three headings"). Consecutive tabs
   sharing a `group` collapse into one dropdown trigger (TabStrip's `runs`),
   so a manager holding every scheduling/requests/people capability still
   sees a handful of top-level items, not one per page. */
test('the manager strip stays scannable: a handful of top-level items, not one per page', () => {
  const nav = buildNav({
    caps: new Set(['own_home', 'team_ts', 'team_hours', 'team_rota', 'rota_pattern', 'rota_shift', 'team_leave', 'team_sick', 'team_people', 'onb_track', 'notice_post']),
    modules: { CORE: true, TS: true, A: true, R: true, L: true, ON: true }, flags: { NOTICES: true }, onboarding: false,
  });
  /* on a page not built yet (Exceptions): the strip is the subject, and Team Home now reads the session */
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/team/texc']}>
    <ShellView nav={nav} roleLabel="Manager" viewingAs={null} account={menuAccount('Rachel Hussain')} inbox={emptyInbox(0)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  const strip = screen.getByRole('navigation', { name: 'Pages' });
  const topLevel = within(strip).getAllByTestId(/^nav-(tab|menu)-/);
  expect(topLevel.length).toBeLessThanOrEqual(7);
});

/* MANAGER NAV GROUPED BY MODULE: "A page inside a menu still marks its
   heading as current". */
test('a page inside a menu still marks its heading as current', () => {
  const nav = buildNav({ caps: new Set(['own_home', 'team_rota', 'rota_pattern', 'rota_shift']), modules: { CORE: true, R: true }, flags: {}, onboarding: false });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/team/trota']}>
    <ShellView nav={nav} roleLabel="Manager" viewingAs={null} account={menuAccount('Rachel Hussain')} inbox={emptyInbox(0)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.nav.menu('scheduling')).className).toMatch(/font-semibold/);
});

/* The module drill-in (v15:4059-4076, suite S:3051-3060): opening a module
   gives a way back to the module list, the module's features, and its setup
   page when this person can reach it; the way back is never the current page. */
test('inside a module the strip reads All modules, then its features, then its setup page', () => {
  const nav = buildNav({ caps: new Set(['mod_cfg']), modules: { CORE: true, TS: true, A: true, R: true, L: true }, flags: {}, onboarding: false });
  const setup = nav.find(g => g.key === 'setup');
  if (!setup) throw new Error('expected a setup group');
  const strip = stripTabsFor(setup, '/setup/amods', '?m=R');
  expect(strip.map(t => t.label)).toEqual(['‹ All modules', 'Rota features', 'Rota setup']);
  expect(strip.map(t => t.path)).toEqual(['/setup/amods', '/setup/amods?m=R', '/setup/mrota']);
  expect(strip.map(t => isHere(t, '/setup/amods?m=R'))).toEqual([false, true, false]);
  expect(stripTabsFor(setup, '/setup/amods', '?m=CORE').map(t => t.label)).toEqual(['‹ All modules', 'Workforce core features']);
  expect(stripTabsFor(setup, '/setup/amods').map(t => t.label)).toEqual(['‹ All setup', 'Modules & features']);
});

/* ADMIN LAYOUT (suite S:3051-3060): a module's setup page is inside its drill-in,
   "‹ All modules | Timesheet features | Timesheet setup", the setup page the
   one on screen, and the way back returns to the module list. */
test('on a module setup page (mts, mrota, mleave, monb) the strip is that module’s drill-in, with the setup page current', () => {
  const nav = buildNav({ caps: new Set(['mod_cfg', 'onb_cfg']), modules: { CORE: true, TS: true, A: true, R: true, L: true, ON: true }, flags: {}, onboarding: false });
  const setup = nav.find(g => g.key === 'setup');
  if (!setup) throw new Error('expected a setup group');
  const cases = [['/setup/mts', 'TS', ['‹ All modules', 'Timesheet features', 'Timesheet setup']],
    ['/setup/mrota', 'R', ['‹ All modules', 'Rota features', 'Rota setup']],
    ['/setup/mleave', 'L', ['‹ All modules', 'Leave & absence features', 'Leave setup']],
    ['/setup/monb', 'ON', ['‹ All modules', 'Onboarding features', 'Onboarding setup']]] as const;
  for (const [path, code, labels] of cases) {
    const strip = stripTabsFor(setup, path);
    expect(strip.map(t => t.label)).toEqual(labels);
    expect(strip.map(t => t.path)).toEqual(['/setup/amods', `/setup/amods?m=${code}`, path]);
    expect(strip.map(t => isHere(t, path))).toEqual([false, false, true]);
  }
});

test('the strip on a module setup page renders the drill-in tabs, the setup page marked current', () => {
  const nav = buildNav({ caps: new Set(['mod_cfg']), modules: { CORE: true, TS: true, A: true, R: true, L: true }, flags: {}, onboarding: false });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/setup/amods?m=R']}>
    <ShellView nav={nav} roleLabel="Admin" viewingAs={null} account={menuAccount('Dee Fitzgerald')} inbox={emptyInbox(0)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  const strip = screen.getByRole('navigation', { name: 'Pages' });
  expect(within(strip).getAllByRole('link').map(a => a.textContent)).toEqual(['‹ All modules', 'Rota features', 'Rota setup']);
  expect(within(strip).getByRole('link', { name: 'Rota setup' })).toHaveAttribute('href', '/setup/mrota');
  expect(within(strip).getByRole('link', { name: 'Rota features' })).toHaveAttribute('aria-current', 'page');
});

/* 1c follow-up from group 2 (D11): the role pill shows the renamed role,
   the viewed person's own while viewing as someone, never the raw user type. */
test('the role pill shows the renamed role, the viewed person\'s while viewing as someone', () => {
  const account = { email: 'a@example.org', userType: 'admin' as const, personCode: 'CP-0001', name: 'Dee', roleName: 'Administrator', roleDescription: '', locationName: '' };
  expect(roleLabelOf({ account })).toBe('Administrator');
  expect(roleLabelOf({ account, viewingAs: { personCode: 'CP-0002', name: 'Amara Okafor', userType: 'employee', roleName: 'Colleague' } })).toBe('Colleague');
  expect(roleLabelOf({ account: { ...account, roleName: '' } })).toBe('Admin');
});

/* MOBILE FOUNDATION (suite S:1739-1790) and the bar itself (v15:10648-10661):
   the phone's bottom bar is painted from the strip's own array, at most five
   items, four destinations and More when there are more, each a glyph over
   the first word of its name; More is lit while the page on screen is one the
   bar has no room for, and opens "Go to", every page of the strip with
   Current against the one you are on. */
const renderAt = (nav: ReturnType<typeof buildNav>, path: string) =>
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}>
    <ShellView nav={nav} roleLabel="Employee" viewingAs={null} account={menuAccount('Amara Okafor')} inbox={emptyInbox(0)} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
const bar = () => screen.getByRole('navigation', { name: 'Quick pages' });
const barItems = () => within(bar()).getAllByRole('link').concat(within(bar()).queryAllByRole('button'));

test('employee: four destinations with their glyphs and short names, then More, which is lit on a page the bar has no room for', () => {
  const nav = buildNav({ caps: new Set(['own_home', 'own_ts', 'own_shifts', 'own_leave', 'own_hours', 'own_notices']),
    modules: { CORE: true, TS: true, A: true, R: true, L: true }, flags: { DOCS: true, NOTICES: true }, onboarding: false });
  renderAt(nav, '/work/hours');
  const links = within(bar()).getAllByRole('link');
  expect(links.map(a => a.getAttribute('aria-label'))).toEqual(['Home', 'Timesheet', 'Shifts', 'Leave']);
  expect(links.map(a => a.textContent)).toEqual(['⌂Home', '◷Timesheet', '▦Shifts', 'Leave']);
  expect(within(links[3] as HTMLElement).getByText('Leave').previousElementSibling?.querySelector('svg')).not.toBeNull();
  expect(barItems()).toHaveLength(5);
  const more = screen.getByTestId(tid.nav.more);
  expect(more).toHaveAccessibleName('More sections');
  expect(more.className).toMatch(/text-brand/);
  expect(links.every(a => !a.hasAttribute('aria-current'))).toBe(true);
});

test('More opens Go to, listing every page of the strip with Current against the one on screen, and choosing one closes it', async () => {
  const nav = buildNav({ caps: new Set(['own_home', 'own_ts', 'own_shifts', 'own_leave', 'own_hours', 'own_notices']),
    modules: { CORE: true, TS: true, A: true, R: true, L: true }, flags: { DOCS: true, NOTICES: true }, onboarding: false });
  renderAt(nav, '/work/hours');
  await userEvent.click(screen.getByTestId(tid.nav.more));
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByTestId(tid.modal.title)).toHaveTextContent('Go to');
  const rows = within(screen.getByTestId(tid.nav.goToList)).getAllByRole('listitem');
  const work = nav.find(g => g.key === 'work')?.tabs ?? [];
  expect(rows.map(r => r.firstChild?.textContent)).toEqual(work.map(t => t.label));
  expect(rows.map(r => r.firstChild?.textContent)).toEqual(['Home', 'Timesheet', 'Shifts', 'Leave', 'Hours', 'Profile', 'Documents', 'Notices']);
  expect(screen.getByTestId(tid.nav.goTo('hours'))).toHaveTextContent('Current');
  expect(screen.getByTestId(tid.nav.goTo('hours'))).toHaveAttribute('aria-current', 'page');
  expect(screen.getByTestId(tid.nav.goTo('docs'))).toHaveTextContent('Open');
  expect(screen.getByTestId(tid.nav.goTo('docs'))).toHaveAccessibleName('Open Documents');
  expectTestIdCoverage();
  await userEvent.click(screen.getByTestId(tid.nav.goTo('profile')));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByTestId(tid.nav.bottom('home'))).not.toHaveAttribute('aria-current');
  await userEvent.click(screen.getByTestId(tid.nav.more));
  expect(await screen.findByTestId(tid.nav.goTo('profile'))).toHaveTextContent('Current');
});

test('manager: Team Home first with the home glyph, the 1c Notices page in Go to with the rest', async () => {
  const nav = buildNav({ caps: new Set(['own_home', 'team_ts', 'team_hours', 'team_rota', 'team_leave', 'team_sick', 'team_people', 'notice_post']),
    modules: { CORE: true, TS: true, A: true, R: true, L: true }, flags: { NOTICES: true }, onboarding: false });
  renderAt(nav, '/team/texc');
  expect(within(bar()).getAllByRole('link').map(a => a.textContent)).toEqual(['⌂Team', '◷Approvals', '◴Hours', '▦Rota']);
  await userEvent.click(screen.getByTestId(tid.nav.more));
  const rows = within(await screen.findByTestId(tid.nav.goToList)).getAllByRole('listitem');
  expect(rows.map(r => r.firstChild?.textContent)).toEqual(['Team Home', 'Approvals', 'Hours position', 'Rota', 'Requests', 'Sickness', 'Exceptions', 'People', 'Notices']);
  expect(screen.getByTestId(tid.nav.goTo('texc'))).toHaveTextContent('Current');
});

test('admin: inside a setup section the bar holds the way back and that section’s pages, with no More when they fit', () => {
  const nav = buildNav({ caps: new Set(['integration', 'mod_cfg']), modules: { CORE: true }, flags: {}, onboarding: false });
  renderAt(nav, '/setup/ipay');
  const links = within(bar()).getAllByRole('link');
  expect(links.map(a => a.getAttribute('aria-label'))).toEqual(['‹ All setup', 'Payroll readiness', 'Pay codes', 'Business Central', 'Audit log']);
  expect(links.map(a => a.textContent)).toEqual(['●‹', '●Payroll', '●Pay', '●Business', '●Audit']);
  expect(screen.getByTestId(tid.nav.bottom('ipay'))).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByTestId(tid.nav.more)).toBeNull();
});

/* MOBILE FOUNDATION: "The strip and the bar agree on the current tab". Both
   are painted from one array: on a page the bar has room for, the same view
   is current in both; on one it has no room for, the bar marks none of its
   destinations and lights More instead. */
test('the tab strip and the bottom bar agree on the page on screen', async () => {
  const nav = buildNav({ caps: new Set(['own_home', 'own_ts', 'own_shifts', 'own_leave', 'own_hours', 'own_notices']),
    modules: { CORE: true, TS: true, A: true, R: true, L: true }, flags: { DOCS: true, NOTICES: true }, onboarding: false });
  const current = (testIds: RegExp) => screen.getAllByTestId(testIds).filter(a => a.getAttribute('aria-current') === 'page')
    .map(a => (a.getAttribute('data-testid') ?? '').replace(/^nav-(tab|bottom)-/, ''));
  const view = renderAt(nav, '/work/leave');
  expect(current(/^nav-tab-/)).toEqual(['leave']);
  expect(current(/^nav-bottom-/)).toEqual(['leave']);
  expect(screen.getByTestId(tid.nav.more).className).not.toMatch(/text-brand/);
  view.unmount();
  renderAt(nav, '/work/notices');
  expect(current(/^nav-tab-/)).toEqual(['notices']);
  expect(current(/^nav-bottom-/)).toEqual([]);
  expect(screen.getByTestId(tid.nav.more).className).toMatch(/text-brand/);
});

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/query';
import { ShellView, isHere, stripTabsFor } from './Shell';
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
  expect(stripTabsFor(setup, '/setup/amods').map(t => t.label)).toEqual(['‹ All setup', 'Modules & features', 'Timesheet', 'Rota', 'Leave']);
});

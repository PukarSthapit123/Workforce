import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/query';
import { ShellView, stripTabsFor } from './Shell';
import { buildNav } from '@/domain/nav';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { tid } from '@/testids';

test('the shell has full test id coverage for a manager', () => {
  const nav = buildNav({ caps: new Set(['own_home', 'team_ts', 'team_people', 'notice_post']), modules: { TS: true, A: true, CORE: true }, flags: { NOTICES: true }, onboarding: false });
  const { container } = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Manager" viewingAs={null} ownName="Rachel Hussain" unread={2} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expectTestIdCoverage(container);
});

/* Spec §6: "The role pill shows the account's role, and says so while viewing
   as someone else." Ported from the prototype (qnipay-workforce-v15.html:
   10605-10608: the `.viewing` toggle and the composed title) and CSS
   (html:1164, `.rolepill.viewing{opacity:.85;border-style:dashed}`). */
test('viewing as someone else shows a dashed role pill naming both people, a way back, and full test id coverage', () => {
  const nav = buildNav({ caps: new Set(['own_home']), modules: { CORE: true }, flags: {}, onboarding: false });
  const { container } = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Employee" viewingAs="Amara Okafor" ownName="Priya Shah" unread={0} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.shell.viewAsEnd)).toBeInTheDocument();
  expect(screen.getByText(/Amara Okafor/)).toBeInTheDocument();
  const pill = screen.getByTestId(tid.shell.rolePill);
  expect(pill).toHaveTextContent('Employee');
  expect(pill.className).toMatch(/border-dashed/);
  expect(pill.className).toMatch(/opacity-85/);
  expect(pill).toHaveAttribute('title', 'Looking at the app as Amara Okafor · your account is Priya Shah');
  expectTestIdCoverage(container);
});

test('not viewing as anyone shows a plain role pill with no title and no dashed style', () => {
  const nav = buildNav({ caps: new Set(['own_home']), modules: { CORE: true }, flags: {}, onboarding: false });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Employee" viewingAs={null} ownName="Priya Shah" unread={0} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  const pill = screen.getByTestId(tid.shell.rolePill);
  expect(pill).not.toHaveAttribute('title');
  expect(pill.className).not.toMatch(/border-dashed/);
});

/* Plan review focus: a valid session whose capabilities resolve to nothing
   (e.g. everything revoked) must not render an empty shell. It gets a clear
   page saying there is nothing to open and what to do, while the header
   (account menu, sign-out) stays reachable. */
test('an account with no reachable capability sees a clear page, not an empty shell', () => {
  const { container } = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/']}>
    <ShellView nav={[]} roleLabel="Employee" viewingAs={null} ownName="Priya Shah" unread={0} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.page('none'))).toHaveTextContent(/administrator/i);
  expect(screen.getByTestId(tid.shell.account)).toBeInTheDocument();
  expectTestIdCoverage(container);
});

/* Item 4: setup is sectioned, not one flat strip. Inside a section the strip
   shows a "‹ All setup" way back plus that section's own pages, and every
   page it can reach still carries full test id coverage. */
test('inside a setup section the strip shows a way back plus that section\'s pages, with full test id coverage', () => {
  const nav = buildNav({ caps: new Set(['perm_cfg', 'framework']), modules: { CORE: true }, flags: {}, onboarding: false });
  const { container } = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/setup/aperm']}>
    <ShellView nav={nav} roleLabel="Admin" viewingAs={null} ownName="Dee Fitzgerald" unread={0} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.nav.tab('asetup'))).toHaveTextContent(/All setup/);
  expect(screen.getByTestId(tid.nav.tab('aperm'))).toBeInTheDocument();
  expect(screen.getByTestId(tid.nav.tab('anotif'))).toBeInTheDocument();
  expect(screen.getByTestId(tid.nav.tab('aappr'))).toBeInTheDocument();
  expect(screen.queryByTestId(tid.nav.tab('aorg'))).not.toBeInTheDocument();
  expectTestIdCoverage(container);
});

/* Rendering ShellView all the way to the 'asetup' route would mount the real
   SetupIndex, which needs a full SessionProvider; that belongs to
   shell-data.test.tsx. This checks the same rule at the level it actually
   lives: the pure helper Shell.tsx uses to decide what the strip shows. */
test('at the setup index there is nothing for the strip to show (SetupIndex itself shows the section cards)', () => {
  const nav = buildNav({ caps: new Set(['perm_cfg']), modules: { CORE: true }, flags: {}, onboarding: false });
  const setup = nav.find(g => g.key === 'setup');
  if (!setup) throw new Error('expected a setup group to exist for this capability set');
  expect(stripTabsFor(setup, '/setup/asetup')).toEqual([]);
});

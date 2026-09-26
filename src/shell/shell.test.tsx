import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/query';
import { ShellView } from './Shell';
import { buildNav } from '@/domain/nav';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { tid } from '@/testids';

test('the shell has full test id coverage for a manager', () => {
  const nav = buildNav({ caps: new Set(['own_home', 'team_ts', 'team_people', 'notice_post']), modules: { TS: true, A: true, CORE: true }, flags: { NOTICES: true }, onboarding: false });
  const { container } = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Manager" viewingAs={null} unread={2} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expectTestIdCoverage(container);
});

test('viewing as someone else shows a way back and full test id coverage', () => {
  const nav = buildNav({ caps: new Set(['own_home']), modules: { CORE: true }, flags: {}, onboarding: false });
  const { container } = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Employee" viewingAs="Amara Okafor" unread={0} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.shell.viewAsEnd)).toBeInTheDocument();
  expect(screen.getByText(/Amara Okafor/)).toBeInTheDocument();
  expectTestIdCoverage(container);
});

/* Plan review focus: a valid session whose capabilities resolve to nothing
   (e.g. everything revoked) must not render an empty shell. It gets a clear
   page saying there is nothing to open and what to do, while the header
   (account menu, sign-out) stays reachable. */
test('an account with no reachable capability sees a clear page, not an empty shell', () => {
  const { container } = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/']}>
    <ShellView nav={[]} roleLabel="Employee" viewingAs={null} unread={0} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId(tid.page('none'))).toHaveTextContent(/administrator/i);
  expect(screen.getByTestId(tid.shell.account)).toBeInTheDocument();
  expectTestIdCoverage(container);
});

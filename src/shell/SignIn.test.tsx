import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { queryClient } from '@/api/query';
import { getToken, setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { SignIn } from './SignIn';
import { SessionProvider } from './SessionProvider';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => { store.reset('social'); queryClient.clear(); });
afterEach(() => setToken(null));

const mount = () => render(<QueryClientProvider client={queryClient}><SessionProvider><SignIn /></SessionProvider></QueryClientProvider>);

/* BOOT: "App opens at the sign-in screen" / "Sign-in asks for an email
   address and a password" (qnipay-regression-suite.js: #lg-em, #lg-pw). */
test('the sign-in screen asks for an email address and a password', () => {
  mount();
  expect(screen.getByTestId(tid.page('sign-in'))).toBeInTheDocument();
  expect(screen.getByTestId(tid.signIn.form)).toBeInTheDocument();
  expect(screen.getByTestId(tid.signIn.email)).toHaveAttribute('type', 'email');
  expect(screen.getByTestId(tid.signIn.password)).toHaveAttribute('type', 'password');
});

/* SIGN IN / SIGN OUT: "Each account is one pressable row... showing the
   name, the role, the address and what it is for" / "...covering employees,
   a manager and an admin". PERSISTENCE AND ACCOUNTS: "The account list names
   the role of each account". */
test('the demo accounts list names each account\'s name, role and email as one pressable row', async () => {
  const accounts = (await (await fetch('/api/v1/session/accounts')).json()) as
    { email: string; name: string; userType: 'employee' | 'manager' | 'admin' }[];
  const roleNote = { employee: 'Their own work: timesheet, shifts and leave', manager: 'Approvals and their team', admin: 'Configuration, modules and access' } as const;

  mount();
  await userEvent.click(screen.getByTestId(tid.signIn.showAccounts));
  for (const a of accounts) {
    const row = await screen.findByTestId(tid.signIn.account(a.email));
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveTextContent(a.name);
    expect(row).toHaveTextContent(roleNote[a.userType]);
    expect(row).toHaveTextContent(a.email);
  }
  expect(accounts.some(a => a.userType === 'employee')).toBe(true);
  expect(accounts.some(a => a.userType === 'manager')).toBe(true);
  expect(accounts.some(a => a.userType === 'admin')).toBe(true);
});

/* IDENTITY AND SIGN-IN: "Enter submits the sign-in form rather than doing
   nothing". Our form is a real <form onSubmit>, so this is native browser
   behaviour rather than a hand-rolled keydown handler; this proves it end to
   end through the real sign-in request. */
test('pressing Enter in the password field submits the form', async () => {
  const accounts = (await (await fetch('/api/v1/session/accounts')).json()) as { email: string }[];
  const acc = accounts[0];
  if (!acc) throw new Error('no seeded demo accounts');

  mount();
  await userEvent.type(screen.getByTestId(tid.signIn.email), acc.email);
  await userEvent.type(screen.getByTestId(tid.signIn.password), 'Qnipay@123{Enter}');

  await waitFor(() => expect(getToken()).not.toBeNull());
});

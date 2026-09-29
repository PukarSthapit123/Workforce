import { render, screen } from '@testing-library/react';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { faults } from '@/mocks/faults';
import { getToken, setToken } from '@/api/session-token';
import { queryClient } from '@/api/query';
import { tid } from '@/testids';
import { App } from '@/App';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => { faults.length = 0; store.reset('social'); });
afterEach(() => setToken(null));

const anyAccount = (type: string) => {
  const found = Object.values(store.db.accounts as Record<string, { email: string; userType: string }>).find(a => a.userType === type);
  if (!found) throw new Error(`no seeded account with userType "${type}"`);
  return found;
};

async function signInAndGetToken(email: string): Promise<string> {
  const r = await fetch('/api/v1/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Qnipay@123' }),
  });
  const s = (await r.json()) as { token: string };
  return s.token;
}

test('a cached token for an account that has been removed signs out to the sign-in screen, not an empty shell', async () => {
  const acc = anyAccount('employee');
  const token = await signInAndGetToken(acc.email);
  Reflect.deleteProperty(store.db.accounts as Record<string, unknown>, `acc_${acc.email}`);
  setToken(token);

  render(<App />);

  expect(await screen.findByTestId(tid.signIn.form)).toBeInTheDocument();
  expect(getToken()).toBeNull();
});

test('a 500 answering GET /session keeps the cached token instead of signing out', async () => {
  const acc = anyAccount('employee');
  const token = await signInAndGetToken(acc.email);
  setToken(token);
  await fetch('/api/_dev/faults', {
    method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/session', status: 500, times: 1 }),
  });

  render(<App />);

  /* Nothing in the placeholder root yet distinguishes "still checking" from
     "gave up" (Task 8 builds the real shell); what this proves is narrower
     and matches the fix: a transient server failure must never throw away
     the one thing a later retry or reload depends on. */
  await screen.findByTestId(tid.signIn.form);
  expect(getToken()).toBe(token);
});

/* Global 401 handling (queryClient's QueryCache/MutationCache onError, wired
   in src/api/query.ts): a request answered mid-session, well after sign-in
   and the shell rendering, still signs out and says why, not just the two
   direct reads (boot and 'refresh') that already handled their own 401. */
test('a 401 answering a request after the shell is up signs out and shows why', async () => {
  const acc = anyAccount('employee');
  const token = await signInAndGetToken(acc.email);
  setToken(token);

  render(<App />);
  await screen.findByTestId(tid.shell.rolePill); // the shell is up: tenant already loaded fine once

  await fetch('/api/_dev/faults', {
    method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/tenant', status: 401, times: 1 }),
  });
  await queryClient.invalidateQueries({ queryKey: ['tenant'] });

  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('The server could not complete that. Nothing has been changed.');
  expect(await screen.findByTestId(tid.signIn.form)).toBeInTheDocument();
  expect(getToken()).toBeNull();
});

/* A 5xx mid-session leaves the token alone, exactly like the boot-time and
   tenant-load cases above: only a 401 signs out. */
test('a 5xx answering a request after the shell is up keeps the token', async () => {
  const acc = anyAccount('employee');
  const token = await signInAndGetToken(acc.email);
  setToken(token);

  render(<App />);
  await screen.findByTestId(tid.shell.rolePill);

  await fetch('/api/_dev/faults', {
    method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/tenant', status: 500, times: 1 }),
  });
  await queryClient.invalidateQueries({ queryKey: ['tenant'] });

  /* The tenant query itself now renders the error state (unrelated to this
     step); what matters here is that the token was not thrown away. */
  await screen.findByTestId(tid.shell.error);
  expect(screen.queryByTestId(tid.signIn.form)).not.toBeInTheDocument();
  expect(getToken()).toBe(token);
});

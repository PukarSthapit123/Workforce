import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { faults } from '@/mocks/faults';
import { getToken, setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { App } from '@/App';

/* Shell.tsx:26 and SetupIndex.tsx:15 used to render blank (`return null`)
   whether the tenant fetch was still pending or had failed outright: a fault,
   network error or revoked session left no header and no way to sign out.
   These drive real faults through the running app (as e2e's api.fault does)
   to prove the loading and error states shellData.tsx now renders instead. */

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

async function faultTenant(status: number, times = 1): Promise<void> {
  await fetch('/api/_dev/faults', {
    method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/tenant', status, times }),
  });
}

test('a failed tenant load shows a clear error, not a blank screen, and Sign out works from it', async () => {
  const acc = anyAccount('employee');
  const token = await signInAndGetToken(acc.email);
  setToken(token);
  await faultTenant(500);

  render(<App />);

  expect(await screen.findByTestId(tid.shell.error)).toHaveTextContent(/could not load your workspace/i);
  expect(screen.getByTestId(tid.shell.retry)).toBeInTheDocument();

  await userEvent.click(screen.getByTestId(tid.shell.signOut));

  expect(await screen.findByTestId(tid.signIn.form)).toBeInTheDocument();
  expect(getToken()).toBeNull();
});

test('retrying after a failed tenant load renders the shell once the server recovers', async () => {
  const acc = anyAccount('employee');
  const token = await signInAndGetToken(acc.email);
  setToken(token);
  await faultTenant(500, 1); // the one fault is consumed by the first attempt; a retry hits the real handler

  render(<App />);

  expect(await screen.findByTestId(tid.shell.error)).toBeInTheDocument();

  await userEvent.click(screen.getByTestId(tid.shell.retry));

  expect(await screen.findByTestId(tid.shell.rolePill)).toBeInTheDocument();
});

test('a 401 answering the tenant load signs out instead of leaving a dead end', async () => {
  const acc = anyAccount('employee');
  const token = await signInAndGetToken(acc.email);
  setToken(token);
  await faultTenant(401);

  render(<App />);

  expect(await screen.findByTestId(tid.signIn.form)).toBeInTheDocument();
  expect(getToken()).toBeNull();
});

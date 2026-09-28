import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { queryClient } from '@/api/query';
import { getToken, setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { Toaster } from '@/ui/shadcn/sonner';
import { PermissionsPage } from './PermissionsPage';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

interface SeedAccount { email: string; version: number; userType: string; grants: string[]; revocations: string[] }
const accountsById = () => store.db.accounts as unknown as Record<string, SeedAccount>;
const anyAccount = (userType: string): SeedAccount => {
  const found = Object.values(accountsById()).find(a => a.userType === userType);
  if (!found) throw new Error(`no seeded account with userType "${userType}"`);
  return found;
};
const accountRecord = (email: string): SeedAccount => {
  const found = accountsById()[`acc_${email.toLowerCase()}`];
  if (!found) throw new Error(`no seeded account for "${email}"`);
  return found;
};
const FAULT_BODY = { code: 'fault', message: 'The server could not complete that. Nothing has been changed.', next: 'Try again.' };

beforeEach(async () => {
  store.reset('social');
  queryClient.clear();
  const admin = anyAccount('admin');
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'Qnipay@123' }) });
  const s = (await r.json()) as { token: string };
  setToken(s.token);
});
/* sonner keeps its toast queue in a module-level singleton, outside React's own
   lifecycle: unmounting a test's <Toaster/> does not clear it, so a refusal
   toast from one test is still queued (and still rendered) when the next
   test's fresh <Toaster/> mounts. toast.dismiss() with no id clears all of them. */
afterEach(() => { setToken(null); server.resetHandlers(); toast.dismiss(); });

/* sonner's toast.custom(...) (used by toastRefusal) only ever renders once a
   Toaster is mounted somewhere in the tree; App.tsx mounts one for the real
   app, so an isolated component test needs its own. */
const mount = () => render(<QueryClientProvider client={queryClient}><PermissionsPage /><Toaster /></QueryClientProvider>);

test('the matrix renders with full test id coverage', async () => {
  const { container } = mount();
  await screen.findByTestId(tid.access.table);
  expectTestIdCoverage(container);
});

test('a failed save shows the refusal and leaves the cell as it was', async () => {
  mount();
  const cell = await screen.findByTestId(tid.access.cell('proxy', 'employee'));
  const was = cell.getAttribute('aria-pressed');
  server.use(http.put('/api/v1/user-types/:id/capabilities/:cap', () => HttpResponse.json(FAULT_BODY, { status: 500 })));
  await userEvent.click(cell);
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(screen.getByTestId(tid.access.cell('proxy', 'employee'))).toHaveAttribute('aria-pressed', was ?? 'false');
});

/* spec §10.2: every mutation has a fault test. addException here, removeException below. */
test('a failed exception grant shows the refusal and leaves the account unchanged', async () => {
  mount();
  const emp = anyAccount('employee');
  const before = structuredClone(accountRecord(emp.email));
  await userEvent.click(await screen.findByTestId(tid.access.exceptionAdd(emp.email)));
  await userEvent.click(screen.getByTestId(tid.access.exceptionCap));
  await userEvent.click(await screen.findByTestId(`${tid.access.exceptionCap}-option-proxy`));
  /* fireEvent, not userEvent.type: a real per-character keystroke simulation
     is markedly slower under this suite's worker-thread parallelism, and has
     been observed to blow this test's timeout when the whole suite runs
     alongside it (it is not slow in isolation). Nothing here depends on
     keystroke-level behaviour, only the field's final value. */
  fireEvent.change(screen.getByTestId(tid.access.exceptionReason), { target: { value: 'Covers the rota lead on Fridays' } });
  server.use(http.post('/api/v1/users/:email/exceptions', () => HttpResponse.json(FAULT_BODY, { status: 500 })));
  await userEvent.click(screen.getByTestId(tid.access.exceptionSave));
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(accountRecord(emp.email)).toEqual(before);
});

test('clicking Remove deletes the exception, confirmed by reading the account back through the API', async () => {
  const emp = anyAccount('employee');
  const token = getToken();
  if (!token) throw new Error('no token set by beforeEach');
  const granted = await fetch(`/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'If-Match': String(emp.version) },
    body: JSON.stringify({ capability: 'proxy', mode: 'grant', reason: 'Covers the rota lead on Fridays' }),
  });
  expect(granted.status).toBe(200);

  mount();
  await userEvent.click(await screen.findByTestId(tid.access.exceptionAdd(emp.email)));
  await userEvent.click(await screen.findByTestId(tid.access.exceptionRemove(emp.email, 'proxy')));
  await waitFor(() => expect(screen.queryByTestId(tid.access.exceptionRemove(emp.email, 'proxy'))).not.toBeInTheDocument());

  const usersRes = await fetch('/api/v1/users', { headers: { Authorization: `Bearer ${token}` } });
  const users = (await usersRes.json()) as { email: string; grants: string[] }[];
  const after = users.find(u => u.email === emp.email);
  if (!after) throw new Error('the employee account disappeared from /api/v1/users');
  expect(after.grants).not.toContain('proxy');
});

test('a failed exception removal shows the refusal and leaves the account unchanged', async () => {
  const emp = anyAccount('employee');
  const token = getToken();
  if (!token) throw new Error('no token set by beforeEach');
  const granted = await fetch(`/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'If-Match': String(emp.version) },
    body: JSON.stringify({ capability: 'proxy', mode: 'grant', reason: 'Covers the rota lead on Fridays' }),
  });
  expect(granted.status).toBe(200);

  mount();
  const before = structuredClone(accountRecord(emp.email));
  await userEvent.click(await screen.findByTestId(tid.access.exceptionAdd(emp.email)));
  server.use(http.delete('/api/v1/users/:email/exceptions/:cap', () => HttpResponse.json(FAULT_BODY, { status: 500 })));
  await userEvent.click(await screen.findByTestId(tid.access.exceptionRemove(emp.email, 'proxy')));
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(accountRecord(emp.email)).toEqual(before);
});

/* The permissions page ships per-user exceptions, not just the shared
   template, so this proves the row's own summary text, not merely that a
   user-type name is present. A grant is performed through the real API
   (with the signed-in admin token, same as the running app would send)
   before the page ever mounts, so the row is asserted against a change the
   server actually made, not a client-side guess. */
test('a user row reads "Employee + 1 exception" after a grant', async () => {
  const emp = anyAccount('employee');
  const token = getToken();
  if (!token) throw new Error('no token set by beforeEach');
  const granted = await fetch(`/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'If-Match': String(emp.version) },
    body: JSON.stringify({ capability: 'proxy', mode: 'grant', reason: 'Covers the rota lead on Fridays' }),
  });
  expect(granted.status).toBe(200);

  mount();
  const users = await screen.findByTestId(tid.access.users);
  const row = within(users).getByTestId(tid.access.userRow(emp.email));
  expect(within(row).getByTestId(tid.access.exceptions(emp.email))).toHaveTextContent('Employee + 1 exception');
});

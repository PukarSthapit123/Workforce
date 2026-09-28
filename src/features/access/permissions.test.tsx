import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
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

interface SeedAccount { email: string; version: number; userType: string }
const anyAccount = (userType: string): SeedAccount => {
  const found = Object.values(store.db.accounts as unknown as Record<string, SeedAccount>).find(a => a.userType === userType);
  if (!found) throw new Error(`no seeded account with userType "${userType}"`);
  return found;
};

beforeEach(async () => {
  store.reset('social');
  queryClient.clear();
  const admin = anyAccount('admin');
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'Qnipay@123' }) });
  const s = (await r.json()) as { token: string };
  setToken(s.token);
});
afterEach(() => setToken(null));

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
  server.use(http.put('/api/v1/user-types/:id/capabilities/:cap', () => HttpResponse.json({ code: 'fault', message: 'The server could not complete that. Nothing has been changed.', next: 'Try again.' }, { status: 500 })));
  await userEvent.click(cell);
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(screen.getByTestId(tid.access.cell('proxy', 'employee'))).toHaveAttribute('aria-pressed', was ?? 'false');
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

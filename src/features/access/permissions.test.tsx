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
  mount();
  await screen.findByTestId(tid.access.table);
  expectTestIdCoverage();
});

/* Row/NavLink ruling (reviewer M8): the coverage check scans document.body,
   so it sees the dialog Radix portals outside the page, and its open select. */
test('the exceptions dialog, open with its capability list showing, has full test id coverage', async () => {
  const emp = anyAccount('employee');
  mount();
  await userEvent.click(await screen.findByTestId(tid.access.exceptionAdd(emp.email)));
  await screen.findByTestId(tid.modal.root);
  await userEvent.click(screen.getByTestId(tid.access.exceptionCap));
  await screen.findByTestId(`${tid.access.exceptionCap}-option-proxy`);
  expectTestIdCoverage();
});

/* I7: the row groups come from the contract (GET /capability-groups), not
   from an import of the seed, and keep the prototype's order. */
test('the matrix groups its rows under the groups the server sends, in order', async () => {
  mount();
  await screen.findByTestId(tid.access.table);
  const groups = screen.getAllByTestId(/^access-group-row-/).map(r => r.getAttribute('data-testid'));
  expect(groups).toEqual([tid.access.groupRow('own'), tid.access.groupRow('team'), tid.access.groupRow('cfg')]);
  expect(screen.getByTestId(tid.access.groupRow('cfg'))).toHaveTextContent('Configuration');
});

test('a failed save shows the refusal and leaves the cell as it was', async () => {
  mount();
  const cell = await screen.findByTestId(tid.access.cell('proxy', 'employee'));
  const was = cell.getAttribute('aria-pressed');
  server.use(http.put('/api/v1/user-types/:id/capabilities/:capability', () => HttpResponse.json(FAULT_BODY, { status: 500 })));
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
  server.use(http.delete('/api/v1/users/:email/exceptions/:capability', () => HttpResponse.json(FAULT_BODY, { status: 500 })));
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
  const users = await screen.findByTestId(tid.access.usersTable);
  const row = within(users).getByTestId(tid.access.userRow(emp.email));
  expect(within(row).getByTestId(tid.access.exceptions(emp.email))).toHaveTextContent('Employee + 1 exception');
});

/* Field.tsx clones an injected id/aria-describedby/aria-required/aria-invalid
   onto its child, assuming a plain input; SelectBox must forward all of them
   to the real trigger button (src/ui/Select.tsx) or a required field's hint
   and required state never reach assistive tech. The exceptions modal's
   Capability picker is Field's one required SelectBox in the running app. */
test('the required Capability picker carries its hint and required state to assistive tech', async () => {
  const emp = anyAccount('employee');
  mount();
  await userEvent.click(await screen.findByTestId(tid.access.exceptionAdd(emp.email)));
  const trigger = await screen.findByTestId(tid.access.exceptionCap);
  expect(trigger).toHaveAttribute('aria-required', 'true');
  const describedBy = trigger.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy ?? '')).toHaveTextContent(/template/i);
});

/* M2: a matrix cell names what it controls, for whom, and its state. */
test('each matrix cell is named by capability, user type and state', async () => {
  mount();
  const cell = await screen.findByTestId(tid.access.cell('proxy', 'employee'));
  expect(cell).toHaveAccessibleName('Enter time on behalf of someone, Employee: not granted');
  expect(screen.getByTestId(tid.access.cell('perm_cfg', 'admin'))).toHaveAccessibleName('Permissions and role configuration, Admin: granted, locked');
});

/* M3: a second click while the first save is in flight sends nothing, so the
   same If-Match can never go twice. */
const slow = (method: string, path: string) =>
  fetch('/api/_dev/faults', { method: 'POST', body: JSON.stringify({ method, path, latencyMs: 300, times: 1 }) });
function countRequests(method: string, fragment: string) {
  const seen: string[] = [];
  server.events.on('request:start', ({ request }) => { if (request.method === method && request.url.includes(fragment)) seen.push(request.url); });
  return seen;
}

test('a double click on a matrix cell sends one save, and the column waits until it lands', async () => {
  mount();
  const cell = await screen.findByTestId(tid.access.cell('proxy', 'employee'));
  await slow('PUT', '/api/v1/user-types/employee/capabilities/proxy');
  const sent = countRequests('PUT', '/user-types/employee/');
  await userEvent.click(cell);
  await waitFor(() => expect(cell).toBeDisabled());
  expect(screen.getByTestId(tid.access.cell('own_ts', 'employee'))).toBeDisabled();
  await userEvent.click(cell);
  await waitFor(() => expect(cell).toHaveAttribute('aria-pressed', 'true'));
  expect(cell).toBeEnabled();
  expect(sent).toHaveLength(1);
  server.events.removeAllListeners();
});

test('a double click on Remove sends one request', async () => {
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
  const remove = await screen.findByTestId(tid.access.exceptionRemove(emp.email, 'proxy'));
  await slow('DELETE', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions/proxy`);
  const sent = countRequests('DELETE', '/exceptions/proxy');
  await userEvent.click(remove);
  await waitFor(() => expect(remove).toBeDisabled());
  expect(screen.getByTestId(tid.access.exceptionSave)).toBeDisabled();
  await userEvent.click(remove);
  await waitFor(() => expect(screen.queryByTestId(tid.access.exceptionRemove(emp.email, 'proxy'))).not.toBeInTheDocument());
  expect(sent).toHaveLength(1);
  server.events.removeAllListeners();
});

/* AFFORDANCE CONVENTION: "Permissions carries the security caveat as a caution". */
test('the page carries its security caveat as a standing caution', async () => {
  mount();
  const caution = await screen.findByTestId(tid.access.caution);
  expect(caution).toHaveAttribute('role', 'note');
  expect(caution).toHaveTextContent(/apply to everyone at once/);
  expect(caution).toHaveTextContent(/server enforces/);
});

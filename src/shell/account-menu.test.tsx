import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { faults } from '@/mocks/faults';
import { queryClient } from '@/api/query';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { App } from '@/App';

/* I5: the account menu names the account and, for a holder of perm_cfg,
   offers one person per role to look at the app as (prototype drawMenu,
   qnipay-workforce-v15.html:10765-10790). I3: a failed start or end of
   view-as is toasted and changes nothing. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => { faults.length = 0; store.reset('social'); queryClient.clear(); });
afterEach(() => { setToken(null); server.resetHandlers(); toast.dismiss(); });

interface SeedAccount { email: string; userType: string; personCode: string }
const anyAccount = (type: string): SeedAccount => {
  const found = Object.values(store.db.accounts as unknown as Record<string, SeedAccount>).find(a => a.userType === type);
  if (!found) throw new Error(`no seeded account with userType "${type}"`);
  return found;
};
async function signedInAs(type: string): Promise<{ account: SeedAccount; token: string }> {
  const account = anyAccount(type);
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  setToken(token);
  return { account, token };
}
const fault = (method: string, path: string, status = 500) =>
  fetch('/api/_dev/faults', { method: 'POST', body: JSON.stringify({ method, path, status, times: 1 }) });
async function openMenu() {
  await userEvent.click(await screen.findByTestId(tid.shell.account));
  return screen.findByTestId(tid.shell.menuAccount);
}

test('the menu names the account you are on: name, email, role, location and ID, and a Your account line', async () => {
  const { account } = await signedInAs('admin');
  render(<App />);
  const header = await openMenu();
  expect(header).toHaveTextContent('Dee Fitzgerald');
  expect(header).toHaveTextContent(account.email);
  expect(header).toHaveTextContent(new RegExp(`Admin · .+ · ${account.personCode}`));
  expect(screen.getByText('Your account')).toBeInTheDocument();
  expect(screen.getByTestId(tid.shell.menuRole)).toHaveTextContent('Admin');
  expect(screen.getByTestId(tid.shell.menuRole)).toHaveTextContent('Configure how this workforce operates');
});

test('a holder of perm_cfg is offered at most five people, one per role, never themselves, with full test id coverage', async () => {
  const { account } = await signedInAs('admin');
  render(<App />);
  await openMenu();
  expect(screen.getByText('Look at the app as somebody else')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByTestId(/^shell-view-as-/).length).toBeGreaterThan(0));
  const offered = screen.getAllByTestId(/^shell-view-as-/).filter(el => el.getAttribute('data-testid') !== tid.shell.viewAsEnd);
  expect(offered.length).toBeLessThanOrEqual(5);
  expect(offered.map(el => el.getAttribute('data-testid'))).not.toContain(tid.shell.viewAs(account.personCode));
  expect(screen.getByTestId(tid.shell.viewAs(anyAccount('manager').personCode))).toHaveTextContent('Manager');
  expectTestIdCoverage();
});

/* IDENTITY AND SIGN-IN: "A manager is not offered as somebody to view as"
   (the prototype asks this as an employee, whose menu offers nobody). */
test('an employee\'s menu offers nobody to view as, and never asks for the list', async () => {
  const asked: string[] = [];
  server.events.on('request:start', ({ request }) => { if (request.url.includes('/view-as/people')) asked.push(request.url); });
  await signedInAs('employee');
  render(<App />);
  await openMenu();
  expect(screen.queryByText('Look at the app as somebody else')).not.toBeInTheDocument();
  expect(screen.queryAllByTestId(/^shell-view-as-/)).toEqual([]);
  expect(asked).toEqual([]);
  server.events.removeAllListeners();
});

test('choosing a person starts view-as; the menu then names them and offers only the way back', async () => {
  await signedInAs('admin');
  const manager = anyAccount('manager');
  render(<App />);
  await openMenu();
  await userEvent.click(await screen.findByTestId(tid.shell.viewAs(manager.personCode)));
  expect(await screen.findByTestId(tid.shell.viewAsEnd)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Rachel Hussain');
  await openMenu();
  expect(screen.getByText(/Looking at the app as Rachel Hussain/)).toBeInTheDocument();
  expect(screen.getByTestId(tid.shell.menuAccount)).toHaveTextContent('Dee Fitzgerald');
  expect(screen.queryByText('Look at the app as somebody else')).not.toBeInTheDocument();
  expectTestIdCoverage();
  await userEvent.click(screen.getByTestId(tid.shell.menuViewAsEnd));
  await waitFor(() => expect(screen.queryByTestId(tid.shell.viewAsEnd)).not.toBeInTheDocument());
});

test('a failed start of view-as is toasted and leaves the session as it was', async () => {
  await signedInAs('admin');
  const manager = anyAccount('manager');
  render(<App />);
  await openMenu();
  const person = await screen.findByTestId(tid.shell.viewAs(manager.personCode));
  await fault('POST', '/api/v1/session/view-as');
  await userEvent.click(person);
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(screen.queryByTestId(tid.shell.viewAsEnd)).not.toBeInTheDocument();
  expect(screen.getByTestId(tid.shell.rolePill)).toHaveTextContent('Admin');
});

test('a failed "Return to my account" is toasted, not silent, and the view stays as it was', async () => {
  const { token } = await signedInAs('admin');
  const employee = anyAccount('employee');
  await fetch('/api/v1/session/view-as', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ personCode: employee.personCode }) });
  render(<App />);
  const back = await screen.findByTestId(tid.shell.viewAsEnd);
  await fault('DELETE', '/api/v1/session/view-as');
  await userEvent.click(back);
  const t = await screen.findByTestId(tid.toast.error);
  expect(t).toHaveTextContent('Nothing has been changed');
  expect(within(t).getByTestId(tid.toast.next)).toHaveTextContent('Try again');
  expect(screen.getByTestId(tid.shell.viewAsEnd)).toBeInTheDocument();
  expect(screen.getByTestId(tid.shell.rolePill)).toHaveTextContent('Employee');
});

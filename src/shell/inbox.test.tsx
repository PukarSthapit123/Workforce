import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { accountOf, audits, resetTo, signInAs } from '@/test/api-helpers';
import { Shell } from './Shell';

/* The bell and its inbox (brief D9, Review Focus 4), on the social seed: the
   prototype's per-role feeds, copied to each account of that role. */
withFakeServer();
beforeEach(() => resetTo('social'));
interface Row { id: string; personId: string; read: boolean; title: string }
const rows = (personId: string) => Object.values(store.coll<Row>('notifications')).filter(n => n.personId === personId);
const openBell = async () => {
  await userEvent.click(await screen.findByTestId(tid.shell.bell));
  return screen.findByTestId(tid.inbox.panel);
};

test('the bell shows the real unread count and the panel lists my items, newest first, with full test id coverage', async () => {
  await signInAs('manager');
  renderPage(<Shell />, '/team/tpeople');
  expect(await screen.findByTestId(tid.shell.bellCount)).toHaveTextContent('5');
  expect(screen.getByTestId(tid.shell.bell)).toHaveAccessibleName('Notifications, 5 unread');
  const panel = await openBell();
  await waitFor(() => expect(within(panel).getAllByRole('link')).toHaveLength(6));
  const titles = within(panel).getAllByRole('link').map(a => a.textContent ?? '');
  expect(titles[0]).toMatch(/^Unread\. 3 timesheets awaiting your approval/);
  expect(titles[0]).toMatch(/Timesheet · Approvals/);
  expect(titles[0]).toMatch(/4h/);
  expectTestIdCoverage(document.body);
});

test('opening an item marks it read and goes to its page; the count follows the server', async () => {
  await signInAs('manager');
  renderPage(<Shell />, '/team/tpeople');
  const panel = await openBell();
  const item = within(panel).getAllByRole('link').find(a => /Coverage issue/.test(a.textContent ?? ''));
  if (!item) throw new Error('no coverage item');
  expect(item).toHaveAttribute('href', '/team/trota');
  await userEvent.click(item);
  await waitFor(() => expect(screen.getByTestId(tid.page('trota'))).toBeInTheDocument());
  expect(screen.queryByTestId(tid.inbox.panel)).toBeNull();
  expect(await screen.findByText('Opened from your notifications: Coverage issue · Willow House.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId(tid.shell.bellCount)).toHaveTextContent('4'));
  expect(rows('CP-1001').find(n => n.title.startsWith('Coverage issue'))?.read).toBe(true);
  expect(audits().filter(a => a.act === 'Notification read')).toHaveLength(1);
});

test('an item whose page I cannot reach is shown without a link; Mark all read clears the count', async () => {
  await signInAs('admin');
  const admin = accountOf('admin').personCode;
  /* the admin's Timesheet destination, Payroll (ipay), is not built yet */
  store.coll('notifications').ntf_test_home = { id: 'ntf_test_home', version: 1, updatedAt: '2026-08-13T14:30:00.000Z', personId: admin, area: 'Timesheet',
    title: 'Approval delegated to you', body: 'Covering Rachel Hussain', at: '2026-08-13T14:00:00.000Z', read: false };
  const unread = rows(admin).filter(n => !n.read).length;
  renderPage(<Shell />, '/setup/asetup');
  expect(await screen.findByTestId(tid.shell.bellCount)).toHaveTextContent(String(unread));
  const panel = await openBell();
  const plain = await within(panel).findByTestId(tid.inbox.item('ntf_test_home'));
  expect(plain.tagName).toBe('DIV');
  expect(within(plain).queryByTestId(tid.inbox.dest('ntf_test_home'))).toBeNull();
  expect(within(panel).getAllByRole('link').every(a => a.getAttribute('href') !== null)).toBe(true);
  await userEvent.click(within(panel).getByTestId(tid.inbox.markAll));
  await waitFor(() => expect(screen.queryByTestId(tid.shell.bellCount)).toBeNull());
  expect(rows(admin).every(n => n.read)).toBe(true);
  expect(within(panel).getByTestId(tid.inbox.markAll)).toBeDisabled();
});

test('a link to a page I cannot open, or to no page at all, says so in the page frame', async () => {
  await signInAs('employee');
  const first = renderPage(<Shell />, '/setup/aperm');
  expect(await screen.findByTestId(tid.unavailable.root)).toHaveTextContent('Permissions is not available to you.');
  expect(screen.getByTestId(tid.unavailable.home)).toHaveAttribute('href', '/work/home');
  first.unmount();
  renderPage(<Shell />, '/work/nonsense');
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  expect(screen.getByTestId(tid.unavailable.root)).toHaveTextContent('There is no page at /work/nonsense.');
});

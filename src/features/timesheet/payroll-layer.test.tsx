import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import type { TimesheetDay, WeekDay } from '@/contract/timesheets';
import { POSTING_STEP } from '@/domain/approvals';
import { renderPage, withFakeServer } from '@/test/render-page';
import { FROZEN, resetTo } from '@/test/api-helpers';
import { TeamTimesheetsPage } from './TeamTimesheetsPage';
import { dayChip } from './DayView';
import { statePill } from './team';

/* Module 8 group 4: the Timesheet chain's payroll layer. On the qnipay seed,
   Pukar Sthapit (EMP001) is the line manager at Manchester and Eddie Harford
   (EMP006) an administrator, who holds "Approve timesheets for payroll". */
withFakeServer();
const BIGYAN = 'tsd_EMP004_2026-08-12', BIJAY = 'tsd_EMP005_2026-08-11';
async function signIn(email: string) {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error('sign-in failed');
  setToken(body.token);
}
beforeEach(() => {
  resetTo('qnipay');
  /* the chain with a payroll layer on every timesheet, and Bigyan's day signed off by his line manager */
  const step = (role: string, scope: string, sla: string) => ({ module: 'Timesheet', role, scope, when: 'Every timesheet', sla, fixed: false });
  store.coll('approvalChains').chain_timesheet = { id: 'chain_timesheet', version: 1, updatedAt: FROZEN, module: 'Timesheet',
    steps: [step('Line manager', 'Own department', '24 hours'), step('Payroll', 'All departments', '48 hours'), POSTING_STEP] };
  const d = store.coll<TimesheetDay>('timesheetDays')[BIGYAN];
  if (!d) throw new Error('no day');
  d.state = 'mgrok';
  d.version = 2;
  d.history = [...d.history, { from: 'pend', to: 'mgrok', by: { personCode: 'EMP001', name: 'Pukar Sthapit' }, at: FROZEN, reason: '', layer: 'Line manager' }];
});

test('mgrok reads "Approved by manager, waiting on payroll" on the pill and the day chip', () => {
  expect(statePill('mgrok').label).toBe('Approved by manager, waiting on payroll');
  const day = { date: '2026-08-12', record: null, state: 'mgrok', version: 2, minutes: 450, future: false, locked: false, lockNote: '', flags: [] } satisfies WeekDay;
  expect(dayChip(day).label).toBe('Approved by manager, waiting on payroll');
});

test('the payroll holder\'s queue holds the day waiting on payroll, and their approval queues the posting', async () => {
  await signIn('eddie.harford@dogmagroup.co.uk');
  renderPage(<TeamTimesheetsPage />);
  const row = await screen.findByTestId(tid.tteam.row(BIGYAN));
  expect(within(row).getByTestId(tid.tteam.state(BIGYAN))).toHaveTextContent('Approved by manager, waiting on payroll');
  expect(screen.queryByTestId(tid.tteam.row(BIJAY))).toBeNull();
  expect(screen.getByTestId(tid.tteam.pending)).toHaveTextContent('1 timesheet awaiting your decision');
  expect(screen.getByTestId(tid.tteam.pending)).toHaveTextContent('The approval SLA for this layer is 48 hours.');
  expect(screen.getByTestId(tid.tteam.filter('mgrok'))).toHaveTextContent('Waiting on payroll · 1');
  await userEvent.click(within(row).getByTestId(tid.tteam.approve(BIGYAN)));
  expect(await screen.findByText('Approved · Bigyan Poudel · queued for Business Central')).toBeInTheDocument();
  await waitFor(() => expect(store.coll<TimesheetDay>('timesheetDays')[BIGYAN]?.state).toBe('ok'));
});

test('the line manager sees the day waiting on payroll, with nothing left for them to decide on it', async () => {
  await signIn('pukar.sthapit@dogmagroup.co.uk');
  renderPage(<TeamTimesheetsPage />);
  await screen.findByTestId(tid.tteam.row(BIJAY));
  expect(screen.queryByTestId(tid.tteam.row(BIGYAN))).toBeNull();
  await userEvent.click(screen.getByTestId(tid.tteam.filter('mgrok')));
  const row = await screen.findByTestId(tid.tteam.row(BIGYAN));
  expect(row).toHaveTextContent('Approved by manager, waiting on payroll');
  expect(within(row).queryByTestId(tid.tteam.approve(BIGYAN))).toBeNull();
});

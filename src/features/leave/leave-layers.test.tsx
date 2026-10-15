import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import type { LeaveRequestRecord } from '@/contract/leave';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { FROZEN, resetTo, signInAs } from '@/test/api-helpers';
import { LeavePage } from './LeavePage';
import { TeamLeavePage } from './TeamLeavePage';

/* Module 8 group 4B: the Leave chain's later layer. On social, the chain is
   the line manager, then a Service Manager for every request. Rachel
   Hussain, the line manager, has approved Amara Okafor's request for 3-4
   September (lr_3), so it waits on the Service Manager: Dee Fitzgerald, the
   administrator, given "Decide team leave" here. */
withFakeServer();
const WAITING = 'Approved by the line manager, waiting on the Service Manager';
beforeEach(() => {
  resetTo('social');
  const admin = store.coll<{ capabilities: string[] }>('userTypes').admin;
  if (!admin) throw new Error('no admin type');
  admin.capabilities = [...admin.capabilities, 'team_leave'];
  const step = (role: string, scope: string) => ({ module: 'Leave', role, scope, when: 'Every leave request', sla: '5 days', fixed: false });
  store.coll('approvalChains').chain_leave = { id: 'chain_leave', version: 1, updatedAt: FROZEN, module: 'Leave',
    steps: [step('Line manager', 'Own department'), step('Service Manager', 'All departments')] };
  const r = store.coll<LeaveRequestRecord>('leaveRequests').lr_3;
  if (!r) throw new Error('no lr_3');
  r.version = 2;
  r.history = [...r.history, { from: 'pending', to: 'pending', by: { employeeCode: 'CP-1001', name: 'Rachel Hussain' }, at: FROZEN, reason: '', layer: 'Line manager' }];
  store.save();
});
const toasts = () => screen.queryAllByTestId(tid.toast.info).map(t => t.textContent ?? '').join(' | ');

test('the Service Manager sees the request at their layer, with who approved the one before, and approves it', async () => {
  await signInAs('admin');
  renderPage(<TeamLeavePage />, '/team/tleave');
  const card = await screen.findByTestId(tid.tleave.card('lr_3'));
  expect(within(card).getByTestId(tid.tleave.layer('lr_3'))).toHaveTextContent('Layer 2 of 2 · Service Manager. Approved by Rachel Hussain as the line manager.');
  expect(screen.queryByTestId(tid.tleave.layer('lr_1'))).toBeNull();
  expectTestIdCoverage(document.body);
  await userEvent.click(within(card).getByTestId(tid.tleave.approve('lr_3')));
  await waitFor(() => expect(toasts()).toMatch(/^Amara’s leave approved/));
  expect(store.coll<LeaveRequestRecord>('leaveRequests').lr_3?.state).toBe('approved');
});

test('the line manager no longer sees it; their approval of another request passes it to the Service Manager', async () => {
  await signInAs('manager');
  renderPage(<TeamLeavePage />, '/team/tleave');
  const card = await screen.findByTestId(tid.tleave.card('lr_2'));
  expect(screen.queryByTestId(tid.tleave.card('lr_3'))).toBeNull();
  expect(within(card).getByTestId(tid.tleave.layer('lr_2'))).toHaveTextContent('Layer 1 of 2 · Line manager.');
  await userEvent.click(within(card).getByTestId(tid.tleave.approve('lr_2')));
  await waitFor(() => expect(toasts()).toMatch('Rosa’s request approved by you. It now waits on the Service Manager.'));
  await waitFor(() => expect(screen.queryByTestId(tid.tleave.card('lr_2'))).toBeNull());
});

test('the colleague\'s own request reads as waiting on the Service Manager', async () => {
  await signInAs('employee');
  renderPage(<LeavePage />, '/work/leave');
  await screen.findByTestId(tid.leave.cards);
  expect(await screen.findByTestId(tid.leave.state('lr_3'))).toHaveTextContent(WAITING);
});

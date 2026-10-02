import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import type { TimesheetDay } from '@/contract/timesheets';
import type { Person } from '@/contract/people';
import { POSTING_DOT } from '@/domain/timesheet';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo } from '@/test/api-helpers';
import { TeamPeoplePage } from '@/features/people/TeamPeoplePage';
import { TeamTimesheetsPage } from './TeamTimesheetsPage';

/* The qnipay seed at the frozen clock (Thursday 13/08/2026). Pukar Sthapit
   (EMP001) is the manager at Manchester. Waiting on him: Bigyan Poudel
   (12/08), Bijay Shrestha (11/08, a waking night) and Jamir Maharjan (10/08,
   a 9h 30m night). Katherine Hull and Lina
   Townsend are approved; Marty Horst's proxy day was sent back. */
withFakeServer();
beforeEach(async () => {
  resetTo('qnipay');
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pukar.sthapit@dogmagroup.co.uk', password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error('sign-in failed');
  setToken(body.token);
});
const BIGYAN = 'tsd_EMP004_2026-08-12', BIJAY = 'tsd_EMP005_2026-08-11', JAMIR = 'tsd_EMP007_2026-08-10', MARTY = 'tsd_EMP011_2026-08-10', KATHERINE = 'tsd_EMP009_2026-08-10';
const days = () => store.coll<TimesheetDay>('timesheetDays');
const dayOf = (id: string) => {
  const d = days()[id];
  if (!d) throw new Error(`no day ${id}`);
  return d;
};
const move = (personId: string, location: string) => {
  const p = store.coll<Person>('people')[personId];
  if (!p) throw new Error(`no person ${personId}`);
  p.location = location;
};
const openQueue = async () => {
  renderPage(<TeamTimesheetsPage />);
  return screen.findByTestId(tid.tteam.row(BIGYAN));
};

describe('Team timesheets, the day queue', () => {
  test('renders the pending banner and the queue, filters and searches, and has full test id coverage', async () => {
    await openQueue();
    expect(screen.getByTestId(tid.tteam.pending)).toHaveTextContent('3 timesheets awaiting your decision');
    expect(screen.getByTestId(tid.tteam.pending)).toHaveTextContent('The oldest was submitted on 11/08/2026. The approval SLA for this layer is 24 hours.');
    expect(screen.getByTestId(tid.tteam.approveAll)).toHaveTextContent('Review and approve 3 pending');
    expect(screen.getByTestId(tid.tteam.filter('pend'))).toHaveTextContent('Needs approval · 3');
    const bijay = screen.getByTestId(tid.tteam.row(BIJAY));
    expect(bijay).toHaveTextContent('Night · Manchester');
    expect(bijay).toHaveTextContent('STD 9h + WAKING_NIGHT');
    expect(bijay).toHaveTextContent('9h 00m');
    expect(screen.getByTestId(tid.tteam.dot(BIJAY))).toHaveTextContent(POSTING_DOT.none.text);
    expect(screen.queryByTestId(tid.tteam.row(MARTY))).toBeNull();
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.tteam.filter('all')));
    const marty = await screen.findByTestId(tid.tteam.row(MARTY));
    expect(within(marty).getByTestId(tid.tteam.proxyPill(MARTY))).toHaveTextContent('Proxy');
    expect(screen.getByTestId(tid.tteam.state(MARTY))).toHaveTextContent('Sent back');
    expect(screen.getByTestId(tid.tteam.history(MARTY))).toHaveTextContent('(2)');
    expect(screen.getByTestId(tid.tteam.history(MARTY))).toHaveTextContent('Awaiting approval → Sent back · Manish Nepal · "Break times missing. Please add and resubmit."');
    expect(screen.getByTestId(tid.tteam.dot(KATHERINE))).toHaveTextContent(POSTING_DOT.posted.text);
    expect(screen.queryByTestId(tid.tteam.approve(MARTY))).toBeNull();
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.tteam.filter('back')));
    await waitFor(() => expect(screen.queryByTestId(tid.tteam.row(BIGYAN))).toBeNull());
    expect(screen.getByTestId(tid.tteam.row(MARTY))).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.tteam.filter('all')));
    await userEvent.type(screen.getByTestId(tid.tteam.search), 'Bigyan');
    await waitFor(() => expect(screen.queryByTestId(tid.tteam.row(MARTY))).toBeNull());
    expect(screen.getByTestId(tid.tteam.row(BIGYAN))).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId(tid.tteam.search));
    await userEvent.type(screen.getByTestId(tid.tteam.search), 'nobody');
    expect(await screen.findByTestId(tid.tteam.empty)).toHaveTextContent('Nothing matches that filter');
  });

  test('Approve queues the day for Business Central once the server has answered', async () => {
    await openQueue();
    const before = audits().length;
    await userEvent.click(screen.getByTestId(tid.tteam.approve(BIGYAN)));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Approved · Bigyan Poudel · queued for Business Central');
    expect(dayOf(BIGYAN).state).toBe('ok');
    expect(audits()).toHaveLength(before + 1);
    await waitFor(() => expect(screen.queryByTestId(tid.tteam.row(BIGYAN))).toBeNull());
    expect(screen.getByTestId(tid.tteam.pending)).toHaveTextContent('2 timesheets awaiting your decision');
  });

  test('Return needs a reason, then sends the day back with it', async () => {
    await openQueue();
    await userEvent.click(screen.getByTestId(tid.tteam.ret(BIJAY)));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent('Send back for correction');
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.tteam.returnConfirm));
    expect(screen.getByTestId(tid.field.root(tid.tteam.returnReason))).toHaveTextContent('A reason is required.');
    expect(dayOf(BIJAY).state).toBe('pend');
    await userEvent.type(screen.getByTestId(tid.tteam.returnReason), 'The waking night allowance needs a note.');
    await userEvent.click(screen.getByTestId(tid.tteam.returnConfirm));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Sent back with a reason · Bijay Shrestha');
    expect(dayOf(BIJAY)).toMatchObject({ state: 'back', returnReason: 'The waking night allowance needs a note.' });
    await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  });

  test('a return refused 412 reads the queue again and the next attempt sends the fresh version', async () => {
    await openQueue();
    await userEvent.click(screen.getByTestId(tid.tteam.ret(BIJAY)));
    await userEvent.type(await screen.findByTestId(tid.tteam.returnReason), 'Check the finish time.');
    dayOf(BIJAY).version = 2;
    await userEvent.click(screen.getByTestId(tid.tteam.returnConfirm));
    expect(await screen.findByTestId(tid.tteam.returnWarn)).toBeInTheDocument();
    expect(dayOf(BIJAY).state).toBe('pend');
    await userEvent.click(screen.getByTestId(tid.tteam.returnConfirm));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Sent back with a reason · Bijay Shrestha');
    expect(dayOf(BIJAY).state).toBe('back');
  });

  test('a refusal is shown with its message and what to do next, and nothing changes', async () => {
    await openQueue();
    /* the day now belongs to the approver: a manager cannot decide their own (D5) */
    dayOf(JAMIR).personCode = 'EMP001';
    const before = audits().length;
    await userEvent.click(screen.getByTestId(tid.tteam.approve(JAMIR)));
    const warn = await screen.findByTestId(tid.tteam.refusal);
    expect(warn).toHaveTextContent('You cannot approve or return your own timesheet.');
    expect(warn).toHaveTextContent('Ask another approver at your location.');
    expect(dayOf(JAMIR).state).toBe('pend');
    expect(audits()).toHaveLength(before);
  });
});

describe('Team timesheets, bulk approval', () => {
  const openBulk = async () => {
    await openQueue();
    await userEvent.click(screen.getByTestId(tid.tteam.approveAll));
    return screen.findByTestId(tid.modal.root);
  };
  test('the dialog states the scope and needs the tick; a row the approver may no longer decide is held and listed back', async () => {
    /* entered by a manager on Bijay's behalf: flagged for review, never blocked */
    dayOf(BIJAY).captureSource = 'proxy';
    const box = await openBulk();
    expect(screen.getByTestId(tid.modal.title)).toHaveTextContent('Approve 3 timesheets?');
    expect(box).toHaveTextContent('This cannot be undone from here');
    expect(screen.getByTestId(tid.tteam.bulkStat('records'))).toHaveTextContent('3');
    expect(box).toHaveTextContent('Manchester only');
    expect(screen.getByTestId(tid.tteam.bulkStat('people'))).toHaveTextContent('3');
    expect(screen.getByTestId(tid.tteam.bulkStat('hours'))).toHaveTextContent('26h 00m');
    expect(screen.getByTestId(tid.tteam.bulkStat('flagged'))).toHaveTextContent('1');
    expect(screen.getByTestId(tid.tteam.bulkFlagRow(BIJAY))).toHaveTextContent('Bijay Shrestha11/08/2026entered by a manager as proxy');
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.tteam.bulkConfirm));
    expect(screen.getByTestId(tid.tteam.bulkWarn)).toHaveTextContent('Tick the confirmation to continue.');
    expect(dayOf(BIGYAN).state).toBe('pend');

    await userEvent.click(screen.getByTestId(tid.tteam.bulkAck));
    /* Jamir moves to another location after the queue was read: his day is no longer the approver's to decide */
    move('per_EMP007', 'REM');
    const before = audits().length;
    await userEvent.click(screen.getByTestId(tid.tteam.bulkConfirm));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('2 approved · 16h 30m · 2 colleague(s) · queued for Business Central · 1 had exceptions');
    expect([dayOf(BIGYAN).state, dayOf(BIJAY).state, dayOf(JAMIR).state]).toEqual(['ok', 'ok', 'pend']);
    expect(audits()).toHaveLength(before + 1);
    const held = await screen.findByTestId(tid.tteam.held);
    expect(held).toHaveTextContent('1 timesheet held back');
    expect(held).toHaveTextContent('Jamir Maharjan · 10/08/2026: This timesheet belongs to someone outside the people you look after.');
  });

  test('QUEUE_CHANGED approves nothing, the queue is read again, and the next attempt goes through', async () => {
    await openBulk();
    await userEvent.click(screen.getByTestId(tid.tteam.bulkAck));
    dayOf(BIGYAN).version = 2;
    const before = audits().length;
    await userEvent.click(screen.getByTestId(tid.tteam.bulkConfirm));
    const warn = await screen.findByTestId(tid.tteam.refusal);
    expect(warn).toHaveTextContent('The queue changed since you opened it, so nothing was approved.');
    expect(warn).toHaveTextContent('Reload the queue, check it again, then approve.');
    expect([dayOf(BIGYAN).state, dayOf(BIJAY).state, dayOf(JAMIR).state]).toEqual(['pend', 'pend', 'pend']);
    expect(audits()).toHaveLength(before);
    await userEvent.click(screen.getByTestId(tid.tteam.bulkConfirm));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('3 approved');
    expect([dayOf(BIGYAN).state, dayOf(BIJAY).state, dayOf(JAMIR).state]).toEqual(['ok', 'ok', 'ok']);
    await waitFor(() => expect(screen.getByTestId(tid.tteam.clear)).toHaveTextContent('Nothing waiting on you'));
  });
});

describe('Team timesheets, the week matrix', () => {
  test('select people, approve their pending days on the week, and only theirs', async () => {
    await openQueue();
    await userEvent.click(screen.getByTestId(tid.tteam.view('week')));
    const matrix = await screen.findByTestId(tid.tteam.matrix);
    expect(screen.getByTestId(tid.tteam.weekLabel)).toHaveTextContent('Week 33 · employee × day');
    await waitFor(() => expect(screen.getByTestId(tid.tteam.pip('EMP004', 2))).toHaveTextContent('7.5'));
    expect(screen.getByTestId(tid.tteam.pip('EMP004', 2))).toHaveAttribute('data-state', 'pend');
    expect(screen.getByTestId(tid.tteam.pip('EMP009', 0))).toHaveAttribute('data-state', 'ok');
    expect(screen.getByTestId(tid.tteam.pip('EMP011', 0))).toHaveAttribute('data-state', 'back');
    expect(screen.getByTestId(tid.tteam.pip('EMP004', 3))).toHaveTextContent('–');
    expect(within(matrix).queryByTestId(tid.tteam.mxRow('EMP001'))).toBeNull();
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.tteam.approveSelected));
    expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Select at least one person to approve.');

    await userEvent.click(screen.getByTestId(tid.tteam.mxCheck('EMP004')));
    await userEvent.click(screen.getByTestId(tid.tteam.mxCheck('EMP005')));
    const before = audits().length;
    await userEvent.click(screen.getByTestId(tid.tteam.approveSelected));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('2 days approved · 2 employees · queued for Business Central');
    expect([dayOf(BIGYAN).state, dayOf(BIJAY).state, dayOf(JAMIR).state]).toEqual(['ok', 'ok', 'pend']);
    expect(audits()).toHaveLength(before + 1);
    await waitFor(() => expect(screen.getByTestId(tid.tteam.pip('EMP004', 2))).toHaveAttribute('data-state', 'ok'));

    await userEvent.click(screen.getByTestId(tid.tteam.mxAll));
    expect(screen.getByTestId(tid.tteam.mxCheck('EMP007'))).toBeChecked();
  });
});

describe('Proxy entry from a team member’s record', () => {
  const openProxy = async (code: string) => {
    renderPage(<TeamPeoplePage />);
    await userEvent.click(await screen.findByTestId(tid.people.open(code)));
    await userEvent.click(await screen.findByTestId(tid.proxy.open));
    return screen.findByTestId(tid.proxy.banner);
  };
  test('a day submitted for someone is theirs, attributed to the manager, and the toast says so', async () => {
    const banner = await openProxy('EMP005');
    expect(screen.getByTestId(tid.modal.title)).toHaveTextContent('Log time · Bijay Shrestha');
    expect(banner).toHaveTextContent('Recorded as a proxy entry against EMP005 and attributed to you. Bijay is notified.');
    const start = await screen.findByTestId(tid.dayForm.field('start'));
    expectTestIdCoverage(document.body);
    fireEvent.change(start, { target: { value: '07:00' } });
    fireEvent.change(screen.getByTestId(tid.dayForm.field('finish')), { target: { value: '15:00' } });
    await userEvent.click(screen.getByTestId(tid.proxy.submitDay));
    expect(await screen.findByTestId(tid.toast.info))
      .toHaveTextContent('Submitted for Bijay Shrestha on their behalf · 13/08/2026 · 08:00 · attributed to you · Bijay notified');
    expect(dayOf('tsd_EMP005_2026-08-13')).toMatchObject({ state: 'pend', captureSource: 'proxy', enteredBy: 'EMP001', personCode: 'EMP005' });
    await waitFor(() => expect(screen.queryByTestId(tid.proxy.banner)).toBeNull());
  });

  test('the week grid is seeded from the team member’s timesheet, not the manager’s, and submits for them', async () => {
    await openProxy('EMP004');
    await userEvent.click(await screen.findByTestId(tid.proxy.view('week')));
    const grid = await screen.findByTestId(tid.week.grid);
    expect(grid).toHaveTextContent('Seeded from Bigyan’s timesheet, not yours.');
    expect(screen.getByTestId(tid.week.cell(0, 2, 'start'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.week.cell(0, 2, 'finish'))).toHaveValue('15:00');
    expectTestIdCoverage(document.body);
    fireEvent.change(screen.getByTestId(tid.week.cell(0, 3, 'start')), { target: { value: '09:00' } });
    fireEvent.change(screen.getByTestId(tid.week.cell(0, 3, 'finish')), { target: { value: '13:00' } });
    await userEvent.click(screen.getByTestId(tid.proxy.submitWeek));
    expect(await screen.findByTestId(tid.toast.info))
      .toHaveTextContent('Week 33 submitted for Bigyan Poudel on their behalf · 1 day · 04:00 · attributed to you · Bigyan notified · 1 day held back');
    expect(dayOf('tsd_EMP004_2026-08-13')).toMatchObject({ state: 'pend', captureSource: 'proxy', enteredBy: 'EMP001' });
  });
});

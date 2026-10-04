import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { CANCELLED_TOAST, halfDaySingle, moreThanLeft, tellManagerToast } from '@/domain/leave';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { LeavePage } from './LeavePage';

/* The qnipay seed at the frozen clock (Thursday 13/08/2026). Bigyan Poudel
   (EMP004), an hourly employee on 40 hours, has 24 days under the Standard
   policy, 9.5 taken, a waiting request for 3-4 September (lr_3), an approved
   one for 17-18 August (lr_5), 6 hours of TOIL to use by 30/09/2026, and
   reports to Manish Nepal. Pukar Sthapit (EMP001) is the manager persona. */
withFakeServer();
beforeEach(() => resetTo('qnipay'));
const signInEmail = async (email: string) => {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${email} failed`);
  setToken(body.token);
};
const BIGYAN = 'bigyan.poudel@dogmagroup.co.uk';
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const set = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const open = async () => {
  renderPage(<LeavePage />, '/work/leave');
  return screen.findByTestId(tid.leave.cards);
};
const openRequest = async () => {
  await userEvent.click(screen.getByTestId(tid.leave.requestOpen));
  return screen.findByTestId(tid.leave.send);
};
const fieldOf = (testId: string) => screen.getByTestId(tid.field.root(testId));

describe('My leave', () => {
  test('balances, days to take, my requests with Cancel on the waiting one, history and the request form, with full test id coverage', async () => {
    await signInEmail(BIGYAN);
    await open();
    expect(screen.getByTestId(tid.leave.annual)).toHaveTextContent('12.5 of 24 days');
    expect(screen.getByTestId(tid.leave.other)).toHaveTextContent('100.00 hours');
    expect(screen.getByTestId(tid.leave.taken)).toHaveTextContent('9.5 days · 76.00 hours');
    expect(screen.getByTestId(tid.leave.pending)).toHaveTextContent('2 days');
    expect(screen.getByTestId(tid.leave.toil)).toHaveTextContent('6 hours · use by 30/09/2026');
    expect(screen.getByTestId(tid.leave.carry)).toHaveTextContent('5 days');
    expect(screen.getByTestId(tid.leave.toTake)).toHaveTextContent('12.5 days to take by 31/03/2027 · 6 hours TOIL expires 30/09/2026');
    expect(screen.getByTestId(tid.leave.request('lr_3'))).toHaveTextContent('03/09/2026 – 04/09/2026 · Annual leave · 2 days');
    expect(screen.getByTestId(tid.leave.state('lr_3'))).toHaveTextContent('Waiting');
    expect(screen.getByTestId(tid.leave.state('lr_5'))).toHaveTextContent('Approved');
    expect(screen.queryByTestId(tid.leave.cancel('lr_5'))).toBeNull();
    expect(screen.getByTestId(tid.leave.ledger('led_001'))).toHaveTextContent('Opening entitlement01/04/2026 · Standard annual leave');
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.leave.tellMgr));
    await expectToast(tellManagerToast('Manish Nepal'), tid.toast.error);
    await openRequest();
    expect(screen.getByTestId(tid.leave.qty)).toHaveValue('2 days · 16.00 hours');
    expect(fieldOf(tid.leave.qty)).toHaveTextContent('10.5 days would remain.');
    expect(screen.getByTestId(tid.leave.sla)).toHaveTextContent('Manish Nepal has 5 days to decide, then it escalates to the');
    expect(screen.getByTestId(tid.leave.sla)).not.toHaveTextContent('rota');
    expectTestIdCoverage(document.body);
  });

  test('a request saves with its summary toast and shows as waiting, with one audit row', async () => {
    await signInEmail(BIGYAN);
    await open();
    await openRequest();
    set(tid.leave.from, '2026-09-14');
    set(tid.leave.to, '2026-09-15');
    await userEvent.type(screen.getByTestId(tid.leave.note), 'Wedding');
    await userEvent.click(screen.getByTestId(tid.leave.send));
    await expectToast('Annual leave requested · 2 days · 16.00 hours · sent to Manish Nepal');
    expect(toasts()).toContain('10.5 days would remain.');
    const row = await screen.findByTestId(tid.leave.request('lr_6'));
    expect(row).toHaveTextContent('14/09/2026 – 15/09/2026 · Annual leave · 2 days');
    expect(within(row).getByTestId(tid.leave.state('lr_6'))).toHaveTextContent('Waiting');
    expect(within(row).getByTestId(tid.leave.cancel('lr_6'))).toBeInTheDocument();
    expect(screen.queryByTestId(tid.leave.send)).toBeNull();
    expect(acts()).toEqual(['Leave requested']);
  });

  test('a half day on two dates is refused with its text inline, and Send stays off', async () => {
    await signInEmail(BIGYAN);
    await open();
    await openRequest();
    await userEvent.click(screen.getByTestId(tid.leave.part));
    await userEvent.click(await screen.findByTestId(`${tid.leave.part}-option-am`));
    /* choosing a morning sets both dates the same */
    expect(screen.getByTestId(tid.leave.to)).toHaveValue('2026-09-03');
    expect(screen.getByTestId(tid.leave.qty)).toHaveValue('0.5 days · 4.00 hours');
    set(tid.leave.to, '2026-09-04');
    expect(fieldOf(tid.leave.qty)).toHaveTextContent(halfDaySingle('am'));
    expect(screen.getByTestId(tid.leave.qty)).toHaveValue('—');
    expect(screen.getByTestId(tid.leave.send)).toBeDisabled();
    expect(acts()).toEqual([]);
  });

  test('more than the balance the server holds is refused inline on the last day, and nothing is written', async () => {
    await signInEmail(BIGYAN);
    await open();
    await openRequest();
    /* another waiting request lands after the page was read, holding back 12 more days */
    const lr3 = store.coll<Record<string, unknown>>('leaveRequests').lr_3;
    store.coll('leaveRequests').lr_99 = { ...lr3, id: 'lr_99', from: '2026-10-05', to: '2026-10-16', qty: 12 };
    store.save();
    set(tid.leave.from, '2026-09-14');
    set(tid.leave.to, '2026-09-15');
    await userEvent.click(screen.getByTestId(tid.leave.send));
    await waitFor(() => expect(fieldOf(tid.leave.to)).toHaveTextContent(moreThanLeft(0.5)));
    expect(screen.getByTestId(tid.leave.send)).toBeInTheDocument();
    expect(Object.keys(store.coll('leaveRequests'))).not.toContain('lr_6');
    expect(acts()).toEqual([]);
  });

  /* review I2: next year's leave draws on next year's balance, not on what is left of this one */
  test('leave in the next leave year is checked against that year, so a short balance this year does not stop it', async () => {
    const lr3 = store.coll<Record<string, unknown>>('leaveRequests').lr_3;
    store.coll('leaveRequests').lr_99 = { ...lr3, id: 'lr_99', from: '2026-10-05', to: '2026-10-16', qty: 12 };
    store.save();
    await signInEmail(BIGYAN);
    await open();
    await openRequest();
    set(tid.leave.from, '2027-04-05');
    set(tid.leave.to, '2027-04-06');
    expect(fieldOf(tid.leave.qty)).toHaveTextContent(/days would remain in the 2027\/28 leave year\./);
    expect(screen.getByTestId(tid.leave.send)).toBeEnabled();
    await userEvent.click(screen.getByTestId(tid.leave.send));
    await expectToast(/Annual leave requested · 2 days/);
    expect(acts()).toEqual(['Leave requested']);
  });

  test('a waiting request is cancelled, with its toast and one audit row', async () => {
    await signInEmail(BIGYAN);
    await open();
    await userEvent.click(screen.getByTestId(tid.leave.cancel('lr_3')));
    await expectToast(CANCELLED_TOAST);
    await waitFor(() => expect(screen.getByTestId(tid.leave.state('lr_3'))).toHaveTextContent('Cancelled'));
    expect(screen.queryByTestId(tid.leave.cancel('lr_3'))).toBeNull();
    expect(screen.queryByTestId(tid.leave.pending)).toBeNull();
    expect(acts()).toEqual(['Leave request cancelled']);
  });

  test('How this was worked out shows the calculation lines and the balance; an employee has no simulation', async () => {
    await signInEmail(BIGYAN);
    await open();
    await userEvent.click(screen.getByTestId(tid.leave.entShow));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent('How Bigyan’s entitlement was worked out');
    expect(screen.getByTestId(tid.leave.entPolicy)).toHaveTextContent('Standard annual leave');
    expect(screen.getByTestId(tid.leave.entLine(0))).toHaveTextContent('24 days');
    expect(screen.getByTestId(tid.leave.entLine(2))).toHaveTextContent('40 h of 37.5 h full time');
    expect(screen.getByTestId(tid.leave.entLine(4))).toHaveTextContent('24 days · 192.00 hours');
    expect(screen.getByTestId(tid.leave.entRemaining)).toHaveTextContent('12.5 days · 100.00 hours');
    expect(screen.getByTestId(tid.leave.entCarry)).toHaveTextContent('5 days');
    expect(screen.queryByTestId(tid.leave.simulate)).toBeNull();
    expectTestIdCoverage(document.body);
  });

  test('a manager simulates an hours change on their own entitlement, and it writes nothing (D3)', async () => {
    await signInAs('manager');
    await open();
    const people = structuredClone(store.coll('people'));
    await userEvent.click(screen.getByTestId(tid.leave.entShow));
    await userEvent.click(await screen.findByTestId(tid.leave.simulate));
    expect(await screen.findByTestId(tid.leave.simNote)).toHaveTextContent('This is a simulation.');
    expect(screen.getByTestId(tid.leave.simBefore)).toHaveTextContent('24 days · 180.00 hours');
    expect(screen.getByTestId(tid.leave.simAfter)).toHaveTextContent('14.4 days · 64.80 hours');
    expect(screen.getByTestId(tid.leave.simChange)).toHaveTextContent('-9.6 days');
    set(tid.leave.simHours, '30');
    expect(screen.getByTestId(tid.leave.simAfter)).toHaveTextContent('19.2 days · 115.20 hours');
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.leave.simClose));
    expect(acts()).toEqual([]);
    expect(store.coll('people')).toEqual(people);
    expect(screen.getByTestId(tid.leave.annual)).toHaveTextContent('24 of 24 days');
  });
});

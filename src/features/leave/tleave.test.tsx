import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { REASON_REQUIRED, SELF_APPROVAL, approvedToast, declinedToast } from '@/domain/leave';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { TeamLeavePage } from './TeamLeavePage';

/* qnipay at the frozen clock (Thursday 13/08/2026): Pukar Sthapit (EMP001),
   the manager persona, decides Bigyan Poudel's (EMP004) waiting request for
   3-4 September (lr_3). Rota is off there, so nothing reaches a rota (D14).
   social has Rota and Leave to rota on: Rachel Hussain (the manager persona)
   decides Priya Shah's escalated request (lr_1), which leaves a day short. */
withFakeServer();
const signInEmail = async (email: string) => {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${email} failed`);
  setToken(body.token);
};
const PUKAR = 'pukar.sthapit@dogmagroup.co.uk';
interface Req { id: string; state: string; personCode: string; reason: string }
const req = (id: string) => store.coll<Req>('leaveRequests')[id];
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const fieldOf = (testId: string) => screen.getByTestId(tid.field.root(testId));
const open = async () => {
  renderPage(<TeamLeavePage />, '/team/tleave');
  await screen.findByTestId(tid.tleave.count);
  await screen.findByTestId(tid.tleave.balances);
};

describe('Team leave on qnipay', () => {
  beforeEach(async () => { resetTo('qnipay'); await signInEmail(PUKAR); });

  test('the waiting request with its balance, cover, stage and SLA, team balances and the leaver, with full test id coverage', async () => {
    await open();
    const card = screen.getByTestId(tid.tleave.card('lr_3'));
    expect(card).toHaveTextContent('Bigyan Poudel');
    expect(card).toHaveTextContent('Annual leave · 03/09/2026 – 04/09/2026 · 2 days');
    expect(within(card).getByTestId(tid.tleave.balance('lr_3'))).toHaveTextContent('of 24 days left');
    expect(within(card).getByTestId(tid.tleave.stage('lr_3'))).toHaveTextContent(/^Stage \d of \d/);
    expect(within(card).getByTestId(tid.tleave.sla('lr_3'))).toBeInTheDocument();
    /* Rota is off on qnipay: no rota link */
    expect(within(card).queryByTestId(tid.tleave.rota('lr_3'))).toBeNull();
    expect(screen.getByTestId(tid.tleave.balanceRow('EMP004'))).toHaveTextContent('Bigyan Poudel');
    expect(await screen.findByTestId(tid.tleave.leaver('EMP008'))).toBeInTheDocument();
    expect(screen.getByTestId(tid.tleave.leaverAction('EMP008'))).toHaveTextContent('The monetary settlement is made in payroll.');
    expect(screen.getByTestId(tid.tleave.leaverAction('EMP008'))).not.toHaveTextContent(/£|\$|€/);
    expectTestIdCoverage(document.body);

    /* a colleague's entitlement, the same dialog My leave opens */
    await userEvent.click(screen.getByTestId(tid.tleave.ent('EMP004')));
    expect(await screen.findByTestId(tid.leave.entRemaining)).toHaveTextContent('12.5 days · 100.00 hours');
    expect(screen.getByTestId(tid.modal.title)).toHaveTextContent('How Bigyan’s entitlement was worked out');
    expectTestIdCoverage(document.body);
  });

  test('approving shows its toast, leaves the queue and writes one audit row', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.tleave.approve('lr_3')));
    await expectToast(approvedToast('Bigyan', false, false));
    await waitFor(() => expect(screen.queryByTestId(tid.tleave.card('lr_3'))).toBeNull());
    expect(req('lr_3')?.state).toBe('approved');
    expect(acts()).toEqual(['Leave approved']);
  });

  test('declining without a reason is refused on the field; with one it is declined and the colleague gets the reason', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.tleave.decline('lr_3')));
    await userEvent.click(await screen.findByTestId(tid.tleave.declineConfirm));
    await waitFor(() => expect(fieldOf(tid.tleave.reason)).toHaveTextContent(REASON_REQUIRED));
    expect(req('lr_3')?.state).toBe('pending');
    expect(acts()).toEqual([]);
    expectTestIdCoverage(document.body);
    await userEvent.type(screen.getByTestId(tid.tleave.reason), 'Two others are already off that week');
    await userEvent.click(screen.getByTestId(tid.tleave.declineConfirm));
    await expectToast(declinedToast('Bigyan'));
    await waitFor(() => expect(screen.queryByTestId(tid.tleave.declineConfirm)).toBeNull());
    expect(req('lr_3')).toMatchObject({ state: 'declined', reason: 'Two others are already off that week' });
    expect(acts()).toEqual(['Leave declined']);
  });

  test('a request that turns out to be the approver\'s own is refused with SELF_APPROVAL and nothing is written', async () => {
    await open();
    /* the request is re-pointed at the manager after the queue was read */
    const r = req('lr_3');
    if (r) r.personCode = 'EMP001';
    store.save();
    await userEvent.click(screen.getByTestId(tid.tleave.approve('lr_3')));
    await waitFor(() => expect(screen.getByTestId(tid.tleave.warn('lr_3'))).toHaveTextContent(SELF_APPROVAL));
    expect(screen.getByTestId(tid.tleave.warn('lr_3'))).toHaveTextContent('Ask another approver at your location.');
    expect(req('lr_3')?.state).toBe('pending');
    expect(acts()).toEqual([]);
  });
});

describe('Team leave on social (Rota and Leave to rota on)', () => {
  beforeEach(async () => { resetTo('social'); await signInAs('manager'); });

  test('the escalated banner and the rota link show; approving says the rota now shows them unavailable', async () => {
    await open();
    expect(screen.getByTestId(tid.tleave.breached)).toHaveTextContent('1 request has breached the 5-day approval SLA');
    expect(screen.getByTestId(tid.tleave.sla('lr_1'))).toHaveTextContent('Escalated · Service Manager');
    expect(screen.getByTestId(tid.tleave.rota('lr_1'))).toHaveAttribute('href', '/team/trota');
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.tleave.short));
    await waitFor(() => expect(screen.queryByTestId(tid.tleave.card('lr_2'))).toBeNull());
    expect(screen.getByTestId(tid.tleave.card('lr_1'))).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.tleave.approve('lr_1')));
    await expectToast(/^Priya’s leave approved\. The rota (now )?shows them unavailable/);
    expect(acts()).toEqual(['Leave approved']);
  });
});

describe('While you are away (1c D8)', () => {
  test('Rachel Hussain sees the cover she has set, read-only; Set cover is for whoever can open Approvals', async () => {
    resetTo('social'); await signInAs('manager');
    await open();
    const card = await screen.findByTestId(tid.away.card);
    expect(within(card).getByTestId(tid.away.row('dlg_1'))).toHaveTextContent('Rachel Hussain → Dee Fitzgerald');
    expect(within(card).getByTestId(tid.away.row('dlg_1'))).toHaveTextContent('24/08/2026 – 31/08/2026 · Timesheet, Leave');
    expect(within(card).queryByTestId(tid.away.cover)).toBeNull();
    expect(card).toHaveTextContent('Cover is set by an administrator in Qnipay setup, under Approvals.');
    expectTestIdCoverage(document.body);
  });
});

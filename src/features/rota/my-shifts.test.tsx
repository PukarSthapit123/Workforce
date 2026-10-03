import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { MyShiftsPage } from './MyShiftsPage';

/* The social seed at the frozen clock (Thursday 13/08/2026). Willow House's
   week of 10 August is published. Sana Iqbal (CP-1455) is a favourite bank
   worker there with no shift that week, so the urgent Late on Friday 14
   August (cov_2) is offered to her. */
withFakeServer();
beforeEach(() => resetTo('social'));
const signInEmail = async (email: string) => {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${email} failed`);
  setToken(body.token);
};
const SANA = 'sana.iqbal@brightpath.org';
interface Week { state: string; lines: Record<string, string[]> }
const whWeek = () => {
  const w = store.coll<Week>('rotaWeeks')['rw_WH_2026-08-10'];
  if (!w) throw new Error('no Willow House week');
  return w;
};
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const open = async () => {
  renderPage(<MyShiftsPage />, '/work/shifts');
  return screen.findByTestId(tid.shifts.cards);
};

describe('My shifts', () => {
  test('a published week shows the next shift, the week, rest days and the open shifts to claim, with full test id coverage', async () => {
    await signInAs('employee');
    await open();
    expect(screen.getByTestId(tid.shifts.published)).toHaveTextContent('Published to 16/08/2026');
    expect(screen.getByTestId(tid.shifts.weekHead)).toHaveTextContent(/^This week · \d+ shifts? · [\d.]+ hours$/);
    expect(screen.getByTestId(tid.shifts.rest)).toHaveTextContent('Off');
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.shifts.outlook));
    await expectToast('Calendar sync is not built yet. No Outlook integration exists in this build.', tid.toast.error);
  });

  test('the open shift is offered with why, Urgent and Claim; who is on my next shift answers from the week', async () => {
    await signInEmail(SANA);
    await open();
    const offer = screen.getByTestId(tid.shifts.offer('cov_2'));
    expect(offer).toHaveTextContent('Fri 14 Aug · Late');
    expect(within(offer).getByTestId(tid.shifts.urgent('cov_2'))).toHaveTextContent('Urgent');
    expect(offer).toHaveTextContent('You are a favourite here, so it is offered to you first');
    expect(screen.getByTestId(tid.shifts.next)).toHaveTextContent('Nothing further scheduled this week.');
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.shifts.whoOn));
    await expectToast('No further shifts this week');
  });

  test('an unpublished week reads Not published yet, with no shift times (D14)', async () => {
    whWeek().state = 'review';
    store.save();
    await signInAs('employee');
    await open();
    expect(screen.getByTestId(tid.shifts.notPublished)).toHaveTextContent('Not published yet.');
    expect(screen.getByTestId(tid.shifts.next)).toHaveTextContent('Not published yet.');
    expect(screen.getByTestId(tid.shifts.weekHead)).toHaveTextContent(/^This week$/);
    expect(screen.getByTestId(tid.shifts.cards)).not.toHaveTextContent(/\d\d:\d\d/);
  });

  test('a claim puts the shift on the week, with one audit row', async () => {
    await signInEmail(SANA);
    await open();
    await userEvent.click(screen.getByTestId(tid.shifts.claim('cov_2')));
    await expectToast('Shift claimed. Your manager will confirm it, and you can log time against it.');
    expect(whWeek().lines['CP-1455']?.[4]).toBe('L');
    expect(acts()).toEqual(['Open shift claimed']);
    await waitFor(() => expect(screen.queryByTestId(tid.shifts.offer('cov_2'))).toBeNull());
    expect(await screen.findByTestId(tid.shifts.day('2026-08-14'))).toHaveTextContent('Fri 14 · Late');
  });

  test('a claim the rules no longer allow is refused with its text, and nothing is written', async () => {
    await signInEmail(SANA);
    await open();
    /* Sana is given an early that Friday after the page was read */
    whWeek().lines['CP-1455'] = ['', '', '', '', 'E', '', ''];
    store.save();
    await userEvent.click(screen.getByTestId(tid.shifts.claim('cov_2')));
    await expectToast('You cannot take that shift. Already working that day.', tid.toast.error);
    expect(store.coll<{ open: boolean }>('coverRequests').cov_2?.open).toBe(true);
    expect(acts()).toEqual([]);
  });
});

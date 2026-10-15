import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, fault, resetTo, signInAs } from '@/test/api-helpers';
import { store } from '@/mocks/store';
import { BusinessCentralPage } from './BusinessCentralPage';

/* social at the frozen clock (Thursday 13/08/2026 15:30): two postings
   posted by the simulated dispatcher (INT-ts4, INT-ts5) and P's failed batch
   posting INT-a1f3, whose unresolved cause (CC-991) fails it on every
   dispatch. Dee Fitzgerald, the administrator, holds integration and mod_cfg,
   so Pay codes is on her nav. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });

const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const open = async (dispatchDelay?: number) => {
  renderPage(dispatchDelay === undefined ? <BusinessCentralPage /> : <BusinessCentralPage dispatchDelay={dispatchDelay} />, '/setup/ibc');
  return screen.findByTestId(tid.ibc.log);
};
const dispatches = () => audits().filter(a => a.act === 'Postings dispatched');

describe('Business Central', () => {
  test('the simulated banner, P\'s tiles, the log with its integration id and attempt, Retry on the failed row only, and the mapping card', async () => {
    const log = await open();
    const banner = screen.getByTestId(tid.ibc.banner);
    expect(banner).toHaveTextContent('Business Central connection');
    expect(banner).toHaveTextContent('Sending postings to Business Central is a future enhancement. Business Central has not confirmed any result here.');
    expect(screen.getByTestId(tid.ibc.tile('posted'))).toHaveTextContent('2');
    expect(screen.getByTestId(tid.ibc.tile('queued'))).toHaveTextContent('0');
    expect(screen.getByTestId(tid.ibc.tile('failed'))).toHaveTextContent('1');
    expect(within(log).getByRole('row', { name: /Integration ID/ })).toHaveTextContent(/Attempt/);
    expect(screen.getByTestId(tid.ibc.row('int_a1f3'))).toHaveTextContent('INT-a1f3');
    expect(screen.getByTestId(tid.ibc.row('int_a1f3'))).toHaveTextContent('Batch WK32 · generic API');
    expect(screen.getByTestId(tid.ibc.attempt('int_a1f3'))).toHaveTextContent('1');
    expect(screen.getByTestId(tid.ibc.state('int_a1f3'))).toHaveTextContent('Failed');
    expect(screen.getByTestId(tid.ibc.state('int_ts4'))).toHaveTextContent('Posted (unconfirmed)');
    expect(document.body).not.toHaveTextContent(/confirmed by Business Central/i);
    /* Retry on the failed row only */
    expect(log.querySelectorAll('[data-testid^="ibc-retry-"]')).toHaveLength(1);
    expect(screen.getByTestId(tid.ibc.retry('int_a1f3'))).toBeInTheDocument();
    /* each code to its element, read only, with Pay codes one step away */
    expect(screen.getByTestId(tid.ibc.mappingRow('STD'))).toHaveTextContent(/STD.*Multiplier on base rate.*PE-STD.*Workforce → Business Central/);
    expect(screen.getByTestId(tid.ibc.mapping)).not.toHaveTextContent('£');
    expect(await screen.findByTestId(tid.ibc.payCodes)).toHaveAttribute('href', '/setup/mpay');
    const mapped = screen.getByTestId(tid.ibc.tile('mapped'));
    expect(mapped.parentElement).toHaveTextContent(`of ${screen.getByTestId(tid.ibc.mapping).querySelectorAll('[data-testid^="ibc-mapping-row-"]').length} codes`);
    expectTestIdCoverage(document.body);
  });

  test('Retry re-queues and counts, its toast never claims acceptance, and queued stays queued until the dispatcher answers', async () => {
    await open(60_000);
    await userEvent.click(screen.getByTestId(tid.ibc.retry('int_a1f3')));
    await waitFor(() => expect(toasts()).toContain('Re-queued. Attempt 2 is waiting on Business Central.'));
    expect(toasts()).not.toMatch(/accepted|posted|confirmed/i);
    expect(screen.getByTestId(tid.ibc.state('int_a1f3'))).toHaveTextContent('Queued');
    expect(screen.getByTestId(tid.ibc.attempt('int_a1f3'))).toHaveTextContent('2');
    expect(screen.getByTestId(tid.ibc.tile('queued'))).toHaveTextContent('1');
    expect(screen.queryByTestId(tid.ibc.retry('int_a1f3'))).toBeNull();
    /* nothing resolves it until the dispatcher runs */
    await new Promise(r => setTimeout(r, 100));
    expect(screen.getByTestId(tid.ibc.state('int_a1f3'))).toHaveTextContent('Queued');
    expect(dispatches()).toEqual([]);
  });

  test('the dispatcher resolves the record on the server\'s answer, with P\'s toast: the unresolved cause fails again, a clean record posts (simulated)', async () => {
    const clean = store.coll<{ state: string; cause?: string; reason?: string }>('integrationAttempts').int_ts5;
    if (clean) clean.state = 'queued';
    await open(20);
    await waitFor(() => expect(toasts()).toContain('Posted · Marcus Reilly · 12/08/2026 · Business Central has not confirmed it yet'));
    expect(screen.getByTestId(tid.ibc.state('int_ts5'))).toHaveTextContent('Posted (unconfirmed)');
    await userEvent.click(screen.getByTestId(tid.ibc.retry('int_a1f3')));
    await waitFor(() => expect(toasts(tid.toast.error)).toContain('Posting failed · Batch WK32 · generic API · Line 2: unknown cost centre CC-991'));
    await waitFor(() => expect(screen.getByTestId(tid.ibc.state('int_a1f3'))).toHaveTextContent('Failed'));
    expect(screen.getByTestId(tid.ibc.attempt('int_a1f3'))).toHaveTextContent('2');
    expect(screen.getByTestId(tid.ibc.retry('int_a1f3'))).toBeInTheDocument();
    expect(dispatches()).toHaveLength(2);
  });

  test('a dispatcher that does not answer leaves the record queued and says so', async () => {
    await open(20);
    await fault('POST', '/api/v1/integration/dispatch', 500);
    await userEvent.click(screen.getByTestId(tid.ibc.retry('int_a1f3')));
    await waitFor(() => expect(toasts(tid.toast.error)).not.toBe(''));
    expect(screen.getByTestId(tid.ibc.state('int_a1f3'))).toHaveTextContent('Queued');
    expect(toasts()).not.toMatch(/Posted/);
  });
});

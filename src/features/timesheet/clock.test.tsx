import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { BREAK_LIMIT } from '@/domain/clock';
import { TimesheetPage } from './TimesheetPage';
import { TeamTimesheetsPage } from './TeamTimesheetsPage';

/* The clock card (module 2b) on the social seed at the frozen clock
   (Thursday 13/08/2026 15:30 London). Amara Okafor (CP-1042, the employee
   persona) is a Shift worker, a clock-mode type; Willow House's published
   rota has her on a Night from 22:00 on Thursday and an Early on Tuesday.
   Her Wednesday is awaiting approval with Rachel Hussain, the manager persona. */
withFakeServer();
beforeEach(() => resetTo('social'));
afterEach(() => { vi.useRealTimers(); });

/* London is on BST in August: 15:30 on the clock every rule reads is 14:30Z. */
const london = (hms: string, date = '2026-08-13') => {
  const [h = 0, m = 0, s = 0] = hms.split(':').map(Number), [y = 0, mo = 0, d = 0] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 1, m, s)).toISOString();
};
const at = (hms: string, date?: string) => store.setClock(london(hms, date));
type Ev = { kind: 'in' | 'breakStart' | 'breakEnd' | 'out'; at: string };
function plant(date: string, events: Ev[], extra: Record<string, unknown> = {}) {
  const id = `clk_CP-1042_${date}`;
  store.coll('clockRecords')[id] = { id, version: 1, updatedAt: events[0]?.at ?? london('07:00', date), personCode: 'CP-1042', date, events,
    late: false, closedLate: null, ...extra };
  store.save();
}
/* A stored draft day for Amara, copied from a seeded one of hers. */
function plantDay(date: string, changes: Record<string, unknown>) {
  const days = store.coll<Record<string, unknown>>('timesheetDays'), id = `tsd_CP-1042_${date}`;
  days[id] = { ...days['tsd_CP-1042_2026-08-03'], id, date, state: 'draft', captureSource: 'clock', history: [], submittedAt: '', ...changes };
  store.save();
}
const tenant = () => {
  const t = store.coll<{ modules: Record<string, boolean>; flags: Record<string, boolean>; extras: { breaksMax: number } }>('tenant').tenant;
  if (!t) throw new Error('no tenant');
  return t;
};
const open = async () => {
  renderPage(<TimesheetPage />);
  return screen.findByTestId(tid.dayForm.field('start'));
};
const toast = (text: string | RegExp) => screen.findByText(text);
const status = () => screen.getByTestId(tid.clock.status);

describe('the clock card', () => {
  beforeEach(async () => { await signInAs('employee'); });

  test('ready to start, then clock in: the running state, the toast, the start from the clock and read-only times, with full test id coverage', async () => {
    await open();
    const card = await screen.findByTestId(tid.clock.card);
    expect(status()).toHaveTextContent('Ready to start. Tap Clock in when you begin your shift.');
    expect(screen.getByTestId(tid.clock.timer)).toHaveTextContent('0:00:00');
    expect(screen.getByTestId(tid.clock.ringPct)).toHaveTextContent('0%');
    expect(screen.getByTestId(tid.clock.ring)).toHaveAttribute('aria-label', '0% of the 9-hour shift');
    expectTestIdCoverage(document.body);
    await userEvent.click(within(card).getByTestId(tid.clock.clockIn));
    expect(await toast('Clocked in. Start time 15:30.')).toBeInTheDocument();
    await waitFor(() => expect(status()).toHaveTextContent('Clocked in. Shift running.'));
    expect(screen.getByTestId(tid.clock.breakStart)).toBeInTheDocument();
    expect(screen.getByTestId(tid.clock.clockOut)).toBeInTheDocument();
    expect(screen.queryByTestId(tid.clock.clockIn)).toBeNull();
    const start = screen.getByTestId(tid.dayForm.field('start')), finish = screen.getByTestId(tid.dayForm.field('finish'));
    await waitFor(() => expect(start).toHaveValue('15:30'));
    expect(start).toHaveAttribute('readonly');
    expect(finish).toHaveAttribute('readonly');
    expect(audits().filter(a => a.entity === 'clockRecord').map(a => a.act)).toEqual(['Clocked in']);
    expectTestIdCoverage(document.body);
  });

  test('the timer ticks on from the read while the shift runs, and the ring fills against the rota line', async () => {
    plant('2026-08-13', [{ kind: 'in', at: london('12:00') }]);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-08-13T14:30:00.000Z'));
    await open();
    await waitFor(() => expect(screen.getByTestId(tid.clock.timer)).toHaveTextContent('3:30:00'));
    expect(screen.getByTestId(tid.clock.ringPct)).toHaveTextContent('39%');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId(tid.clock.timer)).toHaveTextContent('3:30:03');
  });

  test('start a break and resume: each toasts, the timer pauses, and the break is not offered once the cap is reached', async () => {
    await open();
    await userEvent.click(await screen.findByTestId(tid.clock.clockIn));
    await userEvent.click(await screen.findByTestId(tid.clock.breakStart));
    /* the toast and the card's status say the same sentence */
    await waitFor(() => expect(screen.getAllByText('On break. Timer paused.')).toHaveLength(2));
    expect(status()).toHaveTextContent('On break. Timer paused.');
    expect(screen.queryByTestId(tid.clock.breakStart)).toBeNull();
    at('15:45:00');
    await userEvent.click(screen.getByTestId(tid.clock.resume));
    expect(await toast('Break ended and added to your breaks.')).toBeInTheDocument();
    await waitFor(() => expect(status()).toHaveTextContent('Clocked in. Shift running.'));
    expect(screen.getByTestId(tid.clock.timer)).toHaveTextContent('0:00:00');
  });

  test('clock out writes the day: the times appear in the form, editable again, the toast says it is a draft, and Clock in again is offered', async () => {
    await open();
    await userEvent.click(await screen.findByTestId(tid.clock.clockIn));
    await screen.findByTestId(tid.clock.clockOut);
    at('17:45:30');
    await userEvent.click(screen.getByTestId(tid.clock.clockOut));
    expect(await toast('Clocked out and saved as a draft. 2:15:30. Not submitted yet.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(tid.dayForm.field('finish'))).toHaveValue('17:45'));
    expect(screen.getByTestId(tid.dayForm.field('start'))).toHaveValue('15:30');
    expect(screen.getByTestId(tid.dayForm.field('finish'))).not.toHaveAttribute('readonly');
    expect(status()).toHaveTextContent('Clocked out and saved as a draft. Save or submit the day below.');
    expect(screen.getByTestId(tid.clock.again)).toHaveTextContent('Clock in again');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Draft · not submitted');
    expect(store.coll<{ captureSource: string }>('timesheetDays')['tsd_CP-1042_2026-08-13']?.captureSource).toBe('clock');
  });

  test('while the clock runs, the day cannot be saved or submitted, the finish is empty rather than the rota\'s, and the stats wait (review I1)', async () => {
    plant('2026-08-13', [{ kind: 'in', at: london('12:00') }]);
    await open();
    await waitFor(() => expect(screen.getByTestId(tid.dayForm.field('start'))).toHaveValue('12:00'));
    const finish = screen.getByTestId(tid.dayForm.field('finish'));
    expect(finish).toHaveValue('');
    expect(finish).toHaveAttribute('readonly');
    expect(screen.getByTestId(tid.dayForm.save)).toBeDisabled();
    expect(screen.getByTestId(tid.dayForm.submit)).toBeDisabled();
    expect(screen.getByTestId(tid.clock.outFirst)).toHaveTextContent('Clock out first.');
    expect(screen.getByTestId(tid.dayForm.stat('rota'))).not.toHaveTextContent('variance');
    await userEvent.click(screen.getByTestId(tid.clock.clockOut));
    await waitFor(() => expect(screen.getByTestId(tid.dayForm.submit)).toBeEnabled());
    expect(screen.queryByTestId(tid.clock.outFirst)).toBeNull();
  });

  test('a clock still running from an earlier day shows on today\'s view, says since when, and Clock out stops that day\'s clock (review I3)', async () => {
    plant('2026-08-13', [{ kind: 'in', at: london('21:58') }]);
    at('02:00:00', '2026-08-14');
    await open();
    expect(screen.getByTestId(tid.ts.dayLabel)).toHaveTextContent('Fri 14 Aug');
    await waitFor(() => expect(status()).toHaveTextContent('Clocked in. Shift running.'));
    expect(screen.getByTestId(tid.clock.since)).toHaveTextContent('Clocked in since Thu 13 Aug 21:58.');
    /* today's own form is not the clock's, so it stays editable */
    expect(screen.getByTestId(tid.dayForm.field('start'))).not.toHaveAttribute('readonly');
    await userEvent.click(screen.getByTestId(tid.clock.clockOut));
    expect(await toast('Clocked out and saved as a draft. 4:02:00. Not submitted yet.')).toBeInTheDocument();
    expect(store.coll<{ entries: { start: string; finish: string }[] }>('timesheetDays')['tsd_CP-1042_2026-08-13']?.entries[0])
      .toMatchObject({ start: '21:58', finish: '02:00' });
    await waitFor(() => expect(screen.getByTestId(tid.clock.clockIn)).toBeInTheDocument());
  });

  test('after midnight inside the night line, today\'s card says the clock goes on that shift, and clocking in books it there late (review M1)', async () => {
    at('00:10:00', '2026-08-14');
    await open();
    expect(await screen.findByTestId(tid.clock.lineDay)).toHaveTextContent(/^Clocking in now goes on your .+ shift of Thu 13 Aug\.$/);
    await userEvent.click(screen.getByTestId(tid.clock.clockIn));
    expect(await toast('Clocked in. Start time 00:10.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(tid.clock.lineDay)).toHaveTextContent(/^This clock goes on your .+ shift of Thu 13 Aug\.$/));
    expect(store.coll<{ late: boolean }>('clockRecords')['clk_CP-1042_2026-08-13']?.late).toBe(true);
  });

  test('a clock out refused by a day rule offers Clock out at a time you choose, which stops the clock with that finish (review M3)', async () => {
    plant('2026-08-13', [{ kind: 'in', at: london('06:00') }]);
    at('22:30:00');
    await open();
    await userEvent.click(await screen.findByTestId(tid.clock.clockOut));
    const warn = await screen.findByTestId(tid.clock.refusal);
    expect(warn).toHaveTextContent('Net time is 16h 30m, above the 16-hour daily maximum.');
    expect(warn).toHaveTextContent('Use “Clock out at a time you choose” and enter the time you finished.');
    fireEvent.change(screen.getByTestId(tid.clock.chooseFinish), { target: { value: '21:00' } });
    await userEvent.click(screen.getByTestId(tid.clock.choose));
    expect(await toast('Clocked out at 21:00 and saved as a draft. Not submitted yet.')).toBeInTheDocument();
    await waitFor(() => expect(status()).toHaveTextContent('Clocked out and saved as a draft. Save or submit the day below.'));
    expect(screen.queryByTestId(tid.clock.refusal)).toBeNull();
    expect(screen.queryByTestId(tid.clock.choose)).toBeNull();
  });

  test('after Clock in again, the running form shows the start the person corrected, not the first clock in (review I4)', async () => {
    plant('2026-08-13', [{ kind: 'in', at: london('07:10') }, { kind: 'out', at: london('12:00') }, { kind: 'in', at: london('13:00') }], { written: { breaks: [] } });
    plantDay('2026-08-13', { entries: [{ start: '07:00', finish: '12:00', breaks: [], fields: {} }] });
    await open();
    await waitFor(() => expect(status()).toHaveTextContent('Clocked in. Shift running.'));
    await waitFor(() => expect(screen.getByTestId(tid.dayForm.field('start'))).toHaveValue('07:00'));
  });

  test('a refusal is shown with what to do next, and nothing is written', async () => {
    plant('2026-08-13', [{ kind: 'in', at: london('07:00') }, { kind: 'breakStart', at: london('10:00') }, { kind: 'breakEnd', at: london('10:15') }]);
    tenant().extras.breaksMax = 1;
    store.save();
    await open();
    await userEvent.click(await screen.findByTestId(tid.clock.breakStart));
    const warn = await screen.findByTestId(tid.clock.refusal);
    expect(warn).toHaveTextContent(BREAK_LIMIT.message);
    expect(warn).toHaveTextContent(BREAK_LIMIT.next);
    expect(store.coll<{ events: unknown[] }>('clockRecords')['clk_CP-1042_2026-08-13']?.events).toHaveLength(3);
    expect(status()).toHaveTextContent('Clocked in. Shift running.');
  });

  test('a late clock in against the published rota line puts a Late pill on the day', async () => {
    at('22:10:00');
    await open();
    expect(screen.queryByTestId(tid.clock.late)).toBeNull();
    await userEvent.click(await screen.findByTestId(tid.clock.clockIn));
    expect(await screen.findByTestId(tid.clock.late)).toHaveTextContent('Late');
  });

  test('a clock left open on an earlier day: the banner asks for the finish, a bad one is refused on the field, and a good one closes it', async () => {
    plant('2026-08-11', [{ kind: 'in', at: london('07:02', '2026-08-11') }]);
    await open();
    const banner = await screen.findByTestId(tid.clock.forgotten);
    expect(banner).toHaveTextContent('You did not clock out on Tue 11 Aug.');
    await userEvent.click(within(banner).getByTestId(tid.clock.close));
    await waitFor(() => expect(screen.getByTestId(tid.clock.finish)).toHaveAttribute('aria-invalid', 'true'));
    expect(store.coll<{ closedLate: unknown }>('clockRecords')['clk_CP-1042_2026-08-11']?.closedLate).toBeNull();
    fireEvent.change(screen.getByTestId(tid.clock.finish), { target: { value: '15:00' } });
    await userEvent.click(screen.getByTestId(tid.clock.close));
    expect(await toast('The clock from Tue 11 Aug is closed and the day saved as a draft. Not submitted yet.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId(tid.clock.forgotten)).toBeNull());
  });

  test('a forgotten clock whose day can no longer be written: the banner says the day is not changed, and closing it frees the clock (review I2)', async () => {
    plant('2026-08-07', [{ kind: 'in', at: london('07:02', '2026-08-07') }]);
    at('13:00:00', '2026-08-10');
    await open();
    const banner = await screen.findByTestId(tid.clock.forgotten);
    expect(banner).toHaveTextContent('You did not clock out on Fri 7 Aug.');
    expect(within(banner).getByTestId(tid.clock.noDay)).toHaveTextContent('Closing the clock does not change the day itself. Rachel Hussain is asked to amend it.');
    fireEvent.change(within(banner).getByTestId(tid.clock.finish), { target: { value: '15:00' } });
    await userEvent.click(within(banner).getByTestId(tid.clock.close));
    expect(await toast('The clock from Fri 7 Aug is closed. The day itself is not changed. Rachel Hussain has been asked to amend it.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId(tid.clock.forgotten)).toBeNull());
    expect(screen.getByTestId(tid.clock.clockIn)).toBeInTheDocument();
  });

  test('with Clock in / out off there is no card and the type records on the day form', async () => {
    tenant().modules.B = false;
    store.save();
    await open();
    await screen.findByTestId(tid.dayForm.submit);
    expect(screen.queryByTestId(tid.clock.card)).toBeNull();
    expect(screen.getByTestId(tid.dayForm.field('start'))).not.toHaveAttribute('readonly');
  });
});

test('a type that does not enter by clock sees no card', async () => {
  await signInAs('manager');
  renderPage(<TimesheetPage />);
  await userEvent.click(await screen.findByTestId(tid.ts.view('day')));
  await screen.findByTestId(tid.dayForm.field('start'));
  expect(screen.queryByTestId(tid.clock.card)).toBeNull();
});

test('Team timesheets marks a clocked day Late and Closed later', async () => {
  plant('2026-08-12', [{ kind: 'in', at: london('07:05', '2026-08-12') }], { late: true, closedLate: { finish: '15:00', at: london('09:00') } });
  await signInAs('manager');
  renderPage(<TeamTimesheetsPage />);
  const id = 'tsd_CP-1042_2026-08-12';
  expect(await screen.findByTestId(tid.clock.queueLate(id))).toHaveTextContent('Late');
  expect(screen.getByTestId(tid.clock.queueClosedLate(id))).toHaveTextContent('Closed later');
});

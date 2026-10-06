import {
  ALREADY_IN, ALREADY_ON_BREAK, BREAK_ENDED, BREAK_LIMIT, BREAK_STARTED, BREAKS_OFF, CLOCK_STATUS, NOT_CLOCKED_IN, NOT_ON_BREAK, ON_BREAK_NOW,
  breaksUsed, clockEntry, clockInAgainProblem, clockState, clockedBreaks, clockedInToast, clockedOutToast, closeFirst, elapsedSeconds, eventsFor, forgottenMessage,
  formatElapsed, isForgotten, isLate, lateNotices, mergeBreaks, moveProblem, ringTarget, type ClockEvent,
} from './clock';

/* London is on BST in August: 06:02Z is 07:02 on the clock every rule reads. */
const at = (hm: string, date = '2026-08-13') => { const [h = 0, m = 0, s = 0] = hm.split(':').map(Number); return new Date(Date.UTC(...ymd(date), h - 1, m, s)).toISOString(); };
function ymd(date: string): [number, number, number] { const [y = 0, mo = 0, d = 0] = date.split('-').map(Number); return [y, mo - 1, d]; }
const ev = (kind: ClockEvent['kind'], hm: string, date?: string): ClockEvent => ({ kind, at: at(hm, date) });
const ctx = { breaksOn: true, breaksUsed: 0, breaksMax: 5 };

describe('state comes from the events (D1)', () => {
  test('idle, running, on break, clocked out, and a closed forgotten clock reads as clocked out', () => {
    expect(clockState([])).toBe('idle');
    expect(clockState([ev('in', '07:02')])).toBe('running');
    expect(clockState([ev('in', '07:02'), ev('breakStart', '11:00')])).toBe('onBreak');
    expect(clockState([ev('in', '07:02'), ev('breakStart', '11:00'), ev('breakEnd', '11:30')])).toBe('running');
    expect(clockState([ev('in', '07:02'), ev('out', '15:00')])).toBe('clockedOut');
    expect(clockState([ev('in', '07:02')], true)).toBe('clockedOut');
  });
  test('elapsed counts running spans only, pausing for breaks and the gap before "Clock in again", up to the server now', () => {
    const run = [ev('in', '07:00'), ev('breakStart', '11:00'), ev('breakEnd', '11:30')];
    expect(elapsedSeconds(run, at('12:00:12'))).toBe(4 * 3600 + 30 * 60 + 12);
    expect(elapsedSeconds([...run, ev('breakStart', '12:00')], at('13:00'))).toBe(4.5 * 3600);
    expect(elapsedSeconds([ev('in', '07:00'), ev('out', '09:00'), ev('in', '10:00')], at('10:30'))).toBe(2.5 * 3600);
    expect(elapsedSeconds([ev('in', '07:00')], at('09:00'), true)).toBe(0);
    expect(formatElapsed(7 * 3600 + 58 * 60 + 12)).toBe('7:58:12');
  });
});

describe('the events become the day (D3)', () => {
  test('start from the first clock in, finish from the last clock out, clocked breaks and the gap before "Clock in again" as pairs', () => {
    const events = [ev('in', '07:02'), ev('breakStart', '11:00'), ev('breakEnd', '11:30'), ev('out', '12:00'), ev('in', '13:00'), ev('out', '15:04')];
    expect(clockEntry(events, undefined, 5)).toEqual({ start: '07:02', finish: '15:04', breaks: [{ start: '11:00', end: '11:30' }, { start: '12:00', end: '13:00' }], fields: {} });
    expect(clockEntry([ev('in', '07:02')], undefined, 5, '15:00').finish).toBe('15:00');
  });
  test('the gap before "Clock in again" takes a pair under breaksMax; with none left, clock in again is refused (ruling)', () => {
    const out = [ev('in', '07:00'), ev('breakStart', '10:00'), ev('breakEnd', '10:30'), ev('out', '12:00')];
    expect(clockedBreaks(out)).toEqual([{ start: '10:00', end: '10:30' }]);
    expect(clockInAgainProblem([], out, at('13:00'), 2)).toBeNull();
    expect(clockInAgainProblem([], out, at('13:00'), 1)).toBe(BREAK_LIMIT);
    expect(clockInAgainProblem([], out, at('12:00:40'), 1)).toBeNull();
    expect(clockInAgainProblem([], [ev('in', '07:00')], at('13:00'), 0)).toBeNull();
    expect(clockInAgainProblem([{ start: '09:00', end: '09:10' }], [ev('in', '07:00'), ev('out', '12:00')], at('13:00'), 1)).toBe(BREAK_LIMIT);
  });
  test('an open break and a break inside one minute are not pairs', () => {
    expect(clockedBreaks([ev('in', '07:00'), ev('breakStart', '10:00:05'), ev('breakEnd', '10:00:50'), ev('breakStart', '11:00')])).toEqual([]);
  });
  test('the prototype\'s first-empty-pair rule, no duplicates, capped at breaksMax', () => {
    const blank = { start: '', end: '' }, typed = { start: '09:00', end: '09:10' };
    expect(mergeBreaks([typed, blank], [{ start: '11:00', end: '11:30' }], 5)).toEqual([typed, { start: '11:00', end: '11:30' }]);
    expect(mergeBreaks([typed], [typed, { start: '11:00', end: '11:30' }], 5)).toEqual([typed, { start: '11:00', end: '11:30' }]);
    expect(mergeBreaks([typed], [{ start: '11:00', end: '11:30' }], 1)).toEqual([typed]);
    expect(clockEntry([ev('in', '07:00')], { breaks: [typed], fields: { project: 'P1' } }, 5)).toMatchObject({ breaks: [typed], fields: { project: 'P1' } });
    expect(breaksUsed([typed, blank], [ev('in', '07:00'), ev('breakStart', '11:00'), ev('breakEnd', '11:30')])).toBe(2);
  });
});

describe('the moves (D2)', () => {
  test('clock in only when idle or clocked out', () => {
    expect([moveProblem('idle', 'in', ctx), moveProblem('clockedOut', 'in', ctx)]).toEqual([null, null]);
    expect(moveProblem('running', 'in', ctx)).toBe(ALREADY_IN);
    expect(moveProblem('onBreak', 'in', ctx)).toBe(ON_BREAK_NOW);
  });
  test('break start only while running, with Break tracking on and under the cap', () => {
    expect(moveProblem('running', 'breakStart', ctx)).toBeNull();
    expect(moveProblem('idle', 'breakStart', ctx)).toBe(NOT_CLOCKED_IN);
    expect(moveProblem('onBreak', 'breakStart', ctx)).toBe(ALREADY_ON_BREAK);
    expect(moveProblem('running', 'breakStart', { ...ctx, breaksOn: false })).toBe(BREAKS_OFF);
    expect(moveProblem('running', 'breakStart', { ...ctx, breaksUsed: 5 })).toBe(BREAK_LIMIT);
    expect(BREAK_LIMIT.message).toBe('You have recorded the most breaks this day allows.');
  });
  test('break end only on a break; clock out while running or on a break, ending the break first', () => {
    expect(moveProblem('onBreak', 'breakEnd', ctx)).toBeNull();
    expect(moveProblem('running', 'breakEnd', ctx)).toBe(NOT_ON_BREAK);
    expect([moveProblem('running', 'out', ctx), moveProblem('onBreak', 'out', ctx)]).toEqual([null, null]);
    expect([moveProblem('idle', 'out', ctx), moveProblem('clockedOut', 'out', ctx)]).toEqual([NOT_CLOCKED_IN, NOT_CLOCKED_IN]);
    const now = at('15:00');
    expect(eventsFor('onBreak', 'out', now)).toEqual([{ kind: 'breakEnd', at: now }, { kind: 'out', at: now }]);
    expect(eventsFor('running', 'out', now)).toEqual([{ kind: 'out', at: now }]);
  });
});

describe('late and forgotten (D5, D6)', () => {
  test('late is after the rota line start, to the minute, with no tolerance; no line, no check', () => {
    expect(isLate(at('07:00:59'), { from: '07:00' })).toBe(false);
    expect(isLate(at('07:01'), { from: '07:00' })).toBe(true);
    expect([isLate(at('09:00'), null), isLate(at('09:00'), { from: '' })]).toEqual([false, false]);
    expect(lateNotices('Amara Okafor', '2026-08-13', at('07:12'), '07:00')).toEqual({
      subject: { title: 'Late clock-in', body: 'You clocked in at 07:12 on Thu 13 Aug. Your shift started at 07:00.' },
      actor: { title: 'Late clock-in', body: 'Amara Okafor clocked in at 07:12 on Thu 13 Aug. The shift started at 07:00.' },
    });
  });
  test('an earlier day still running or on break is forgotten once past the daily maximum; a night shift is not', () => {
    const yesterday = (events: ClockEvent[], closed = false) => ({ date: '2026-08-12', events, closed });
    expect(isForgotten(yesterday([ev('in', '07:02', '2026-08-12')]), '2026-08-13', at('09:00'), 16)).toBe(true);
    expect(isForgotten(yesterday([ev('in', '07:02', '2026-08-12'), ev('breakStart', '11:00', '2026-08-12')]), '2026-08-13', at('09:00'), 16)).toBe(true);
    expect(isForgotten(yesterday([ev('in', '22:00', '2026-08-12')]), '2026-08-13', at('06:00'), 16)).toBe(false);
    expect(isForgotten(yesterday([ev('in', '07:02', '2026-08-12'), ev('out', '15:00', '2026-08-12')]), '2026-08-13', at('09:00'), 16)).toBe(false);
    expect(isForgotten(yesterday([ev('in', '07:02', '2026-08-12')], true), '2026-08-13', at('09:00'), 16)).toBe(false);
    expect(isForgotten({ date: '2026-08-13', events: [ev('in', '07:02')] }, '2026-08-13', at('23:59'), 16)).toBe(false);
    expect(forgottenMessage('2026-08-12')).toBe('You did not clock out on Wed 12 Aug.');
    expect(closeFirst('2026-08-12')).toMatchObject({ code: 'CLOCK_OPEN', message: 'Close the clock from Wed 12 Aug first.' });
  });
});

test('the card\'s sentences and toasts are the prototype\'s, as plain sentences', () => {
  expect(clockedInToast(at('07:02'))).toBe('Clocked in. Start time 07:02.');
  expect(clockedOutToast(7 * 3600 + 58 * 60 + 12)).toBe('Clocked out and saved as a draft. 7:58:12. Not submitted yet.');
  expect([BREAK_STARTED, BREAK_ENDED]).toEqual(['On break. Timer paused.', 'Break ended and added to your breaks.']);
  expect(CLOCK_STATUS.clockedOut).toBe('Clocked out and saved as a draft. Save or submit the day below.');
  expect([ringTarget(7.5), ringTarget(0), ringTarget(null)]).toEqual([7.5, 8, 8]);
});

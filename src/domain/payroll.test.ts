import {
  NO_FACTS, NOTHING_APPROVED, NOT_READY, REASON_REQUIRED, bannerText, payPeriodOn, payrollCsv, payrollFileName, periodDates, periodLock, periodOfRun,
  previousPeriod, readinessItems, readinessState, runIdOf, runMoveProblem, type PaySettings, type ReadinessFacts,
} from './payroll';

const S = (payFrequency: string, firstPayDate = '2026-08-21', weekEnding = 'Sunday'): PaySettings => ({ payFrequency, weekEnding, firstPayDate });
const span = (p: { start: string; end: string }) => [p.start, p.end];

describe('the pay period from Organisation\'s settings', () => {
  test('weekly: the seven days ending on the week ending day, whatever the first pay date', () => {
    expect(span(payPeriodOn('2026-08-13', S('Weekly')))).toEqual(['2026-08-10', '2026-08-16']);
    expect(span(payPeriodOn('2026-08-16', S('Weekly')))).toEqual(['2026-08-10', '2026-08-16']);
    expect(span(payPeriodOn('2026-08-17', S('Weekly')))).toEqual(['2026-08-17', '2026-08-23']);
    expect(span(payPeriodOn('2026-08-13', S('Weekly', '', 'Friday')))).toEqual(['2026-08-08', '2026-08-14']);
    expect(span(payPeriodOn('2026-08-13', S('Weekly', '', 'Saturday')))).toEqual(['2026-08-09', '2026-08-15']);
  });
  test('fortnightly: anchored on the period paid on the first pay date, the one ending on the last week ending day before it', () => {
    /* paid Friday 21/08, so the anchor period ends Sunday 16/08 */
    expect(span(payPeriodOn('2026-08-13', S('Fortnightly')))).toEqual(['2026-08-03', '2026-08-16']);
    expect(span(payPeriodOn('2026-08-03', S('Fortnightly')))).toEqual(['2026-08-03', '2026-08-16']);
    expect(span(payPeriodOn('2026-08-17', S('Fortnightly')))).toEqual(['2026-08-17', '2026-08-30']);
    expect(span(payPeriodOn('2026-08-02', S('Fortnightly')))).toEqual(['2026-07-20', '2026-08-02']);
    /* the cycle runs both ways from the anchor */
    expect(span(payPeriodOn('2026-12-01', S('Fortnightly')))).toEqual(['2026-11-23', '2026-12-06']);
    expect(span(payPeriodOn('2026-01-10', S('Fortnightly')))).toEqual(['2026-01-05', '2026-01-18']);
    expect(payPeriodOn('2026-08-13', S('Fortnightly')).anchored).toBe(true);
    /* a different anchor week moves the cycle by a week */
    expect(span(payPeriodOn('2026-08-13', S('Fortnightly', '2026-08-28')))).toEqual(['2026-08-10', '2026-08-23']);
  });
  test('four-weekly: twenty-eight days in the same cycle', () => {
    expect(span(payPeriodOn('2026-08-13', S('Four-weekly')))).toEqual(['2026-07-20', '2026-08-16']);
    expect(span(payPeriodOn('2026-08-17', S('Four-weekly')))).toEqual(['2026-08-17', '2026-09-13']);
    expect(span(payPeriodOn('2026-07-19', S('Four-weekly')))).toEqual(['2026-06-22', '2026-07-19']);
  });
  test('monthly: the calendar month', () => {
    expect(span(payPeriodOn('2026-08-13', S('Monthly')))).toEqual(['2026-08-01', '2026-08-31']);
    expect(span(payPeriodOn('2026-02-28', S('Monthly')))).toEqual(['2026-02-01', '2026-02-28']);
    expect(span(payPeriodOn('2028-02-01', S('Monthly')))).toEqual(['2028-02-01', '2028-02-29']);
  });
  test('without a first pay date a fortnightly cycle is counted from this week and says it is not anchored', () => {
    const p = payPeriodOn('2026-08-13', S('Fortnightly', ''));
    expect([span(p), p.anchored]).toEqual([['2026-08-03', '2026-08-16'], false]);
    expect(payPeriodOn('2026-08-13', S('Weekly', '')).anchored).toBe(true);
    expect(payPeriodOn('2026-08-13', S('Monthly', '')).anchored).toBe(true);
  });
  test('the previous period, the dates, and the run id that names a period', () => {
    const cur = payPeriodOn('2026-08-13', S('Fortnightly'));
    expect(span(previousPeriod(cur, S('Fortnightly')))).toEqual(['2026-07-20', '2026-08-02']);
    expect(span(previousPeriod(payPeriodOn('2026-03-10', S('Monthly')), S('Monthly')))).toEqual(['2026-02-01', '2026-02-28']);
    expect(periodDates(cur)).toHaveLength(14);
    expect(runIdOf(cur)).toBe('run_2026-08-03');
    expect(periodOfRun('run_2026-08-03', S('Fortnightly'))).toMatchObject({ start: '2026-08-03', end: '2026-08-16' });
    /* a day that does not start a period under these settings names none */
    expect(periodOfRun('run_2026-08-10', S('Fortnightly'))).toBeNull();
    expect(periodOfRun('run_2026-02-30', S('Fortnightly'))).toBeNull();
    expect(periodOfRun('nonsense', S('Fortnightly'))).toBeNull();
  });
});

describe('the period lock, next to the cut-off', () => {
  const NOW = { date: '2026-08-13', time: '15:30' };
  test('the previous period is closed once its last week\'s cut-off has passed, and only while the lock is enforced', () => {
    const prev = { start: '2026-07-20', end: '2026-08-02' };
    expect(periodLock(prev, { enforceLock: true, cutoff: 'Monday 12:00' }, NOW)).toEqual({ locked: true, closesAt: { date: '2026-08-03', time: '12:00' } });
    expect(periodLock(prev, { enforceLock: false, cutoff: 'Monday 12:00' }, NOW).locked).toBe(false);
    /* the period ending on Sunday 09/08 closes Monday 10/08 at noon: closed by 13/08, still open at 11:00 on the 10th */
    const last = { start: '2026-08-03', end: '2026-08-09' };
    expect(periodLock(last, { enforceLock: true, cutoff: 'Monday 12:00' }, NOW).locked).toBe(true);
    expect(periodLock(last, { enforceLock: true, cutoff: 'Monday 12:00' }, { date: '2026-08-10', time: '11:00' }).locked).toBe(false);
  });
  test('the current period is never closed, and says when it closes', () => {
    expect(periodLock({ end: '2026-08-16' }, { enforceLock: true, cutoff: 'Tuesday 09:00' }, NOW)).toEqual({ locked: false, closesAt: { date: '2026-08-18', time: '09:00' } });
  });
});

describe('readiness', () => {
  const F = (f: Partial<ReadinessFacts>): ReadinessFacts => ({ ...NO_FACTS, ...f });
  test('every blocker is named, counted and linked to where it is put right', () => {
    const { blockers, warnings } = readinessItems(F({ unanchored: true, missing: 2, awaiting: 3, back: 1, mgrok: 4, failed: 1, critical: 2, uncleared: 1, noResource: 5 }), 'open');
    expect(blockers.map(b => [b.key, b.label, b.count, b.go])).toEqual([
      ['settings', 'Pay periods', 1, 'aorg'], ['missing', 'Missing timesheets', 2, 'tteam'], ['awaiting', 'Pending approvals', 3, 'tteam'],
      ['back', 'Sent back', 1, 'tteam'], ['mgrok', 'Waiting on payroll', 4, 'tteam'], ['failed', 'Posting failures', 1, 'ibc'],
      ['critical', 'Critical exceptions', 2, 'texc'], ['compliance', 'Compliance', 1, 'tpeople'], ['resource', 'No resource number', 5, 'apeople']]);
    expect(warnings).toEqual([]);
    expect(blockers.find(b => b.key === 'mgrok')?.text).toBe('4 timesheet days approved by the manager and waiting on the payroll layer');
    expect(blockers.find(b => b.key === 'resource')?.text).toBe('5 colleagues with hours in this period have no Business Central resource number');
    expect(blockers.find(b => b.key === 'back')?.text).toBe('1 timesheet day sent back and not yet resubmitted');
  });
  test('warnings: postings in flight, unreconciled records until reconciled, open exceptions below critical and unsubmitted days', () => {
    const f = F({ queued: 2, posted: 3, lowerExceptions: 1, drafts: 4 });
    expect(readinessItems(f, 'open').warnings.map(w => [w.key, w.count, w.go])).toEqual([
      ['queued', 2, 'ibc'], ['unreconciled', 3, 'ibc'], ['exceptions', 1, 'texc'], ['drafts', 4, 'tteam']]);
    expect(readinessItems(f, 'open').blockers).toEqual([]);
    expect(readinessItems(f, 'reconciled').warnings.map(w => w.key)).toEqual(['queued', 'exceptions', 'drafts']);
  });
  test('the five states: NOT READY, READY WITH WARNINGS and READY from the data, EXPORTED and RECONCILED from the run', () => {
    expect(readinessState('open', 1, 3)).toBe('notready');
    expect(readinessState('open', 0, 3)).toBe('warnings');
    expect(readinessState('open', 0, 0)).toBe('ready');
    expect(readinessState('exported', 2, 0)).toBe('exported');
    expect(readinessState('reconciled', 2, 2)).toBe('reconciled');
    expect(bannerText('notready', 2, 0)).toBe('2 items must be cleared before this period can be handed over.');
    expect(bannerText('warnings', 0, 1)).toBe('Nothing is blocking the handover, but 1 item should be reviewed first.');
    expect(bannerText('ready', 0, 0)).toBe('No blockers and no warnings. This period can be handed to payroll.');
  });
});

describe('the run\'s moves', () => {
  test('export from open only, refused while NOT READY or with nothing approved', () => {
    expect(runMoveProblem('open', 'export', { state: 'ready', rows: 3 })).toBeNull();
    expect(runMoveProblem('open', 'export', { state: 'warnings', rows: 3 })).toBeNull();
    expect(runMoveProblem('open', 'export', { state: 'notready', rows: 3 })).toBe(NOT_READY);
    expect(NOT_READY.message).toBe('Clear the blockers before exporting.');
    expect(runMoveProblem('open', 'export', { state: 'ready', rows: 0 })).toBe(NOTHING_APPROVED);
    expect(runMoveProblem('exported', 'export', { state: 'ready', rows: 3 })).toMatchObject({ status: 409, code: 'ILLEGAL_TRANSITION' });
  });
  test('reconcile from exported only; reopen from exported or reconciled, with a reason', () => {
    expect(runMoveProblem('exported', 'reconcile')).toBeNull();
    expect(runMoveProblem('open', 'reconcile')).toMatchObject({ status: 409, code: 'ILLEGAL_TRANSITION', message: 'Export before reconciling.' });
    expect(runMoveProblem('reconciled', 'reconcile')).toMatchObject({ status: 409, code: 'ILLEGAL_TRANSITION' });
    expect(runMoveProblem('exported', 'reopen', { reason: 'A late correction' })).toBeNull();
    expect(runMoveProblem('reconciled', 'reopen', { reason: 'A late correction' })).toBeNull();
    expect(runMoveProblem('reconciled', 'reopen', { reason: '  ' })).toBe(REASON_REQUIRED);
    expect(runMoveProblem('open', 'reopen', { reason: 'x' })).toMatchObject({ status: 409, code: 'ILLEGAL_TRANSITION' });
  });
});

test('the file: hours and pay codes, a header row first, no amount', () => {
  const rows = payrollCsv([{ personCode: 'CP-1042', name: 'Amara Okafor', resource: 'R-1042', date: '2026-08-12', shift: 'E', payCode: 'STD',
    element: 'PE-STD', allowances: ['SLEEP_IN'], hours: 7.5, state: 'Approved', posting: 'Posted' }]);
  expect(rows).toEqual([
    ['Employee ID', 'Name', 'Resource no.', 'Date', 'Shift', 'Pay code', 'Pay elements', 'Allowances', 'Hours', 'State', 'Integration'],
    ['CP-1042', 'Amara Okafor', 'R-1042', '12/08/2026', 'E', 'STD', 'PE-STD', 'SLEEP_IN', 7.5, 'Approved', 'Posted']]);
  expect(JSON.stringify(rows)).not.toMatch(/[£$€]|amount|rate|cost/i);
  expect(payrollFileName({ start: '2026-08-03' })).toBe('qnipay-payroll-03-08-2026.csv');
});

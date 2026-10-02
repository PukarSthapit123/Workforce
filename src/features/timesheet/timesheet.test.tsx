import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import type { TimesheetConfig, TimesheetDay, TimesheetWeek } from '@/contract/timesheets';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, caller, resetTo } from '@/test/api-helpers';
import { TimesheetPage } from './TimesheetPage';

/* The qnipay seed at the frozen clock (Thursday 13/08/2026 15:30 London).
   Bigyan Poudel (EMP004) is a Consultant, a grid type, so My timesheet opens
   on the week; he reports to Manish Nepal, has a day awaiting approval on
   Wednesday 12 August and two earlier weeks of drafts in closed periods. */
withFakeServer();
beforeEach(() => resetTo('qnipay'));
const signInEmail = async (email: string) => {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${email} failed`);
  setToken(body.token);
  return body.token;
};
const BIGYAN = 'bigyan.poudel@dogmagroup.co.uk', SANJEEV = 'sanjeev.thakuri@dogmagroup.co.uk';
const dayOf = (code: string, date: string) => store.coll<TimesheetDay>('timesheetDays')[`tsd_${code}_${date}`];
const config = () => {
  const c = store.coll<TimesheetConfig>('timesheetConfig').timesheetConfig;
  if (!c) throw new Error('no timesheet config');
  return c;
};
const set = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const openDay = async () => {
  renderPage(<TimesheetPage />);
  await userEvent.click(await screen.findByTestId(tid.ts.view('day')));
  return screen.findByTestId(tid.dayForm.field('start'));
};
const openWeek = async () => {
  renderPage(<TimesheetPage />);
  return screen.findByTestId(tid.week.grid);
};

describe('My timesheet, day view', () => {
  beforeEach(async () => { await signInEmail(BIGYAN); });
  test('the day view renders today with the type’s capture fields, the guide and full test id coverage', async () => {
    await openDay();
    expect(screen.getByTestId(tid.ts.dayLabel)).toHaveTextContent('Thu 13 Aug');
    expect(screen.getByTestId(tid.ts.dayToday)).toBeDisabled();
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Nothing logged');
    expect(screen.getByTestId(tid.dayForm.field('finish'))).toBeInTheDocument();
    expect(screen.getByTestId(tid.dayForm.group('breaks'))).toHaveTextContent('Breaks');
    expect(screen.queryByTestId(tid.ts.fillRota)).toBeNull();
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.guide.open('ts')));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent('How time capture works');
    expectTestIdCoverage(document.body);
  });
  test('saving a draft stores the day, says it is not submitted, and the form comes back from the server', async () => {
    await openDay();
    set(tid.dayForm.field('start'), '09:00');
    set(tid.dayForm.field('finish'), '17:00');
    expect(screen.getByTestId(tid.dayForm.stat('net'))).toHaveTextContent('08:00');
    await userEvent.click(screen.getByTestId(tid.dayForm.save));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Draft saved · 08:00 · not submitted yet');
    expect(dayOf('EMP004', '2026-08-13')).toMatchObject({ state: 'draft', entries: [{ start: '09:00', finish: '17:00' }] });
    expect(await screen.findByText('Draft · not submitted')).toBeInTheDocument();
    expect(screen.getByTestId(tid.dayForm.field('start'))).toHaveValue('09:00');
  });
  test('submitting a day routes it to the manager, and a long day is flagged without blocking', async () => {
    await openDay();
    set(tid.dayForm.field('start'), '07:00');
    set(tid.dayForm.field('finish'), '18:00');
    await userEvent.click(screen.getByTestId(tid.dayForm.submit));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Day submitted · 11:00 · routed to Manish Nepal for sign-off');
    expect(screen.getByTestId(tid.toast.next)).toHaveTextContent('above the 10-hour review threshold');
    expect(dayOf('EMP004', '2026-08-13')?.state).toBe('pend');
    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument();
  });
  test('an impossible day is refused inline by the same checks the server runs, and nothing is written', async () => {
    const before = audits().length;
    await openDay();
    set(tid.dayForm.field('start'), '09:00');
    fireEvent.blur(screen.getByTestId(tid.dayForm.field('start')));
    set(tid.dayForm.field('finish'), '09:00');
    fireEvent.blur(screen.getByTestId(tid.dayForm.field('finish')));
    expect(screen.getByTestId(tid.field.root(tid.dayForm.field('finish')))).toHaveTextContent('Finish cannot equal start.');
    set(tid.dayForm.field('finish'), '');
    await userEvent.click(screen.getByTestId(tid.dayForm.submit));
    expect(screen.getByTestId(tid.dayForm.warn)).toHaveTextContent('Submission blocked');
    expect(screen.getByTestId(tid.dayForm.warn)).toHaveTextContent('Fill in: Finish date & time');
    expect(dayOf('EMP004', '2026-08-13')).toBeUndefined();
    expect(audits().length).toBe(before);
  });
  test('a day already with the approver is refused by the server, with its message and what to do next', async () => {
    await openDay();
    await userEvent.click(screen.getByTestId(tid.ts.dayPrev));
    expect(await screen.findByTestId(tid.ts.dayLabel)).toHaveTextContent('Wed 12 Aug');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Awaiting approval');
    expect(screen.getByTestId(tid.dayForm.field('start'))).toHaveValue('07:00');
    await userEvent.click(screen.getByTestId(tid.dayForm.submit));
    const warn = await screen.findByTestId(tid.dayForm.refusal);
    expect(warn).toHaveTextContent('You already have an entry for 12/08/2026. It is awaiting approval.');
    expect(warn).toHaveTextContent('Wait for a decision, or ask your approver to send it back.');
    expect(Object.values(store.coll<TimesheetDay>('timesheetDays')).filter(d => d.personCode === 'EMP004' && d.date === '2026-08-12')).toHaveLength(1);
  });
  test('a day in a closed pay period says so and offers no way to save it', async () => {
    await openDay();
    for (let i = 0; i < 6; i++) await userEvent.click(screen.getByTestId(tid.ts.dayPrev));
    expect(await screen.findByTestId(tid.ts.dayLabel)).toHaveTextContent('Fri 7 Aug');
    expect(await screen.findByTestId(tid.ts.banner('locked'))).toHaveTextContent('Pay period 03/08/2026 – 09/08/2026 closed at Monday 12:00');
    expect(screen.getByTestId(tid.ts.banner('locked'))).toHaveTextContent('Ask Manish Nepal to raise an amendment.');
    expect(screen.getByTestId(tid.dayForm.save)).toBeDisabled();
    expect(screen.getByTestId(tid.dayForm.submit)).toBeDisabled();
  });
  test('copy yesterday fills the form from yesterday’s entry', async () => {
    await openDay();
    await userEvent.click(screen.getByTestId(tid.ts.copyDay));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Filled from yesterday · 07:00');
    expect(screen.getByTestId(tid.dayForm.field('finish'))).toHaveValue('15:00');
  });
  test('a non-working day takes a reason instead of times and submits it', async () => {
    await openDay();
    await userEvent.click(screen.getByTestId(tid.ts.nonWorking));
    expect(screen.queryByTestId(tid.dayForm.field('start'))).toBeNull();
    expectTestIdCoverage(document.body);
    set(tid.ts.reasonNotes, 'Covering a training day');
    await userEvent.click(screen.getByTestId(tid.ts.submitReason));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Reason submitted · Annual leave · routed to Manish Nepal');
    expect(dayOf('EMP004', '2026-08-13')).toMatchObject({ state: 'pend', entries: [], nonWorkingReason: 'Annual leave · Covering a training day' });
  });
  test('approved leave on the day shows the blocking banner when the week says so', async () => {
    const real = (await caller(await signInEmail(BIGYAN))('GET', '/api/v1/timesheets/EMP004/weeks/2026-08-10')).body as TimesheetWeek;
    server.use(http.get('/api/v1/timesheets/:personId/weeks/:weekStart', () =>
      HttpResponse.json({ ...real, days: real.days.map(d => (d.date === '2026-08-13' ? { ...d, absence: 'leave' } : d)) })));
    await openDay();
    expect(screen.getByTestId(tid.ts.banner('absence'))).toHaveTextContent('Annual leave is recorded for this day');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Annual leave');
  });
});

describe('My timesheet, a day sent back', () => {
  test('the sent-back day shows the approver’s reason and resubmits', async () => {
    await signInEmail(SANJEEV);
    renderPage(<TimesheetPage />);
    await userEvent.click(await screen.findByTestId(tid.ts.view('day')));
    for (let i = 0; i < 3; i++) await userEvent.click(await screen.findByTestId(tid.ts.dayPrev));
    const banner = await screen.findByTestId(tid.ts.banner('back'));
    expect(banner).toHaveTextContent('Break times missing. Please add and resubmit.');
    expect(banner).toHaveTextContent('It will go back to Manish Nepal as a resubmission.');
    await userEvent.click(screen.getByTestId(tid.dayForm.group('breaks')));
    set(tid.dayForm.field('break_s'), '18:00');
    set(tid.dayForm.field('break_e'), '18:30');
    await userEvent.click(screen.getByTestId(tid.dayForm.submit));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Resubmitted · 10/08/2026 · back with Manish Nepal');
    expect(dayOf('EMP011', '2026-08-10')).toMatchObject({ state: 'resub', entries: [{ breaks: [{ start: '18:00', end: '18:30' }] }] });
    expect(await screen.findByTestId(tid.ts.banner('resub'))).toHaveTextContent('Corrected and sent back to Manish Nepal');
  });
});

describe('My timesheet, week view', () => {
  beforeEach(async () => { await signInEmail(BIGYAN); });
  test('a grid type opens on the week in the classic layout, with totals, the contracted line and full test id coverage', async () => {
    const grid = await openWeek();
    expect(screen.getByTestId(tid.ts.view('week'))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(tid.ts.weekLabel)).toHaveTextContent('Week 33 · 10 Aug – 16 Aug');
    expect(screen.getByTestId(tid.ts.weekToday)).toHaveTextContent('This week');
    expect(within(grid).getAllByRole('columnheader').some(h => h.textContent?.startsWith('Allocation'))).toBe(true);
    expect(screen.getByTestId(tid.week.cell(0, 2, 'start'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.week.dayTotal(2))).toHaveTextContent('07:30');
    expect(screen.getByTestId(tid.ts.contracted)).toHaveTextContent('40h contracted');
    expect(screen.getByTestId(tid.ts.multiweek)).toBeInTheDocument();
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.week.addAlloc));
    expect(screen.getByTestId(tid.week.row(1))).toBeInTheDocument();
    expect(screen.getByTestId(tid.week.cell(1, 0, 'start'))).toHaveValue('');
    set(tid.week.cell(1, 0, 'start'), '18:00');
    set(tid.week.cell(1, 0, 'finish'), '20:00');
    expect(screen.getByTestId(tid.week.rowTotal(1))).toHaveTextContent('02:00');
    expect(screen.getByTestId(tid.week.dayTotal(0))).toHaveTextContent('02:00');
    await userEvent.click(screen.getByTestId(tid.week.delAlloc(1)));
    expect(screen.queryByTestId(tid.week.row(1))).toBeNull();
  });
  test('the grid layout puts each allocation in a section header with its own row', async () => {
    config().weekLayout = 'grid';
    await openWeek();
    expect(screen.getByTestId(tid.week.allocRow(0))).toHaveTextContent('Allocation 1');
    expect(screen.getByTestId(tid.week.row(0))).toHaveTextContent('Start');
    expect(screen.getByText('today')).toBeInTheDocument();
    expectTestIdCoverage(document.body);
  });
  test('the days layout lists one row per day, and a day nobody worked starts with no line', async () => {
    config().weekLayout = 'days';
    await openWeek();
    expect(screen.getByTestId(tid.week.day(6))).toBeInTheDocument();
    expect(screen.getByTestId(tid.week.lineCell(2, 0, 'start'))).toHaveValue('07:00');
    expect(screen.queryByTestId(tid.week.lineCell(0, 0, 'start'))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.week.addLine(0)));
    set(tid.week.lineCell(0, 0, 'start'), '09:00');
    set(tid.week.lineCell(0, 0, 'finish'), '12:00');
    expect(screen.getByTestId(tid.week.dayTotal(0))).toHaveTextContent('03:00');
    expect(screen.queryByTestId(tid.week.addLine(4))).toBeNull();
    expectTestIdCoverage(document.body);
  });
  test('submitting the week sends one request; the future day and the day already submitted come back held with their reasons', async () => {
    await openWeek();
    set(tid.week.cell(0, 0, 'start'), '09:00');
    set(tid.week.cell(0, 0, 'finish'), '17:00');
    set(tid.week.cell(0, 4, 'start'), '09:00');
    set(tid.week.cell(0, 4, 'finish'), '17:00');
    await userEvent.click(screen.getByTestId(tid.ts.submitWeek));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Week 33 submitted · 1 day · 08:00 · routed to Manish Nepal · 2 days held back');
    const held = await screen.findByTestId(tid.ts.weekResult);
    expect(held).toHaveTextContent('Fri 14 Aug is in the future, so it is held back until it happens.');
    expect(held).toHaveTextContent('Wed 12 Aug is already awaiting approval, so it was left alone.');
    expect(dayOf('EMP004', '2026-08-10')?.state).toBe('pend');
    expect(dayOf('EMP004', '2026-08-14')).toBeUndefined();
    expect(audits().filter(a => a.act === 'Timesheet week submitted')).toHaveLength(1);
  });
  test('a week with nothing new to send is refused, with its message and what to do next', async () => {
    await openWeek();
    await userEvent.click(screen.getByTestId(tid.ts.submitWeek));
    const warn = await screen.findByTestId(tid.ts.banner('week-refusal'));
    expect(warn).toHaveTextContent('Already submitted. Every day on this week is with Manish Nepal or decided.');
    expect(warn).toHaveTextContent('Open a day to see where it is.');
  });
});

describe('My timesheet, catching up on earlier weeks', () => {
  beforeEach(async () => { await signInEmail(BIGYAN); });
  test('weeks in a closed period come back held with the lock note, and nothing moves', async () => {
    await openWeek();
    const card = screen.getByTestId(tid.ts.multiweek);
    expect(within(card).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByTestId(tid.ts.mwRow('2026-08-03'))).toHaveTextContent('Week 32 · 03–09 Aug 2026');
    await userEvent.click(screen.getByTestId(tid.ts.mwAll));
    await userEvent.click(screen.getByTestId(tid.ts.mwSubmit));
    const held = await screen.findByTestId(tid.ts.mwResult);
    expect(held).toHaveTextContent('Week 32 · 03–09 Aug 2026: Pay period 03/08/2026 – 09/08/2026 closed at Monday 12:00');
    expect(held).toHaveTextContent('Ask Manish Nepal to raise an amendment.');
    expect(dayOf('EMP004', '2026-08-03')?.state).toBe('draft');
  });
  test('with the lock off, a selected week is submitted and routes on its own', async () => {
    config().rules = { ...config().rules, enforceLock: false };
    await openWeek();
    await userEvent.click(screen.getByTestId(tid.ts.mwCheck('2026-08-03')));
    await userEvent.click(screen.getByTestId(tid.ts.mwSubmit));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('1 week submitted · each routes through approval separately');
    expect(dayOf('EMP004', '2026-08-03')?.state).toBe('pend');
    expect(dayOf('EMP004', '2026-07-27')?.state).toBe('draft');
  });
});

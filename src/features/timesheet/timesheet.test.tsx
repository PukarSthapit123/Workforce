import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import type { TimesheetConfig, TimesheetDay } from '@/contract/timesheets';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo } from '@/test/api-helpers';
import meta from '@/mocks/seed/meta.json';
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
/* module 4 D8: the absence comes from the leave record itself, with no rota on qnipay */
const leaveToday = () => {
  const lr = store.coll<{ id: string; from: string; to: string }>('leaveRequests');
  const approved = lr.lr_5;
  if (!approved) throw new Error('no lr_5');
  lr.lr_today = { ...approved, id: 'lr_today', from: '2026-08-13', to: '2026-08-13' };
  store.save();
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
  test('pressing Save or Submit leaves the focus in the field, so a message cleared on leaving it cannot move the button from under the click', async () => {
    await openDay();
    expect(fireEvent.mouseDown(screen.getByTestId(tid.dayForm.save))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByTestId(tid.dayForm.submit))).toBe(false);
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
  /* review Important 3, trace TD#8: the options are this organisation’s own projects and the chosen project’s own tasks */
  test('Project lists this organisation’s open projects, and Job task lists the chosen project’s own tasks', async () => {
    await openDay();
    const project = tid.dayForm.field('project'), task = tid.dayForm.field('job_task');
    await userEvent.click(screen.getByTestId(project));
    expect(await screen.findByTestId(`${project}-option-Go fibre BC implementation Project`)).toBeInTheDocument();
    expect(screen.queryByTestId(`${project}-option-Northgate Fit-out`)).toBeNull();
    await userEvent.click(screen.getByTestId(`${project}-option-Qnipay D365 Implementation`));
    await userEvent.click(screen.getByTestId(task));
    const tasks = (await screen.findAllByRole('option')).map(o => o.textContent ?? '');
    expect(tasks).toHaveLength(35);
    expect(tasks.every(t => t.startsWith('PT-'))).toBe(true);
    expect(tasks).not.toContain('One-to-one support');
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
  test('approved leave from the leave record shows the banner; time is refused until the day is marked called in and worked anyway', async () => {
    leaveToday();
    const before = audits().length;
    await openDay();
    expect(screen.getByTestId(tid.ts.banner('absence'))).toHaveTextContent('Annual leave is recorded for this day');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Annual leave');
    set(tid.dayForm.field('start'), '09:00');
    set(tid.dayForm.field('finish'), '17:00');
    await userEvent.click(screen.getByTestId(tid.dayForm.save));
    expect(await screen.findByTestId(tid.dayForm.refusal)).toHaveTextContent(
      'Annual leave is recorded for this day. Approved absence blocks timesheet capture while “Leave blocks timesheet capture” is on.');
    expect(screen.getByTestId(tid.dayForm.refusal)).toHaveTextContent('If you did work, mark the day non-working and tick “Called in and worked anyway”.');
    expect(dayOf('EMP004', '2026-08-13')).toBeUndefined();
    expect(audits().length).toBe(before);
    await userEvent.click(screen.getByTestId(tid.ts.nonWorking));
    await userEvent.click(screen.getByTestId(tid.ts.workedAnyway));
    expect(screen.getByTestId(tid.dayForm.field('start'))).toHaveValue('09:00');
    await userEvent.click(screen.getByTestId(tid.dayForm.save));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Draft saved · 08:00 · not submitted yet');
    expect(dayOf('EMP004', '2026-08-13')).toMatchObject({ state: 'draft', entries: [{ start: '09:00', finish: '17:00' }] });
  });
  test('with leave not blocking capture the banner still shows and time saves', async () => {
    leaveToday();
    const cfg = store.coll<{ blocksTimesheet: boolean }>('leaveConfig').leaveConfig;
    if (!cfg) throw new Error('no leave config');
    cfg.blocksTimesheet = false;
    store.save();
    await openDay();
    expect(screen.getByTestId(tid.ts.banner('absence'))).toHaveTextContent('Annual leave is recorded for this day');
    set(tid.dayForm.field('start'), '09:00');
    set(tid.dayForm.field('finish'), '17:00');
    await userEvent.click(screen.getByTestId(tid.dayForm.save));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Draft saved · 08:00 · not submitted yet');
    expect(dayOf('EMP004', '2026-08-13')?.state).toBe('draft');
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
  test('the allocation selects list this organisation’s projects, and a task list that follows the chosen project', async () => {
    await openWeek();
    const optionsOf = (testId: string) => [...within(screen.getByTestId(testId)).getAllByRole('option')].map(o => o.textContent ?? '').filter(t => t !== '—');
    expect(optionsOf(tid.week.ctx(0, 'project'))).toContain('Go fibre BC implementation Project');
    expect(optionsOf(tid.week.ctx(0, 'project'))).not.toContain('Northgate Fit-out');
    set(tid.week.ctx(0, 'project'), 'Qnipay D365 Implementation');
    const tasks = optionsOf(tid.week.ctx(0, 'job_task'));
    expect(tasks).toHaveLength(35);
    expect(tasks.every(t => t.startsWith('PT-'))).toBe(true);
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
  test('a day somebody else saved since the week was read refuses the week, nothing is written, and the grid reads it again', async () => {
    await openWeek();
    /* the manager saves Tuesday as a proxy draft after Bigyan opened the week */
    const wed = dayOf('EMP004', '2026-08-12');
    if (!wed) throw new Error('no seeded day');
    store.coll<TimesheetDay>('timesheetDays')['tsd_EMP004_2026-08-11'] = { ...wed, id: 'tsd_EMP004_2026-08-11', date: '2026-08-11', state: 'draft',
      captureSource: 'proxy', enteredBy: 'EMP001', history: [], submittedAt: '', integrationAttemptId: '' };
    set(tid.week.cell(0, 0, 'start'), '09:00');
    set(tid.week.cell(0, 0, 'finish'), '17:00');
    const before = audits().length;
    await userEvent.click(screen.getByTestId(tid.ts.submitWeek));
    const warn = await screen.findByTestId(tid.ts.banner('week-refusal'));
    expect(warn).toHaveTextContent('Somebody changed 11/08/2026 since you opened this week. Nothing has been saved.');
    expect(dayOf('EMP004', '2026-08-10')).toBeUndefined();
    expect(dayOf('EMP004', '2026-08-11')).toMatchObject({ state: 'draft', captureSource: 'proxy', enteredBy: 'EMP001' });
    expect(audits()).toHaveLength(before);
    await waitFor(() => expect(screen.getByTestId(tid.week.cell(0, 1, 'start'))).toHaveValue('07:00'));
  });
  test('a week with nothing new to send is refused, with its message and what to do next', async () => {
    await openWeek();
    await userEvent.click(screen.getByTestId(tid.ts.submitWeek));
    const warn = await screen.findByTestId(tid.ts.banner('week-refusal'));
    expect(warn).toHaveTextContent('Already submitted. Every day on this week is with Manish Nepal or decided.');
    expect(warn).toHaveTextContent('Open a day to see where it is.');
  });
  test('time on a day of approved leave is refused for the week, naming the day (module 4 D8)', async () => {
    leaveToday();
    await openWeek();
    set(tid.week.cell(0, 3, 'start'), '09:00');
    set(tid.week.cell(0, 3, 'finish'), '17:00');
    const before = audits().length;
    await userEvent.click(screen.getByTestId(tid.ts.submitWeek));
    const warn = await screen.findByTestId(tid.ts.banner('week-refusal'));
    expect(warn).toHaveTextContent(/^Thu 13 Aug: Annual leave is recorded for this day./);
    expect(dayOf('EMP004', '2026-08-13')).toBeUndefined();
    expect(audits()).toHaveLength(before);
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

describe('My timesheet, the page guide', () => {
  beforeEach(async () => { await signInEmail(BIGYAN); });
  /* trace LG#10: the exhaustive key moved behind the ? */
  test('the page guide carries the full key, sent back included', async () => {
    await openWeek();
    await userEvent.click(screen.getByTestId(tid.guide.open('ts')));
    const guide = await screen.findByRole('dialog');
    expect(guide).toHaveTextContent('The full key');
    expect(guide).toHaveTextContent(/sent back/i);
  });
});

/* trace TT#1 and TT#2: time is captured as time, and each field as what it holds */
describe('My timesheet, time is captured as time', () => {
  beforeEach(async () => { await signInEmail(BIGYAN); });
  test('the week grid’s start and finish are time controls in five-minute steps, not free text', async () => {
    const grid = await openWeek();
    const times = within(grid).getAllByLabelText(/ (start|finish)$/);
    expect(times).toHaveLength(14);
    for (const t of times) {
      expect(t).toHaveAttribute('type', 'time');
      expect(t).toHaveAttribute('step', '300');
    }
  });
  test('the day form renders each field as the type the catalogue declares', async () => {
    await openDay();
    const fields = meta.timesheetFields as { c: string; input: string; t?: string }[];
    const kinds = new Set<string>();
    for (const f of fields) {
      const el = screen.queryByTestId(tid.dayForm.field(f.c));
      if (!el) continue;
      if (f.input === 'select') { expect(el, f.c).toHaveRole('combobox'); kinds.add('select'); }
      else if (f.input === 'check') { expect(el, f.c).toHaveRole('checkbox'); kinds.add('check'); }
      else if (f.input === 'textarea') { expect(el.tagName, f.c).toBe('TEXTAREA'); kinds.add('textarea'); }
      else if (f.input === 'calc') { expect(el, f.c).toHaveAttribute('readonly'); kinds.add('calc'); }
      else if (f.t === 'time') { expect(el, f.c).toHaveAttribute('type', 'time'); kinds.add('time'); }
      else if (f.t === 'duration') { expect(el, f.c).toHaveAttribute('type', 'number'); expect(el, f.c).toHaveAttribute('step', '0.25'); kinds.add('duration'); }
      else if (f.t === 'number') { expect(el, f.c).toHaveAttribute('type', 'number'); kinds.add('number'); }
      else { expect(el, f.c).toHaveAttribute('type', 'text'); kinds.add('text'); }
    }
    expect([...kinds]).toEqual(expect.arrayContaining(['time', 'select', 'textarea']));
  });
});

/* trace WK#20 and WK#22-33: the grid layout, one section per allocation */
describe('My timesheet, the grid layout', () => {
  beforeEach(async () => { await signInEmail(BIGYAN); config().weekLayout = 'grid'; });
  test('an empty day in the grid layout totals 00:00, not a dash', async () => {
    await openWeek();
    expect(screen.getByTestId(tid.week.dayTotal(0))).toHaveTextContent(/^00:00$/);
    expect(screen.getByTestId(tid.week.dayTotal(2))).toHaveTextContent('07:30');
  });
  test('an added allocation is a second section, numbered, blank, with its own day row; only it can be removed, and the day columns line up', async () => {
    await openWeek();
    expect(screen.queryByTestId(tid.week.allocRow(1))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.week.addAlloc));
    expect(screen.getByTestId(tid.week.allocRow(1))).toHaveTextContent('Allocation 2');
    expect(screen.getByTestId(tid.week.row(1))).toBeInTheDocument();
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Allocation 2 added');
    const inputs = [...screen.getByTestId(tid.week.row(1)).querySelectorAll('input')];
    expect(inputs).toHaveLength(14);
    for (const i of inputs) expect(i).toHaveValue('');
    for (const s of within(screen.getByTestId(tid.week.allocRow(1))).getAllByRole('combobox')) expect(s).toHaveValue('');
    expect(screen.queryByTestId(tid.week.delAlloc(0))).toBeNull();
    expect(screen.getByTestId(tid.week.delAlloc(1))).toBeInTheDocument();
    const cells = (row: number) => screen.getByTestId(tid.week.row(row)).querySelectorAll('td').length;
    expect(cells(1)).toBe(cells(0));
    expect(cells(1)).toBe(9);
  });
  test('hours in the second section update its own total, the Monday total and the allocation breakdown, and removing it returns to one', async () => {
    await openWeek();
    await userEvent.click(screen.getByTestId(tid.week.addAlloc));
    set(tid.week.ctx(1, 'project'), 'Qnipay D365 Implementation');
    set(tid.week.cell(1, 0, 'start'), '18:00');
    set(tid.week.cell(1, 0, 'finish'), '20:00');
    expect(screen.getByTestId(tid.week.rowTotal(1))).toHaveTextContent('02:00');
    expect(screen.getByTestId(tid.week.dayTotal(0))).toHaveTextContent('02:00');
    expect(screen.getByTestId(tid.week.total)).toHaveTextContent('09:30');
    expect(screen.getByTestId(tid.week.alloc)).toHaveTextContent('Qnipay D365 Implementation 02:00');
    await userEvent.click(screen.getByTestId(tid.week.delAlloc(1)));
    expect(screen.queryByTestId(tid.week.allocRow(1))).toBeNull();
    expect(screen.queryByTestId(tid.week.row(1))).toBeNull();
    expect(screen.getByTestId(tid.week.allocRow(0))).toBeInTheDocument();
    expect(screen.getByTestId(tid.week.dayTotal(0))).toHaveTextContent(/^00:00$/);
  });
  test('submitting the week in the grid layout sends what the grid holds', async () => {
    await openWeek();
    set(tid.week.cell(0, 0, 'start'), '09:00');
    set(tid.week.cell(0, 0, 'finish'), '17:00');
    await userEvent.click(screen.getByTestId(tid.ts.submitWeek));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Week 33 submitted · 1 day · 08:00');
    expect(dayOf('EMP004', '2026-08-10')).toMatchObject({ state: 'pend', entries: [{ start: '09:00', finish: '17:00' }] });
  });
});

/* trace CL#8-21: the list layout, one row per day */
describe('My timesheet, the list layout', () => {
  beforeEach(async () => { await signInEmail(BIGYAN); config().weekLayout = 'days'; });
  test('each line takes its allocation before its times, today is marked, and the foot shows the week total and contracted hours', async () => {
    await openWeek();
    const select = screen.getByTestId(tid.week.lineCtx(2, 0, 'project')), start = screen.getByTestId(tid.week.lineCell(2, 0, 'start'));
    expect(select.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByTestId(tid.week.day(3))).getByText('Today')).toBeInTheDocument();
    for (const i of [0, 1, 2, 4, 5, 6]) expect(within(screen.getByTestId(tid.week.day(i))).queryByText('Today')).toBeNull();
    const foot = screen.getByTestId(tid.week.total).parentElement;
    expect(screen.getByTestId(tid.week.total)).toHaveTextContent('07:30');
    expect(foot).toHaveTextContent('Week total');
    expect(foot).toHaveTextContent('contracted 40:00');
  });
  test('a line added to a day goes on that day only, starts blank, alone has a remove control, adds to the day, and removing it returns to one line', async () => {
    await openWeek();
    await userEvent.click(screen.getByTestId(tid.week.addLine(2)));
    expect(screen.getByTestId(tid.week.lineCell(2, 1, 'start'))).toHaveValue('');
    expect(screen.getByTestId(tid.week.lineCell(2, 1, 'finish'))).toHaveValue('');
    for (const i of [0, 1, 3, 4, 5, 6]) expect(screen.queryByTestId(tid.week.lineCell(i, 1, 'start'))).toBeNull();
    expect(screen.queryByTestId(tid.week.lineCell(0, 0, 'start'))).toBeNull();
    expect(screen.queryByTestId(tid.week.delLine(2, 0))).toBeNull();
    expect(screen.getByTestId(tid.week.delLine(2, 1))).toBeInTheDocument();
    set(tid.week.lineCell(2, 1, 'start'), '18:00');
    set(tid.week.lineCell(2, 1, 'finish'), '21:00');
    expect(within(screen.getByTestId(tid.week.day(2))).getByText('03:00')).toBeInTheDocument();
    expect(screen.getByTestId(tid.week.dayTotal(2))).toHaveTextContent('10:30');
    await userEvent.click(screen.getByTestId(tid.week.delLine(2, 1)));
    expect(screen.queryByTestId(tid.week.lineCell(2, 1, 'start'))).toBeNull();
    expect(screen.getByTestId(tid.week.lineCell(2, 0, 'start'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.week.dayTotal(2))).toHaveTextContent('07:30');
  });
  test('submitting the week in the list layout sends the lines', async () => {
    await openWeek();
    await userEvent.click(screen.getByTestId(tid.week.addLine(0)));
    set(tid.week.lineCell(0, 0, 'start'), '09:00');
    set(tid.week.lineCell(0, 0, 'finish'), '17:00');
    await userEvent.click(screen.getByTestId(tid.ts.submitWeek));
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Week 33 submitted · 1 day · 08:00');
    expect(dayOf('EMP004', '2026-08-10')).toMatchObject({ state: 'pend', entries: [{ start: '09:00', finish: '17:00' }] });
  });
});

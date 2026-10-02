import type { TimesheetWeek } from '@/contract/timesheets';
import { weekModel } from '@/domain/timesheet';
import { withFakeServer } from '@/test/render-page';
import { caller, resetTo } from '@/test/api-helpers';
import { breakIndex, checkDay, checkField, dayInputFrom, dayStats, envOf, formGroups, serverField, typeOf, valuesFromDay } from './capture';
import { allocsFromLines, cellMinutes, gridAs, gridTotals, initialGrid, linesFromWeek, weekBody } from './week';
import { dayChip } from './DayView';
import { weekChip } from './WeekView';

/* The day form's and the weekly grid's own rules, against a real week read
   from the fake server: Bigyan Poudel (EMP004, Consultant) at the frozen clock. */
withFakeServer();
let week: TimesheetWeek;
beforeAll(async () => {
  resetTo('qnipay');
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bigyan.poudel@dogmagroup.co.uk', password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  week = (await caller(token)('GET', '/api/v1/timesheets/EMP004/weeks/2026-08-10')).body as TimesheetWeek;
});
const c = () => week.capture;
const day = (i: number) => { const d = week.days[i]; if (!d) throw new Error(`no day ${i}`); return d; };
const model = () => weekModel(c().fields, typeOf(c()), envOf(c()), c().weekGrid);

describe('the day form', () => {
  test('groups follow GROUPS: the open ones in order, breaks closed, allocation from the project capability', () => {
    const g = formGroups(c()).map(x => `${x.group.key}${x.group.open ? '' : ' (closed)'}`);
    expect(g).toEqual(['core', 'alloc', 'breaks (closed)', 'extra (closed)', 'allow']);
  });
  test('a saved day comes back as the form shows it, and goes out again as the same entry', () => {
    const v = valuesFromDay(day(2), c());
    expect(v).toMatchObject({ start: '07:00', finish: '15:00', break_s: '11:00', break_e: '11:30' });
    expect(dayInputFrom(v, c()).entries).toEqual([{ start: '07:00', finish: '15:00', breaks: [{ start: '11:00', end: '11:30' }], fields: {} }]);
  });
  test('ticked allowances go out as their pay codes, unticked ones do not', () => {
    const body = dayInputFrom({ start: '09:00', finish: '17:00', overtime: true, call_out: false }, c());
    expect(body.allowances).toEqual(['OT15']);
  });
  test('mandatory fields are checked before the times, as validateEntry does', () => {
    const r = checkDay({ start: '09:00' }, c(), '2026-08-13', week.now);
    expect(r.errors).toEqual([{ field: 'finish', message: 'Submission blocked. Fill in: Finish date & time.' }]);
  });
  test('time errors name the form field, a break error names the break’s start, and warnings never block', () => {
    const overlap = checkDay({ start: '09:00', finish: '17:00', break_s: '12:00', break_e: '13:00', break_s2: '12:30', break_e2: '13:30' }, c(), '2026-08-13', week.now);
    expect(overlap.errors).toEqual([{ field: 'break_s2', message: 'Breaks 1 and 2 overlap.' }]);
    const future = checkDay({ start: '09:00', finish: '17:00' }, c(), '2026-08-14', week.now);
    expect(future.errors[0]).toEqual({ field: 'date', message: 'You cannot record time for Fri 14 Aug. It is in the future.' });
    const long = checkDay({ start: '06:00', finish: '18:00' }, c(), '2026-08-13', week.now);
    expect(long.errors).toEqual([]);
    expect(long.warnings).toEqual(['That is 12:00 in one day. It is above the 10-hour review threshold.']);
  });
  test('the inline field check catches a finish equal to the start and a break ending before it starts', () => {
    expect(checkField('finish', { start: '09:00', finish: '09:00' }, c())).toBe('Finish cannot equal start.');
    expect(checkField('break_e', { break_s: '12:00', break_e: '11:00' }, c())).toBe('Break end is before its start.');
    expect(checkField('notes', { notes: '' }, c())).toBeNull();
  });
  test('server field names map back to the form field they belong to', () => {
    expect(serverField('start')).toBe('entries.0.start');
    expect(serverField('break_e2')).toBe('entries.0.breaks.1');
    expect([breakIndex('break_s'), breakIndex('break_e5'), breakIndex('notes')]).toEqual([0, 4, -1]);
  });
  test('the summary reads net time less breaks and the rate the type’s rules resolve', () => {
    const s = dayStats({ start: '09:00', finish: '17:30', break_s: '12:00', break_e: '12:30' }, c(), '2026-08-13');
    expect(s).toMatchObject({ net: 480, breaks: 30, nBreaks: 1, extra: { label: 'Allowances claimed', value: 'None' } });
    expect(s.rate?.code).toBe('STD');
  });
  test('the day chip follows the record, then the clock', () => {
    expect(dayChip(day(2)).label).toBe('Awaiting approval');
    expect(dayChip(day(3)).label).toBe('Nothing logged');
    expect(dayChip(day(4)).label).toBe('Not yet open');
    expect(dayChip({ ...day(3), absence: 'sickness' }).label).toBe('Sickness');
  });
});

describe('the weekly grid', () => {
  test('a saved cell counts its breaks off the hours, as the server does', () => {
    const lines = linesFromWeek(week, model());
    const cell = lines[2]?.[0]?.cell;
    expect(cell && cellMinutes(cell, true)).toBe(450);
    expect(gridTotals({ kind: 'lines', lines }, model()).weekMin).toBe(450);
  });
  test('lines group into allocation rows by their selects, and convert back without loss', () => {
    const m = model();
    const lines = linesFromWeek(week, m);
    const allocs = allocsFromLines(lines, m);
    expect(allocs).toHaveLength(1);
    const back = gridAs({ kind: 'allocs', allocs }, 'lines', m);
    expect(back.kind === 'lines' && back.lines[2]?.[0]?.cell.start).toBe('07:00');
  });
  test('the week body leaves out a day as it was saved, and sends a changed day with its saved breaks', () => {
    const m = model(), state = initialGrid(week, m, 'classic');
    expect(weekBody(week, state, m).days).toEqual([]);
    if (state.kind !== 'allocs') throw new Error('classic holds allocation rows');
    const a = state.allocs[0];
    if (!a) throw new Error('no allocation row');
    const edited = { kind: 'allocs' as const, allocs: [{ ...a, cells: a.cells.map((x, i) => (i === 2 ? { ...x, finish: '16:00' } : i === 0 ? { ...x, start: '09:00', finish: '17:00' } : x)) }] };
    const body = weekBody(week, edited, m).days;
    expect(body.map(d => d.date)).toEqual(['2026-08-10', '2026-08-12']);
    expect(body[1]?.entries[0]).toMatchObject({ start: '07:00', finish: '16:00', breaks: [{ start: '11:00', end: '11:30' }] });
    expect(body[1]?.version).toBe(day(2).version);
  });
  test('the week chip reads the stored days: one awaiting approval and nothing else reads as awaiting', () => {
    expect(weekChip(week).label).toBe('Awaiting approval');
  });
});

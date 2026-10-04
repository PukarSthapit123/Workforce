/* The weekly grid's model, shared by My timesheet and proxy entry: the
   prototype's renderWeekGrid, renderWeekClassic, renderWeekDays, readWeekGrid,
   readWeekDays and recalcWeekGrid (qnipay-workforce-v15.html:6441-6662), held
   as state rather than read back out of the DOM. The classic and grid layouts
   hold allocation rows, each with its selects and seven cells; the day list
   holds lines per day, each with its own selects. Either becomes the same
   per-day entries for the one-request week submission. */
import type { TimesheetWeek, WeekSubmit } from '@/contract/timesheets';
import { dayMinutes, entryMinutes, formatDay, toMin, type BreakInput, type WeekLayout, type WeekModel } from '@/domain/timesheet';
import { rotaShift } from './capture';

/* A cell is one entry on one day. `breaks` and `extra` are what the day form
   saved with it (its breaks and its other fields): the grid does not show
   them, but it counts the breaks off the cell's hours and sends both back, so
   submitting the week never loses what the day form recorded. */
export interface Cell { start: string; finish: string; hours: string; breaks: readonly BreakInput[]; extra: Record<string, string | boolean> }
export interface Alloc { ctx: Record<string, string>; cells: Cell[] }
export interface Line { ctx: Record<string, string>; cell: Cell }
export type GridState = { kind: 'allocs'; allocs: Alloc[] } | { kind: 'lines'; lines: Line[][] };
/* the practical limits the prototype toasts at */
export const MAX_ALLOCS = 6;
export const MAX_LINES = 6;

export const blankCell = (): Cell => ({ start: '', finish: '', hours: '', breaks: [], extra: {} });
/* A new allocation starts unset: drawing one against hours nobody charged would read as a claim. */
export const defaultCtx = (m: WeekModel): Record<string, string> => Object.fromEntries(m.ctx.map(f => [f.c, '']));
export const blankAlloc = (m: WeekModel): Alloc => ({ ctx: defaultCtx(m), cells: Array.from({ length: 7 }, blankCell) });
export const kindFor = (layout: WeekLayout): GridState['kind'] => (layout === 'days' ? 'lines' : 'allocs');

/* A cell's minutes: finish less start, wrapping past midnight, less its breaks; or the hours typed. */
export function cellMinutes(cell: Cell, times: boolean): number {
  if (!times) { const h = Number.parseFloat(cell.hours); return Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 0; }
  if (toMin(cell.start) == null || toMin(cell.finish) == null) return 0;
  return entryMinutes({ start: cell.start, finish: cell.finish, breaks: cell.breaks });
}
const filled = (cell: Cell, times: boolean) => (times ? Boolean(cell.start || cell.finish) : Boolean(cell.hours.trim()));
const hoursText = (min: number) => (min ? String(Math.round((min / 60) * 100) / 100) : '');
const ctxKey = (m: WeekModel, ctx: Record<string, string>) => m.ctx.map(f => ctx[f.c] ?? '').join('\u0000');

/* What each saved day's entries look like as lines: allocation from the entry's fields, times or hours from the entry. */
export function linesFromWeek(week: TimesheetWeek, m: WeekModel): Line[][] {
  return week.days.map(d => (d.record?.entries ?? []).map(e => {
    const ctx = defaultCtx(m);
    for (const f of m.ctx) { const v = e.fields?.[f.c]; if (typeof v === 'string' && v) ctx[f.c] = v; }
    const extra = Object.fromEntries(Object.entries(e.fields ?? {}).filter(([k]) => !m.ctx.some(f => f.c === k)));
    const cell: Cell = m.times
      ? { start: e.start, finish: e.finish, hours: '', breaks: e.breaks, extra }
      : { start: '', finish: '', hours: e.start && e.finish ? hoursText(dayMinutes([e])) : e.hours != null ? String(e.hours) : '', breaks: [], extra };
    return { ctx, cell };
  }));
}
/* Lines grouped into allocation rows by their selects; a second line on the same day with the same allocation takes a new row. */
export function allocsFromLines(lines: Line[][], m: WeekModel): Alloc[] {
  const allocs: Alloc[] = [];
  lines.forEach((dayLines, day) => dayLines.forEach(l => {
    const key = ctxKey(m, l.ctx);
    let a = allocs.find(x => ctxKey(m, x.ctx) === key && !filled(x.cells[day] ?? blankCell(), m.times));
    if (!a) { a = { ctx: { ...l.ctx }, cells: Array.from({ length: 7 }, blankCell) }; allocs.push(a); }
    a.cells[day] = { ...l.cell };
  }));
  return allocs.length ? allocs.slice(0, MAX_ALLOCS) : [blankAlloc(m)];
}
export function linesFromAllocs(allocs: Alloc[], m: WeekModel): Line[][] {
  return Array.from({ length: 7 }, (_, day) => allocs.flatMap(a => {
    const cell = a.cells[day] ?? blankCell();
    return filled(cell, m.times) ? [{ ctx: { ...a.ctx }, cell: { ...cell } }] : [];
  }));
}
export function initialGrid(week: TimesheetWeek, m: WeekModel, layout: WeekLayout): GridState {
  const lines = linesFromWeek(week, m);
  return kindFor(layout) === 'lines' ? { kind: 'lines', lines } : { kind: 'allocs', allocs: allocsFromLines(lines, m) };
}
/* The state in the shape the layout draws, converted once if the layout changed (a phone gets the day list). */
export function gridAs(state: GridState, kind: GridState['kind'], m: WeekModel): GridState {
  if (state.kind === kind) return state;
  return state.kind === 'allocs' ? { kind: 'lines', lines: linesFromAllocs(state.allocs, m) } : { kind: 'allocs', allocs: allocsFromLines(state.lines, m) };
}
export const gridLines = (state: GridState, m: WeekModel) => (state.kind === 'lines' ? state.lines : linesFromAllocs(state.allocs, m));

/* fill-from-rota (v15:11370-11392): each day with a shift on the published rota
   takes the shift's start and finish (or its hours, in an hours grid): the
   first allocation's cell in the classic and grid layouts, the day's first
   line in the list. Days with no shift, and closed days, are left as they are,
   where the prototype blanked them; `only` limits it to some days (proxy entry
   seeds only the days with nothing saved). Returns how many days it filled. */
export function fillFromRota(state: GridState, week: TimesheetWeek, m: WeekModel, only: (day: number) => boolean = () => true): { state: GridState; days: number } {
  const shifts = week.days.map((d, i) => (d.locked || !only(i) ? undefined : rotaShift(d)));
  const put = (cell: Cell, i: number): Cell => {
    const s = shifts[i];
    if (!s) return cell;
    return m.times ? { ...cell, start: s.from, finish: s.to } : { ...cell, hours: String(s.hours) };
  };
  const days = shifts.filter(Boolean).length;
  if (state.kind === 'lines') {
    const lines = state.lines.map((ls, i) => {
      if (!shifts[i]) return ls;
      const [first, ...rest] = ls;
      return [first ? { ...first, cell: put(first.cell, i) } : { ctx: defaultCtx(m), cell: put(blankCell(), i) }, ...rest];
    });
    return { state: { kind: 'lines', lines }, days };
  }
  const base = state.allocs.length ? state.allocs : [blankAlloc(m)];
  const allocs = base.map((a, k) => (k === 0 ? { ...a, cells: a.cells.map((c, i) => put(c, i)) } : a));
  return { state: { kind: 'allocs', allocs }, days };
}

/* recalcWeekGrid: minutes per day, per allocation and for the week. */
export function gridTotals(state: GridState, m: WeekModel) {
  const lines = gridLines(state, m);
  const dayMin = lines.map(ls => ls.reduce((n, l) => n + cellMinutes(l.cell, m.times), 0));
  const byCtx: Record<string, number> = {};
  for (const ls of lines) for (const l of ls) {
    const label = m.ctx.length ? (l.ctx[m.ctx[0]?.c ?? ''] ?? '') : '';
    const min = cellMinutes(l.cell, m.times);
    if (label && min) byCtx[label] = (byCtx[label] ?? 0) + min;
  }
  return { dayMin, byCtx, weekMin: dayMin.reduce((a, b) => a + b, 0) };
}

type DaySubmit = WeekSubmit['days'][number];
type Entries = NonNullable<DaySubmit['entries']>;
const sameEntries = (a: Entries, b: Entries, m: WeekModel) =>
  a.length === b.length && a.every((x, i) => {
    const y = b[i];
    if (!y) return false;
    const times = m.times ? x.start === y.start && x.finish === y.finish : dayMinutes([x]) === dayMinutes([y]);
    return times && m.ctx.every(f => (x.fields?.[f.c] ?? '') === (y.fields?.[f.c] ?? ''));
  });
/* The week submission's body: all seven days, each with the version it was
   read at, so the server refuses the week (412) if anyone changed a day since.
   A day left as it was read goes without entries, so it is submitted as it is
   stored and keeps who entered it; a changed day carries each entry's saved
   breaks and other fields under its new times. */
export function weekBody(week: TimesheetWeek, state: GridState, m: WeekModel): WeekSubmit {
  const lines = gridLines(state, m);
  const days: DaySubmit[] = week.days.map((d, i) => {
    const rec = d.record, asRead = { date: d.date, version: d.version };
    const entries = (lines[i] ?? []).filter(l => cellMinutes(l.cell, m.times) > 0).map(l => {
      const fields = { ...l.cell.extra, ...Object.fromEntries(Object.entries(l.ctx).filter(([, v]) => v !== '')) };
      return m.times
        ? { start: l.cell.start, finish: l.cell.finish, breaks: [...l.cell.breaks], fields }
        : { start: '', finish: '', breaks: [], hours: cellMinutes(l.cell, false) / 60, fields };
    });
    if (rec ? sameEntries(entries, rec.entries, m) : !entries.length) return asRead;
    /* the rota line travels with the day: the saved one, or the day's shift on the published rota */
    const shift = rec?.shift || rotaShift(d)?.code;
    return { ...asRead, entries, allowances: rec?.allowances ?? [], ...(shift ? { shift } : {}) };
  });
  return { days };
}
/* A week refusal about one day (field days.N, such as leave blocking capture,
   module 4 D8) speaks of "this day", so the warning names the day first. */
export function refusedDay(week: TimesheetWeek, field: string | undefined) {
  const i = /^days\.(\d+)/.exec(field ?? '')?.[1];
  const d = i === undefined ? undefined : week.days[Number(i)];
  return d ? `${formatDay(d.date)}: ` : '';
}

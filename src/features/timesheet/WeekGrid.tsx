import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { Button, Empty, NativeSelect, Pill, Row, ScopeBadge, Small, Tip, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import type { TimesheetWeek } from '@/contract/timesheets';
import { NO_TIME_FIELDS, formatMinutes, taskReset, type WeekLayout, type WeekModel } from '@/domain/timesheet';
import { selectValues } from './capture';
import { MAX_ALLOCS, MAX_LINES, blankAlloc, blankCell, cellMinutes, defaultCtx, gridTotals, type Alloc, type Cell, type GridState, type Line } from './week';

/* The weekly grid in the tenant's layout (renderWeekGrid, renderWeekClassic,
   renderWeekDays; qnipay-workforce-v15.html:6441-6588 and the rules at
   976-1083). Controlled: the parent holds the state and submits it. Shared by
   My timesheet and proxy entry, which passes `who` so the grid says whose it is.
   - classic: allocation stacked in the first column, days across.
   - grid: days across, one section per allocation, a totals row under them.
   - days: one row per day, allocation chosen before the times. */
export interface WeekGridProps {
  week: TimesheetWeek; model: WeekModel; layout: WeekLayout; state: GridState; onChange: (s: GridState) => void;
  today: string; who?: string;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const dateParts = (iso: string, i: number) => ({ dow: DOW[i] ?? '', dm: `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1] ?? ''}` });
/* table.wk input.inl: a 34px in-table input on the card surface, a light border that strengthens on hover */
const INL = 'h-[34px] w-full min-w-[62px] rounded-control border border-border bg-surface-card px-xs text-center text-sm tabular-nums outline-none hover:enabled:border-border-strong hover:enabled:bg-surface-tint focus:border-brand focus:bg-surface-card focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60 max-md:min-w-[58px] max-md:text-base';
const SEL = 'h-[34px] min-w-0 text-sm';
const dayBg = (i: number, iso: string, today: string) => cn(iso === today ? 'bg-(--qp-rota-early-surface)' : i >= 5 && 'bg-surface-sunken');
const zero = (min: number) => (min ? '' : 'font-normal text-text-muted');

function CellInputs({ cell, times, label, disabled, testId, onCell }: {
  cell: Cell; times: boolean; label: string; disabled: boolean; testId: (part: string) => string;
  onCell: (part: keyof Cell, v: string) => void;
}) {
  if (!times) return <input data-testid={testId('hours')} type="text" inputMode="decimal" placeholder="–" aria-label={`${label} hours`} disabled={disabled}
    className={INL} value={cell.hours} onChange={e => onCell('hours', e.target.value)} />;
  return (
    <div className="flex flex-col gap-xs">
      <input data-testid={testId('start')} type="time" step={300} aria-label={`${label} start`} disabled={disabled} className={INL}
        value={cell.start} onChange={e => onCell('start', e.target.value)} />
      <input data-testid={testId('finish')} type="time" step={300} aria-label={`${label} finish`} disabled={disabled} className={INL}
        value={cell.finish} onChange={e => onCell('finish', e.target.value)} />
    </div>);
}

/* An allocation's selects: stacked in the classic first column, inline in the grid's section header, on the line in the day list. */
function CtxSelects({ week, model, ctx, testId, labelFor, onCtx, className }: {
  week: TimesheetWeek; model: WeekModel; ctx: Record<string, string>; testId: (field: string) => string; labelFor: (label: string) => string;
  onCtx: (field: string, v: string) => void; className: string;
}) {
  return <>{model.ctx.map(f => (
    <label key={f.c} className={className}>
      <span className="text-xs font-semibold text-text-secondary">{f.label}</span>
      <NativeSelect testId={testId(f.c)} aria-label={labelFor(f.label)} className={SEL} value={ctx[f.c] ?? ''} onChange={e => onCtx(f.c, e.target.value)}>
        <option value="">—</option>{selectValues(f.c, f.opts, week.capture, ctx).map(o => <option key={o}>{o}</option>)}
      </NativeSelect>
    </label>))}</>;
}

export function WeekGrid(p: WeekGridProps) {
  const { model: m, week } = p, tf = week.capture.timeFormat;
  const hm = (min: number) => formatMinutes(min, tf);
  if (!m.hasTime && !m.multi) return <Empty testId={tid.week.empty}>{NO_TIME_FIELDS}</Empty>;
  const totals = gridTotals(p.state, m);
  const contracted = `contracted ${hm(week.person.contractedHours * 60)}`;
  const whose = p.who ? `${p.who}’s` : 'your';
  const breakdown = Object.keys(totals.byCtx).length > 0 && (
    <div data-testid={tid.week.alloc} className="mt-sm flex flex-wrap gap-md text-xs text-text-muted">
      {Object.entries(totals.byCtx).map(([k, v]) => <span key={k}>{k} <b className="font-[650] text-text-primary">{hm(v)}</b></span>)}
    </div>);
  /* IMP-005c: a proxy grid says whose it is: their rota, while there is a published one, or their timesheet */
  const source = week.days.some(d => d.rota) ? 'rota' : 'timesheet';
  const seeded = p.who && <Small testId={tid.tsRota.seeded}>Seeded from {whose} {source}, not yours.</Small>;
  return (
    <div data-testid={tid.week.grid}>
      {p.state.kind === 'lines'
        ? <DayList {...p} lines={p.state.lines} totals={totals} hm={hm} contracted={contracted} />
        : p.layout === 'grid'
          ? <SectionGrid {...p} allocs={p.state.allocs} totals={totals} hm={hm} />
          : <Classic {...p} allocs={p.state.allocs} totals={totals} hm={hm} />}
      {breakdown}
      <div className="mt-sm flex flex-wrap items-baseline gap-md">
        {p.layout === 'grid' && p.state.kind === 'allocs'
          ? <><Small className="flex-[1_1_260px]">{m.times ? 'Start and finish per day.' : 'One total per day.'}{m.ctx.length
            ? ` Split the week across more than one ${m.ctx.map(c => c.label.toLowerCase()).join(' or ')} by adding an allocation.` : ''}</Small>
            <span className="text-xs text-text-muted">{contracted}</span>{seeded}</>
          : seeded}
      </div>
    </div>);
}

type Totals = ReturnType<typeof gridTotals>;
interface AllocProps extends WeekGridProps { allocs: Alloc[]; totals: Totals; hm: (m: number) => string }

function allocEdits(p: AllocProps) {
  const set = (allocs: Alloc[]) => p.onChange({ kind: 'allocs', allocs });
  return {
    cell: (a: number, i: number, part: keyof Cell, v: string) =>
      set(p.allocs.map((x, k) => (k === a ? { ...x, cells: x.cells.map((c, j) => (j === i ? { ...c, [part]: v } : c)) } : x))),
    ctx: (a: number, f: string, v: string) => set(p.allocs.map((x, k) => (k === a ? { ...x, ctx: { ...x.ctx, [f]: v, ...taskReset(f, x.ctx[f], v) } } : x))),
    add: () => {
      set([...p.allocs, blankAlloc(p.model)]);
      toastInfo(`Allocation ${p.allocs.length + 1} added · pick where the hours belong, then enter them`);
    },
    remove: (a: number) => { set(p.allocs.filter((_x, k) => k !== a)); toastInfo('Allocation removed'); },
  };
}
const AddAlloc = ({ p, label, onClick }: { p: AllocProps; label: string; onClick: () => void }) => (p.model.ctx.length > 0
  ? <Button testId={tid.week.addAlloc} kind="ghost" small className="mt-[10px]" disabled={p.allocs.length >= MAX_ALLOCS}
    title={p.allocs.length >= MAX_ALLOCS ? 'Six allocations is the practical limit on one week' : undefined} onClick={onClick}>{label}</Button>
  : null);
const RemoveAlloc = ({ a, withText, onClick }: { a: number; withText?: boolean; onClick: () => void }) => (
  <Button testId={tid.week.delAlloc(a)} kind="ghost" small aria-label={`Remove allocation ${a + 1}`} onClick={onClick}>
    <Trash2 aria-hidden="true" />{withText && ' Remove'}</Button>);

function DayHead({ p, marker }: { p: WeekGridProps; marker?: boolean }) {
  return <>{p.week.days.map((d, i) => {
    const { dow, dm } = dateParts(d.date, i), isToday = d.date === p.today;
    return (
      <TableHead key={d.date} aria-current={isToday ? 'date' : undefined} className={cn('text-center', dayBg(i, d.date, p.today))}>
        {dow}<span className="mt-px block text-sm font-bold tracking-normal text-text-primary normal-case">{dm}</span>
        {marker && isToday && <span className="block text-xs tracking-[.05em] text-brand dark:text-brand-accent">today</span>}
      </TableHead>);
  })}</>;
}
function DayCells({ p, alloc, a }: { p: AllocProps; alloc: Alloc; a: number }) {
  const edit = allocEdits(p);
  return <>{p.week.days.map((d, i) => {
    const { dow, dm } = dateParts(d.date, i);
    return (
      <TableCell key={d.date} className={cn('text-center', dayBg(i, d.date, p.today))}>
        <CellInputs cell={alloc.cells[i] ?? blankCell()} times={p.model.times} label={`${dow} ${dm}`} disabled={d.locked}
          testId={part => tid.week.cell(a, i, part)} onCell={(part, v) => edit.cell(a, i, part, v)} />
      </TableCell>);
  })}</>;
}
const rowMinutes = (alloc: Alloc, m: WeekModel) => alloc.cells.reduce((n, c) => n + cellMinutes(c, m.times), 0);
function TotalsRow({ p, lead, trailing }: { p: AllocProps; lead: ReactNode; trailing?: boolean }) {
  return (
    <TableRow>
      <TableCell className="text-xs text-text-muted">{lead}</TableCell>
      {p.totals.dayMin.map((min, i) => <TableCell key={i} data-testid={tid.week.dayTotal(i)}
        className={cn('text-center font-[650] whitespace-nowrap tabular-nums', zero(min))}>{p.hm(min)}</TableCell>)}
      <TableCell data-testid={tid.week.total} className="text-right text-sm font-[650] whitespace-nowrap tabular-nums">{p.hm(p.totals.weekMin)}</TableCell>
      {trailing && <TableCell />}
    </TableRow>);
}
const NO_ZEBRA = '[&>tr:nth-child(even)]:bg-transparent';

function Classic(p: AllocProps) {
  const m = p.model, edit = allocEdits(p);
  return (
    <>
      <Table variant="matrix" dense className="max-md:min-w-[700px]">
        <TableHeader><TableRow>
          <TableHead className="w-[180px] min-w-[180px] max-md:w-[150px] max-md:min-w-[150px]">{m.ctx.length
            ? <>Allocation<Tip testId={tid.week.allocTip} text="Everything on this row is charged to this combination. Add a row to split the week across more than one." /></>
            : 'Hours'}</TableHead>
          <DayHead p={p} />
          <TableHead className="text-right">Total</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody className={NO_ZEBRA}>
          {p.allocs.map((alloc, a) => {
            const min = rowMinutes(alloc, m);
            return (
              <Row key={a} testId={tid.week.row(a)}>
                <TableCell className="w-[180px] min-w-[180px] pt-sm align-top max-md:w-[150px] max-md:min-w-[150px]">
                  {m.ctx.length
                    ? <CtxSelects week={p.week} model={m} ctx={alloc.ctx} testId={f => tid.week.ctx(a, f)} labelFor={l => `${l} for allocation ${a + 1}`}
                      onCtx={(f, v) => edit.ctx(a, f, v)} className="mb-sm flex flex-col gap-xs last:mb-0" />
                    : <span className="text-xs text-text-muted">Hours</span>}
                </TableCell>
                <DayCells p={p} alloc={alloc} a={a} />
                <TableCell data-testid={tid.week.rowTotal(a)} className={cn('text-right whitespace-nowrap tabular-nums', zero(min))}>{p.hm(min)}</TableCell>
                <TableCell className="text-right">{a > 0 && <RemoveAlloc a={a} onClick={() => edit.remove(a)} />}</TableCell>
              </Row>);
          })}
        </TableBody>
        <TableFooter><TotalsRow p={p} lead="Totals" trailing /></TableFooter>
      </Table>
      <AddAlloc p={p} label="+ Add allocation row" onClick={edit.add} />
    </>);
}

function SectionGrid(p: AllocProps) {
  const m = p.model, edit = allocEdits(p);
  return (
    <>
      <Table variant="matrix" dense className="max-md:min-w-[660px]">
        <TableHeader><TableRow>
          <TableHead className="w-[76px] min-w-[76px]" /><DayHead p={p} marker /><TableHead className="text-right">Total</TableHead>
        </TableRow></TableHeader>
        <TableBody className={NO_ZEBRA}>
          {p.allocs.flatMap((alloc, a) => {
            const min = rowMinutes(alloc, m);
            const rows = [];
            if (m.ctx.length) rows.push(
              <Row key={`h${a}`} testId={tid.week.allocRow(a)}>
                <TableCell colSpan={9} className="bg-surface-tint p-0">
                  <div className="flex flex-wrap items-end gap-md px-md py-sm">
                    <span className="mb-[6px]"><ScopeBadge>Allocation {a + 1}</ScopeBadge></span>
                    <CtxSelects week={p.week} model={m} ctx={alloc.ctx} testId={f => tid.week.ctx(a, f)} labelFor={l => `${l} for allocation ${a + 1}`}
                      onCtx={(f, v) => edit.ctx(a, f, v)} className="flex min-w-0 flex-[1_1_150px] flex-col gap-xs text-left max-md:flex-[1_1_120px]" />
                    {a > 0 && <RemoveAlloc a={a} withText onClick={() => edit.remove(a)} />}
                  </div>
                </TableCell>
              </Row>);
            rows.push(
              <Row key={`r${a}`} testId={tid.week.row(a)}>
                <TableCell className="w-[76px] min-w-[76px] text-xs text-text-muted">{m.times ? <>Start<br />Finish</> : 'Hours'}</TableCell>
                <DayCells p={p} alloc={alloc} a={a} />
                <TableCell data-testid={tid.week.rowTotal(a)} className={cn('text-right whitespace-nowrap tabular-nums', zero(min))}>{p.hm(min)}</TableCell>
              </Row>);
            return rows;
          })}
        </TableBody>
        <TableFooter><TotalsRow p={p} lead="Totals" /></TableFooter>
      </Table>
      <AddAlloc p={p} label="+ Add an allocation" onClick={edit.add} />
    </>);
}

interface LinesProps extends WeekGridProps { lines: Line[][]; totals: Totals; hm: (m: number) => string; contracted: string }
function DayList(p: LinesProps) {
  const m = p.model;
  const set = (lines: Line[][]) => p.onChange({ kind: 'lines', lines });
  const edit = (i: number, j: number, f: (l: Line) => Line) => set(p.lines.map((ls, k) => (k === i ? ls.map((l, n) => (n === j ? f(l) : l)) : ls)));
  const add = (i: number) => set(p.lines.map((ls, k) => (k === i ? [...ls, { ctx: ls[0]?.ctx ? { ...ls[0].ctx } : defaultCtx(m), cell: blankCell() }] : ls)));
  const remove = (i: number, j: number) => set(p.lines.map((ls, k) => (k === i ? ls.filter((_l, n) => n !== j) : ls)));
  return (
    <div className="overflow-hidden rounded-card border bg-surface-card">
      {p.week.days.map((d, i) => {
        const { dow, dm } = dateParts(d.date, i), isToday = d.date === p.today, lines = p.lines[i] ?? [];
        const min = p.totals.dayMin[i] ?? 0;
        return (
          <div key={d.date} data-testid={tid.week.day(i)}
            className={cn('border-b px-md py-sm', i >= 5 && 'bg-surface-sunken', isToday && 'shadow-[inset_3px_0_0_var(--qp-color-brand-primary)] dark:shadow-[inset_3px_0_0_var(--qp-color-brand-accent)]')}>
            <div className="mb-xs flex items-center gap-sm">
              <span className="text-sm text-text-secondary"><b className="mr-xs text-sm text-text-primary">{dow}</b>{dm}</span>
              {isToday && <Pill tone="ok">Today</Pill>}
              {d.locked ? <Pill testId={tid.week.closed(i)} tone="warn" note={d.lockNote}>Closed</Pill>
                : d.future && <span className="text-xs text-text-muted">Not yet</span>}
              <span data-testid={tid.week.dayTotal(i)} className={cn('ml-auto text-sm font-[650] tabular-nums', zero(min))}>{p.hm(min)}</span>
            </div>
            <div className="flex flex-col gap-sm">
              {lines.map((l, j) => {
                const net = cellMinutes(l.cell, m.times);
                return (
                  <div key={j} className="flex flex-wrap items-end gap-md">
                    {m.ctx.length > 0 && <div className="flex min-w-0 flex-[1_1_240px] flex-wrap gap-sm max-md:order-first max-md:basis-full">
                      <CtxSelects week={p.week} model={m} ctx={l.ctx} testId={f => tid.week.lineCtx(i, j, f)} labelFor={lb => `${lb} for ${dow}`}
                        onCtx={(f, v) => edit(i, j, x => ({ ...x, ctx: { ...x.ctx, [f]: v, ...taskReset(f, x.ctx[f], v) } }))} className="flex min-w-0 flex-[1_1_130px] flex-col gap-xs" />
                    </div>}
                    <span className="inline-flex flex-none items-center gap-sm">
                      {m.times ? <>
                        <input data-testid={tid.week.lineCell(i, j, 'start')} type="time" step={300} aria-label={`${dow} start`} disabled={d.locked}
                          className={cn(INL, 'w-[82px] min-w-[82px] max-md:w-[76px] max-md:min-w-[76px]')} value={l.cell.start}
                          onChange={e => edit(i, j, x => ({ ...x, cell: { ...x.cell, start: e.target.value } }))} />
                        <span aria-hidden="true" className="text-sm text-text-muted">→</span>
                        <input data-testid={tid.week.lineCell(i, j, 'finish')} type="time" step={300} aria-label={`${dow} finish`} disabled={d.locked}
                          className={cn(INL, 'w-[82px] min-w-[82px] max-md:w-[76px] max-md:min-w-[76px]')} value={l.cell.finish}
                          onChange={e => edit(i, j, x => ({ ...x, cell: { ...x.cell, finish: e.target.value } }))} /></>
                        : <input data-testid={tid.week.lineCell(i, j, 'hours')} type="text" inputMode="decimal" placeholder="–" aria-label={`${dow} hours`}
                          disabled={d.locked} className={cn(INL, 'w-[82px] min-w-[82px]')} value={l.cell.hours}
                          onChange={e => edit(i, j, x => ({ ...x, cell: { ...x.cell, hours: e.target.value } }))} />}
                    </span>
                    <span className={cn('min-w-[58px] text-right text-sm font-semibold tabular-nums max-md:ml-auto', zero(net))}>{p.hm(net)}</span>
                    {j > 0 && <Button testId={tid.week.delLine(i, j)} kind="ghost" small aria-label="Remove this line" onClick={() => remove(i, j)}><Trash2 aria-hidden="true" /></Button>}
                  </div>);
              })}
            </div>
            {!d.locked && !d.future && lines.length < MAX_LINES && (
              <button type="button" data-testid={tid.week.addLine(i)} onClick={() => add(i)}
                className="mt-xs py-xs text-xs font-semibold text-brand hover:underline dark:text-brand-accent">
                + {lines.length ? 'Add a line to this day' : 'Add time for this day'}</button>)}
          </div>);
      })}
      <div className="flex items-center gap-sm border-t bg-surface-tint p-md text-sm">
        <span>Week total</span><b data-testid={tid.week.total} className="text-sm tabular-nums">{p.hm(p.totals.weekMin)}</b>
        <span className="ml-auto text-xs text-text-muted">{p.contracted}</span>
      </div>
    </div>);
}

import { useState, type DragEvent, type MouseEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { Avatar, Button, ChipButton, Empty, FilterBar, Pill, Row } from '@/ui';
import { Table, TableBody, TableCell } from '@/ui/shadcn/table';
import { rotaKeyCounts, shiftBy, shiftLetter, shiftShortTime, shiftTime, type ShiftType } from '@/domain/rota';
import { addDays } from '@/domain/time';
import type { RotaRow, RotaWeekView } from '@/contract/rota';
import {
  DAY_INDEXES, SWATCH_CLASS, TONE_CLASS, cellLabel, cellTone, dayNum, dow, hoursLine, longDay, overCap, restWarnedOn, shortDay, weekRange, working,
} from './week';

/* The week grid: the prototype's rotaGrid (qnipay-workforce-v15.html:7281-7324)
   with its CSS (826-886). A 172px name column and seven day columns, the
   cover row under them while minimum staffing is on, then the live key. Each
   cell is a drop target for a dragged shift; its button opens the picker, or
   puts a picked-up shift down (the same path, D11). */
export interface GridHandlers {
  lifted: string | null;
  /* a cell's button: puts the lifted shift down, or opens the cell. `keyboard`: Enter or Space rather than a pointer */
  onCell: (row: RotaRow, day: number, keyboard: boolean) => void;
  onDrop: (row: RotaRow, day: number, code: string) => void;
  onFill: (day: number) => void;
}

const H = 'rounded-sm px-sm pt-[9px] pb-[7px] text-center text-xs font-bold tracking-[.04em] text-text-muted uppercase';
const ROWHEAD = 'sticky left-0 z-[2] flex flex-col justify-center border-r bg-surface-card px-[9px] py-[7px]';

export function RotaGrid({ view, rows, handlers }: { view: RotaWeekView; rows: readonly RotaRow[]; handlers: GridHandlers }) {
  const [over, setOver] = useState<string | null>(null);
  const ws = view.weekStart, shifts = view.shifts, warnRest = view.rules.restWarn && view.rules.restRule;
  const drop = (r: RotaRow, day: number) => ({
    onDragOver: (e: DragEvent) => { if (!handlers.lifted) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(`${r.personCode}:${day}`); },
    onDragLeave: () => setOver(o => (o === `${r.personCode}:${day}` ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault(); setOver(null);
      const code = handlers.lifted ?? e.dataTransfer.getData('text/plain');
      if (code) handlers.onDrop(r, day, code);
    },
  });
  const click = (r: RotaRow, day: number) => (e: MouseEvent) => handlers.onCell(r, day, e.detail === 0);
  return (
    <>
      <div className="mb-md overflow-auto rounded-card border bg-surface-card max-md:hidden">
        <div data-testid={tid.trota.grid} role="grid" aria-label={`Rota, ${weekRange(ws).replace(' – ', ' to ')}`}
          className="grid min-w-[820px] grid-cols-[172px_repeat(7,minmax(96px,1fr))] gap-[3px] p-[3px]">
          <div role="row" className="contents">
            <div role="columnheader" className={H}><span className="sr-only">Colleague</span></div>
            {DAY_INDEXES.map(i => {
              const now = addDays(ws, i) === view.today;
              return (
                <div key={i} role="columnheader" className={cn(H, now && 'bg-brand-subtle text-brand dark:text-brand-accent')}>
                  <span className="block">{dow(i)}{now && ' · today'}</span>
                  <b className="block text-sm tracking-normal text-text-primary normal-case">{dayNum(ws, i)}</b>
                </div>);
            })}
          </div>
          {rows.map(r => (
            <div key={r.personCode} role="row" className="contents">
              <div role="rowheader" className={ROWHEAD}>
                <div className="text-sm leading-[1.3] font-semibold">{r.name}</div>
                <div data-testid={tid.trota.hours(r.personCode)} className={cn('text-xs text-text-muted tabular-nums', overCap(r) && 'font-bold text-err')}>{hoursLine(r)}</div>
              </div>
              {DAY_INDEXES.map(day => {
                const code = r.line[day] ?? '', key = `${r.personCode}:${day}`;
                const warned = warnRest && working(r, day) && restWarnedOn(r, day);
                return (
                  <div key={day} role="gridcell" data-testid={tid.trota.cell(r.personCode, day)} {...drop(r, day)}
                    className={cn('flex min-h-[44px] items-stretch rounded-[7px] bg-surface-sunken', !code && 'border border-dashed border-border-strong',
                      handlers.lifted && 'outline-1 -outline-offset-1 outline-border-strong outline-dashed',
                      over === key && 'bg-surface-tint outline-2 outline-brand outline-solid')}>
                    {code
                      ? <button type="button" data-testid={tid.trota.chip(r.personCode, day)} onClick={click(r, day)}
                          aria-label={`${cellLabel(shifts, r, ws, day)}${warned ? `. Under ${view.rules.restHours} hours rest` : ''}`}
                          className={cn('flex min-h-[44px] flex-1 cursor-pointer items-center gap-[6px] rounded-[7px] border-l-3 px-sm py-[5px] text-left text-xs',
                            'transition-colors duration-(--qp-duration-fast)', TONE_CLASS[cellTone(shifts, code)],
                            warned && 'shadow-[inset_0_0_0_2px_var(--qp-rota-gap-border)]')}>
                          <span aria-hidden="true" className="flex-none text-sm font-bold">{shiftLetter(code)}</span>
                          <span aria-hidden="true" className="text-xs leading-[1.25] tabular-nums">{shiftShortTime(shifts, code)}</span>
                          {warned && <span aria-hidden="true" title={`Under ${view.rules.restHours} hours rest`} className="ml-auto inline-flex [&_svg]:size-[13px]"><TriangleAlert /></span>}
                        </button>
                      : <button type="button" data-testid={tid.trota.add(r.personCode, day)} onClick={click(r, day)}
                          aria-label={`Add a shift for ${r.name} on ${shortDay(ws, day)}`}
                          className="min-h-[44px] w-full rounded-[7px] text-base text-text-disabled hover:bg-brand-subtle hover:text-brand dark:hover:text-brand-accent">+</button>}
                  </div>);
              })}
            </div>))}
          {view.rules.minStaff && (
            <div role="row" className="contents">
              <div role="rowheader" className={ROWHEAD}>
                <div className="text-sm leading-[1.3] font-semibold">Cover · min {view.min}</div>
                <div className="text-xs text-text-muted">{view.location.level} support</div>
              </div>
              {DAY_INDEXES.map(day => {
                const c = view.onShift[day] ?? 0, lo = c < view.min;
                return (
                  <div key={day} role="gridcell" data-testid={tid.trota.cov(day)} aria-label={`${shortDay(ws, day)}: ${c} of ${view.min} on shift${lo ? ', short' : ''}`}
                    className={cn('flex flex-col items-center justify-center gap-[3px] rounded-[7px] bg-surface-tint px-xs py-[6px]',
                      lo && 'border border-(--qp-rota-gap-border) bg-err-surface')}>
                    <div aria-hidden="true" className={cn('text-sm font-bold tabular-nums', lo && 'text-err')}>
                      {lo && <TriangleAlert aria-hidden="true" className="mr-[3px] inline size-[13px] align-[-2px]" />}{c}<span className="font-medium text-text-muted">/{view.min}</span></div>
                    {lo && <button type="button" data-testid={tid.trota.fill(day)} onClick={() => handlers.onFill(day)}
                      aria-label={`Fill ${shortDay(ws, day)}`}
                      className="rounded-sm border border-border-strong bg-surface-card px-[9px] py-[2px] text-xs font-semibold text-brand dark:text-brand-accent">Fill</button>}
                  </div>);
              })}
            </div>)}
        </div>
      </div>
      <RotaKey shifts={shifts} rows={rows} />
    </>);
}

/* rotaKey (v15:7261-7280, CSS 1186-1190 and 1356): what is on the grid,
   counted, in the grid's colours. Only the shift types present are listed. */
export function RotaKey({ shifts, rows }: { shifts: readonly ShiftType[]; rows: readonly RotaRow[] }) {
  const n = rotaKeyCounts(rows.map(r => r.line));
  const bits = [
    ...shifts.filter(s => n.shifts[s.code]).map(s => ({ k: s.code, tone: cellTone(shifts, s.code), code: s.code, name: s.name, count: n.shifts[s.code] ?? 0 })),
    ...(n.leave ? [{ k: 'V', tone: 'leave' as const, code: 'AL', name: 'Leave', count: n.leave }] : []),
    ...(n.sick ? [{ k: 'S', tone: 'sick' as const, code: 'S', name: 'Sickness', count: n.sick }] : []),
  ];
  return (
    <div data-testid={tid.trota.key} className="-mt-xs mb-md flex flex-wrap gap-md px-[2px] text-xs text-text-muted">
      {bits.map(b => (
        <span key={b.k} className="flex items-center gap-[5px]">
          <i aria-hidden="true" className={cn('inline-block size-[14px] rounded-[3px]', SWATCH_CLASS[b.tone])} />
          <strong className="text-text-primary">{b.code}</strong> {b.name} <b className="font-[650] text-text-primary">{b.count}</b>
        </span>))}
      {n.empty > 0 && <span className="flex items-center gap-[5px]">
        <i aria-hidden="true" className="inline-block size-[14px] rounded-[3px] border border-dashed border-border-strong bg-surface-sunken" />
        Unassigned <b className="font-[650] text-text-primary">{n.empty}</b></span>}
      {!bits.length && !n.empty && <span>No shifts on this week yet</span>}
    </div>);
}

/* rotaDayView (v15:7325-7348): one day at a time, the cover for that day as a
   status line in the card head (not a banner), one Fill, the day buttons, and
   who is on shift. On a phone it stands in for the grid. */
export function DayView({ view, rows, day, onDay, onFill }: {
  view: RotaWeekView; rows: readonly RotaRow[]; day: number; onDay: (d: number) => void; onFill: (d: number) => void;
}) {
  const ws = view.weekStart, shifts = view.shifts, c = view.onShift[day] ?? 0, lo = view.rules.minStaff && c < view.min;
  const on = rows.filter(r => !!shiftBy(shifts, r.line[day] ?? ''));
  return (
    <section data-testid={tid.trota.dayview} className="mt-md mb-md rounded-card border bg-surface-card p-(--qp-density-pad)">
      <div className="mb-md flex flex-wrap items-center gap-sm">
        <div className="text-sm font-semibold">Day at a time</div>
        <div className="ml-auto flex flex-wrap items-center gap-sm">
          <Pill testId={tid.trota.dayPill} tone={lo ? 'err' : 'ok'} glyph={lo ? <TriangleAlert aria-hidden="true" /> : '✓'}>{lo ? `${c} of ${view.min}` : `${c} on shift`}</Pill>
          <span className="text-xs text-text-muted">{longDay(ws, day)}</span>
          {lo && <Button testId={tid.trota.dayFill} kind="ghost" small onClick={() => onFill(day)}>Fill {view.min - c}</Button>}
        </div>
      </div>
      <FilterBar>
        {DAY_INDEXES.map(i => (
          <ChipButton key={i} testId={tid.trota.day(i)} on={i === day} onClick={() => onDay(i)}>
            {shortDay(ws, i)}{view.rules.minStaff && (view.onShift[i] ?? 0) < view.min
              && <><TriangleAlert aria-hidden="true" className="ml-[3px] inline size-[12px]" /><span className="sr-only">, short</span></>}</ChipButton>))}
      </FilterBar>
      <Table>
        <TableBody>
          {on.length ? on.map(r => {
            const code = r.line[day] ?? '';
            return (
              <Row key={r.personCode} testId={tid.trota.dayRow(r.personCode)}>
                <TableCell>
                  <div className="flex items-center gap-[9px]"><Avatar name={r.name} />
                    <div><strong className="font-semibold">{r.name}</strong><div className="text-xs text-text-muted">{r.jobProfileName} · {r.category}</div></div></div>
                </TableCell>
                <TableCell className="text-right">
                  <Pill tone={cellTone(shifts, code) === 'night' ? 'info' : 'neu'}>{shiftLetter(code)} · {shiftTime(shifts, code)}</Pill>
                </TableCell>
              </Row>);
          }) : <Row testId={tid.trota.dayEmpty}><TableCell><Empty>Nobody is on shift that day</Empty></TableCell></Row>}
        </TableBody>
      </Table>
    </section>);
}


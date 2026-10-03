import type { DragEvent, MouseEvent } from 'react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { NavLink } from '@/ui';
import { buttonVariants } from '@/ui/shadcn/button';
import type { ShiftTypeRecord } from '@/contract/rota';
import { TONE_CLASS, cellTone } from './week';

/* The shift palette: the prototype's shiftPalette (qnipay-workforce-v15.html:
   7247-7260) with its CSS (867-882). Each shift type is a chip in the grid's
   colours. A chip can be dragged onto a cell, or picked up with Enter, Space
   or a tap and put down on a cell the same way; every route ends in the one
   assignment path, so none can place a shift the picker would refuse (D11).
   Shared with the Shift catalogue page. */
export function Palette({ shifts, lifted, onLift, onDragStart, onDragEnd, canMake }: {
  shifts: readonly ShiftTypeRecord[]; lifted: string | null;
  /* `keyboard`: raised by Enter or Space rather than a pointer */
  onLift: (code: string, keyboard: boolean) => void;
  onDragStart: (code: string) => void; onDragEnd: () => void; canMake: boolean;
}) {
  const start = (code: string) => (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.effectAllowed = 'copy';
    try { e.dataTransfer.setData('text/plain', code); } catch { /* some browsers refuse data on dragstart; the lifted code still travels */ }
    onDragStart(code);
  };
  return (
    <div data-testid={tid.trota.palette} role="group" aria-label="Shift types. Drag onto the rota, or press Enter to pick one up."
      className="mb-md flex flex-wrap items-center gap-sm rounded-card border bg-surface-sunken px-md py-[10px] max-md:gap-[6px]">
      <span className="mr-[2px] text-xs font-[650] tracking-[.04em] text-text-muted">Drag a shift onto the rota</span>
      {shifts.map(s => (
        <button key={s.code} type="button" draggable data-testid={tid.trota.pchip(s.code)} aria-pressed={lifted === s.code}
          aria-label={`${s.name}, ${s.from} to ${s.to}. Drag onto a rota cell, or press Enter to pick it up`}
          title={`${s.name} · ${s.from}–${s.to} · ${s.hours}h${s.breakMinutes ? ` · ${s.breakMinutes}m break` : ''}`}
          onClick={(e: MouseEvent) => onLift(s.code, e.detail === 0)} onDragStart={start(s.code)} onDragEnd={onDragEnd}
          className={cn('inline-flex cursor-grab items-center gap-[6px] rounded-[7px] border-l-3 px-[10px] py-[6px] text-xs font-semibold select-none',
            'transition-shadow duration-(--qp-duration-fast) ease-qp hover:shadow-sm focus-visible:shadow-focus active:cursor-grabbing',
            TONE_CLASS[cellTone(shifts, s.code)], lifted === s.code && 'opacity-55 shadow-focus')}>
          <b>{s.code}</b> {s.name}<span className="text-xs font-medium tabular-nums opacity-75">{s.from}–{s.to}</span>
        </button>))}
      {canMake && <NavLink testId={tid.trota.newShift} to="/team/tshifts"
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}>New shift type</NavLink>}
    </div>);
}

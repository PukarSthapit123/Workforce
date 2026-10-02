import type { ReactNode } from 'react';
import { Check, Clock, Minus, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tone } from '@/ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/shadcn/tooltip';
import type { QueueRow } from '@/contract/timesheets';
import { POSTING_DOT, formatMinutes, tsStateInfo, type PostingDot as Dot } from '@/domain/timesheet';

/* What the approver's queue and matrix show of a day: the prototype's
   mgrTeamDay and mgrTeamMatrix cells (qnipay-workforce-v15.html:6990-7070). */

/* The rota line by its code (SHIFTS and SHNAME, v15:1884-1917). Rota lines
   belong to module 3; the seeded days carry the code. */
const SHIFT_NAME: Record<string, string> = { E: 'Early', L: 'Late', N: 'Night' };
export const rotaLine = (r: Pick<QueueRow, 'shift' | 'locationName'>) => {
  const name = SHIFT_NAME[r.shift];
  return name ? `${name} · ${r.locationName}` : r.locationName;
};
/* Hours as the queue prints them, "7h 30m", whatever the tenant's capture format. */
export const queueHours = (min: number) => formatMinutes(min, 'h m');
const hoursFigure = (min: number) => String(Math.round((min / 60) * 100) / 100);
/* The pay elements: the work type with its hours, then each declared allowance's pay code ("STD 9h + WAKING_NIGHT"). */
export const payElements = (r: Pick<QueueRow, 'workType' | 'minutes' | 'allowances'>) =>
  [`${r.workType || 'STD'} ${hoursFigure(r.minutes)}h`, ...r.allowances].join(' + ');
/* IMP-009: the transitions the record carries, one line each. */
export const historyText = (r: Pick<QueueRow, 'history'>) => r.history.map(h =>
  `${tsStateInfo(h.from).label} → ${tsStateInfo(h.to).label} · ${h.by.name}${h.reason ? ` · "${h.reason}"` : ''}`).join(' | ');

/* tsPill: TS_STATE's label and tone, with the glyphs the day chip draws from the shared icon set. */
const GLYPH: Record<string, ReactNode> = { draft: <Minus />, pend: <Clock />, back: <X />, resub: <RotateCw />, ok: <Check /> };
export function statePill(state: string): { label: string; tone: Tone; glyph: ReactNode } {
  const s = tsStateInfo(state);
  return { label: s.label, tone: s.tone, glyph: GLYPH[state] ?? GLYPH.draft };
}
export const isPending = (state: string) => state === 'pend' || state === 'resub';

/* The matrix pip (v15:1387-1393): approved, sent back, awaiting a decision, or nothing to show. */
export type PipState = 'ok' | 'back' | 'pend' | 'off';
export function pipFor(row: Pick<QueueRow, 'state' | 'minutes'> | undefined): { state: PipState; value: string } {
  if (!row) return { state: 'off', value: '–' };
  const state: PipState = row.state === 'ok' ? 'ok' : row.state === 'back' ? 'back' : 'pend';
  return { state, value: hoursFigure(row.minutes) };
}
export const PIP: Record<PipState, string> = {
  ok: 'bg-ok-surface text-ok', back: 'bg-err-surface text-err', pend: 'bg-info-surface text-info', off: 'bg-transparent text-text-disabled',
};

/* A hover note on something small that is not a control: focusable, with the
   note also in the document, visually hidden, for a screen reader (as Pill's note). */
function Note({ testId, note, className, children }: { testId: string; note: string; className?: string; children?: ReactNode }) {
  return (
    <TooltipProvider delayDuration={400}><Tooltip>
      <TooltipTrigger asChild>
        <span data-testid={testId} tabIndex={0} className={cn('cursor-help', className)}>{children}<span className="sr-only">{note}</span></span>
      </TooltipTrigger>
      <TooltipContent aria-hidden="true">{note}</TooltipContent>
    </Tooltip></TooltipProvider>);
}
/* The posting dot: the last state the server read, with the prototype's four tooltips verbatim (D4). */
const DOT: Record<Dot, string> = {
  posted: 'bg-ok', queued: 'bg-warn', failed: 'bg-err', none: 'border-[1.5px] border-warn bg-transparent',
};
export function PostingDot({ testId, posting }: { testId: string; posting: Dot }) {
  return <Note testId={testId} note={POSTING_DOT[posting].text}
    className={cn('mr-[7px] inline-block size-[7px] shrink-0 rounded-full align-middle', DOT[posting])} />;
}
/* The history count beside the state pill, its transitions behind hover. */
export function HistoryCount({ testId, row }: { testId: string; row: Pick<QueueRow, 'history'> }) {
  if (!row.history.length) return null;
  return <Note testId={testId} note={historyText(row)} className="ml-[6px] text-xs text-text-muted"><span aria-hidden="true">({row.history.length})</span></Note>;
}

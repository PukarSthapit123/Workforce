import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/shadcn/tooltip';

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neu' | 'hi';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-surface text-ok', warn: 'bg-warn-surface text-warn', err: 'bg-err-surface text-err',
  info: 'bg-info-surface text-info', neu: 'bg-neu-surface text-neu', hi: 'bg-brand-accent text-text-on-accent' };
/* The prototype's .pill (qnipay-workforce-v15.html:462-470): 2px 9px,
   12px/600, line-height 1.6, the status surface with its own ink. A status
   pill carries a glyph as well as its label, so colour never carries the
   meaning on its own. */
/* With a note, the pill is the prototype's .pill.tt (v15:5675-5676): it can
   take focus and shows the note on hover and focus, and the note is also in
   the document, visually hidden, so a screen reader has it without opening
   anything. */
export function Pill({ testId, tone, glyph, className, note, children }: {
  testId?: string; tone: Tone; glyph?: ReactNode; className?: string; note?: string; children: ReactNode;
}) {
  const pill = (
    <span data-testid={testId} data-tone={tone} tabIndex={note ? 0 : undefined}
      className={cn('inline-flex items-center gap-xs rounded-pill px-[9px] py-[2px] text-xs leading-[1.6] font-semibold whitespace-nowrap [&_svg]:size-[13px]', note && 'cursor-help', TONE[tone], className)}>
      {glyph && <span aria-hidden="true" className="inline-flex">{glyph}</span>}{children}{note && <span className="sr-only">: {note}</span>}</span>);
  if (!note) return pill;
  return (
    <TooltipProvider delayDuration={400}><Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent aria-hidden="true">{note}</TooltipContent>
    </Tooltip></TooltipProvider>);
}
/* The prototype's .scope (v15:686-688): a small capitals badge, such as the
   "You" beside your own role's column. */
export function ScopeBadge({ children }: { children: ReactNode }) {
  return <span data-caps className="ml-[6px] rounded-pill bg-surface-tint px-[7px] py-[2px] align-middle text-xs font-bold tracking-[.05em] text-text-muted uppercase">{children}</span>;
}

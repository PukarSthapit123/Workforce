import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* The prototype's .bars and .bar2 (qnipay-workforce-v15.html, mgrSick): a
   figure, then a 6px pill track on the tint surface filled to `pct` in the
   status colour. The figure carries the meaning; the bar only repeats it, so
   it is hidden from screen readers. */
type MeterTone = 'ok' | 'warn' | 'err';
const FILL: Record<MeterTone, string> = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err' };
export function Meter({ testId, pct, tone, strong, children }: { testId?: string; pct: number; tone: MeterTone; strong?: boolean; children: ReactNode }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-sm">
      <strong data-testid={testId} data-tone={tone} className={cn('font-semibold tabular-nums', strong ? 'text-err' : 'text-text-primary')}>{children}</strong>
      <span aria-hidden="true" className="inline-block h-[6px] min-w-[52px] flex-1 overflow-hidden rounded-pill bg-surface-tint">
        <i className={cn('block h-full rounded-pill', FILL[tone])} style={{ width: `${w}%` }} />
      </span>
    </div>);
}

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Avatar } from './Record';

/* The prototype's suggestion card and its reasons (qnipay-workforce-v15.html:
   710-726): who could take something, why, and what you can do about it.
   Used by Team rota's suggested cover and cell picker, and by Cover requests. */

/* .sug: a bordered card, 12px 16px, 8px under it; the best one (.sug.best)
   has a 1.5px brand border. .hd2 puts the avatar, the name (.nm2, 14px/600)
   with its line under it, and the actions (.acts) on one row. */
export function SugCard({ testId, name, sub, best, actions, why }: {
  testId: string; name: string; sub?: ReactNode; best?: boolean; actions?: ReactNode; why?: readonly string[];
}) {
  return (
    <div data-testid={testId} className={cn('mb-sm rounded-card border bg-surface-card px-lg py-md',
      best && 'border-[1.5px] border-brand dark:border-brand-accent')}>
      <div className="flex flex-wrap items-center gap-[10px]">
        <Avatar name={name} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{name}</div>
          {sub && <div className="text-xs text-text-muted">{sub}</div>}
        </div>
        {actions && <span className="ml-auto flex flex-wrap gap-[6px]">{actions}</span>}
      </div>
      {why && why.length > 0 && <WhyList items={why} />}
    </div>);
}
/* .why: each reason as a small success pill with a tick, the first letter capitalised. */
export function WhyList({ items }: { items: readonly string[] }) {
  return (
    <div className="mt-[9px] flex flex-wrap gap-[6px]">
      {items.map(w => <span key={w} className="rounded-pill bg-ok-surface px-sm py-[2px] text-xs font-medium text-ok">
        <span aria-hidden="true">✓ </span>{w.charAt(0).toUpperCase() + w.slice(1)}</span>)}
    </div>);
}
/* .sugwrap: the panel suggestions sit in, on the sunken surface with a brand border. */
export function SugPanel({ testId, children }: { testId: string; children: ReactNode }) {
  return <section data-testid={testId} className="mb-md rounded-card border border-brand bg-surface-sunken p-lg dark:border-brand-accent">{children}</section>;
}
/* .nolist and .r2: who is ruled out, under a dashed rule, the name on the left
   and the rule with its reason on the right in the error ink. */
export function RuledOutList({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-md border-t border-dashed pt-md">
      <div className="mb-sm text-xs font-bold tracking-[.08em] text-text-muted">{label}</div>
      {children}
    </div>);
}
export function RuledOutRow({ testId, name, why }: { testId: string; name: string; why: string }) {
  return (
    <div data-testid={testId} className="flex justify-between gap-md py-xs text-xs text-text-secondary">
      <span>{name}</span><span className="max-w-[60%] flex-none text-right text-err">{why}</span>
    </div>);
}

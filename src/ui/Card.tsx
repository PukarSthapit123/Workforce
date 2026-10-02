import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tip } from './Affordances';

/* The prototype's .card (qnipay-workforce-v15.html:451-458): the card
   surface, a 1px border, radius 12, 16px padding (--qp-density-pad), no
   shadow, 12px under it. */
export function Card({ className, children, testId }: { className?: string; children: ReactNode; testId?: string }) {
  return <div data-testid={testId} className={cn('mb-md rounded-card border bg-surface-card p-(--qp-density-pad)', className)}>{children}</div>;
}
/* .cardhead: a 14px/600 title, 8px gaps, 12px under it, actions pushed right. */
export function CardHead({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-md flex flex-wrap items-center gap-sm">
      <div className="text-sm font-semibold">{title}</div>
      {actions && <div className="ml-auto flex items-center gap-sm">{actions}</div>}
    </div>);
}

/* The 34px icon tile the prototype puts at the head of a setup card or an
   admin card (.setupcard .ic, .acard-h .ic; v15:1418-1420, 1435-1437):
   brand ink on the brand's subtle tint, the accent in dark. */
export function IconTile({ children, off }: { children: ReactNode; off?: boolean }) {
  return <span aria-hidden="true" className={cn('grid size-[34px] shrink-0 place-items-center rounded-sm [&_svg]:size-[19px] [&_svg]:stroke-[1.7]',
    off ? 'bg-surface-tint text-text-muted' : 'bg-brand-subtle text-brand dark:text-brand-accent')}>{children}</span>;
}

/* The prototype's .acard (v15:1402-1405, 1440-1442): an admin card with an
   icon tile and a 16px title, 16px 24px padding (16px on a narrow screen).
   A tip on the title carries what the card is for; `desc` is the .acard-h p
   line under the title (12px muted, 2px above). */
export function AdminCard({ icon, title, tip, tipTestId, testId, desc, children }: {
  icon: ReactNode; title: string; tip?: string; tipTestId?: string; testId?: string; desc?: ReactNode; children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="mb-md rounded-card border bg-surface-card px-xl py-lg max-lg:p-md">
      <div className="mb-md flex items-start gap-md">
        <IconTile>{icon}</IconTile>
        <div><h3>{title}{tip && tipTestId && <Tip testId={tipTestId} text={tip} />}</h3>
          {desc && <p className="mt-[2px] text-xs text-text-muted">{desc}</p>}</div>
      </div>
      {children}
    </section>);
}

import type { ReactNode } from 'react';
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tip } from './Affordances';

/* The prototype's record-display pieces, used wherever one record or one
   list of records is shown: the person record, My profile, the approval
   queues, the dimension and employee-type pages. Each names the prototype
   rule it ports (qnipay-workforce-v15.html). */

/* .avs (v15:702-704): initials on the brand's subtle tint in brand ink, the
   accent in dark. 26px in a list, larger at the head of a record. */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase();
export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return <span aria-hidden="true" className={cn('grid shrink-0 place-items-center rounded-pill bg-brand-subtle font-bold text-brand dark:text-brand-accent',
    large ? 'size-10 text-sm' : 'size-[26px] text-xs')}>{initials(name)}</span>;
}
/* .emp (v15:700): an avatar beside the person's name in a list. */
export function PersonName({ name }: { name: string }) {
  return <span className="flex items-center gap-[9px]"><Avatar name={name} /><strong className="font-semibold">{name}</strong></span>;
}
/* .emp with lines under the name, as an approval queue row shows it
   (v15:5625-5629): the avatar, then the name and what is asked of it. */
export function PersonBlock({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-[9px]">
      <Avatar name={name} />
      <div className="min-w-0"><strong className="text-sm font-semibold">{name}</strong>{children}</div>
    </div>);
}

/* .mr (v15:727-729): a label and its value on one line, a light rule under
   every row but the last. The value carries the test id. */
export function Fact({ label, testId, tip, tipTestId, children }: {
  label: string; testId?: string; tip?: string; tipTestId?: string; children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-md border-b py-sm text-sm last:border-b-0">
      <span className="text-text-secondary">{label}{tip && tipTestId && <Tip testId={tipTestId} text={tip} />}</span>
      <strong data-testid={testId} className="min-w-0 text-right font-semibold">{children}</strong>
    </div>);
}
/* .lb (v15:254-255): a small label over a group of facts. */
export function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-sm text-xs font-bold tracking-[.08em] text-text-muted', className)}>{children}</div>;
}

/* .stats and .st (v15:455-463, 951): figure tiles, 190px at least, two to a
   row on a phone. */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="mb-md grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-md max-md:grid-cols-2">{children}</div>;
}
/* `foot` is the .f line under the figure; `tone` is .st.bad and .st.warn, the figure in the status ink. */
export function Stat({ label, testId, foot, tone, children }: {
  label: string; testId?: string; foot?: ReactNode; tone?: 'bad' | 'warn'; children: ReactNode;
}) {
  return (
    <div className="rounded-card border bg-surface-card p-lg">
      <div data-caps className="text-xs font-bold tracking-[.04em] text-text-muted uppercase">{label}</div>
      <div data-testid={testId} className={cn('mt-[3px] text-2xl leading-[1.15] font-semibold tabular-nums',
        tone === 'bad' && 'text-err', tone === 'warn' && 'text-warn')}>{children}</div>
      {foot && <div className="mt-[2px] text-xs text-text-muted">{foot}</div>}
    </div>);
}

/* .banner (v15:439-453): a statement about this screen, in the status colour
   with a thick left rule. The glyph comes from the shared icon set. */
type BannerTone = 'err' | 'ok' | 'warn' | 'info';
const BANNER: Record<BannerTone, { cls: string; icon: ReactNode }> = {
  err: { cls: 'border-err bg-err-surface text-err', icon: <OctagonAlert /> },
  ok: { cls: 'border-ok bg-ok-surface text-ok', icon: <CircleCheck /> },
  warn: { cls: 'border-warn bg-warn-surface text-warn', icon: <TriangleAlert /> },
  info: { cls: 'border-info bg-info-surface text-info', icon: <Info /> },
};
/* `icon` replaces the tone's own glyph where the prototype draws a specific
   one: a padlock for a closed period, a return arrow for a resubmission. */
export function Banner({ tone, title, testId, actions, icon, children }: {
  tone: BannerTone; title: string; testId?: string; actions?: ReactNode; icon?: ReactNode; children?: ReactNode;
}) {
  const b = BANNER[tone];
  return (
    <div data-testid={testId} role="note" className={cn('mb-md flex items-start gap-md rounded-card border border-l-4 px-lg py-md max-md:flex-wrap', b.cls)}>
      <span aria-hidden="true" className="mt-[3px] shrink-0 [&_svg]:size-[15px]">{icon ?? b.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {children && <div className="mt-px text-xs opacity-90">{children}</div>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 gap-sm max-md:ml-0 max-md:w-full">{actions}</div>}
    </div>);
}

/* .empty (v15:479-480): nothing to show, said in the middle of its card. */
export function Empty({ testId, children }: { testId?: string; children: ReactNode }) {
  return <div data-testid={testId} className="px-lg py-2xl text-center text-sm text-text-muted">{children}</div>;
}
/* .count (v15:550), pushed to the end of a filter bar (.rt2, 539 and 958). */
export function Count({ testId, children }: { testId?: string; children: ReactNode }) {
  return <span data-testid={testId} className="ml-auto text-xs text-text-muted tabular-nums max-md:w-full">{children}</span>;
}
/* .sm (v15:251): the 12px muted line under a title. */
export function Small({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <p data-testid={testId} className={cn('text-xs leading-[1.45] text-text-muted', className)}>{children}</p>;
}
/* .sm closing a card, set off from the rows above it (v15:5633). */
export function CardNote({ children }: { children: ReactNode }) {
  return <Small className="mt-[10px]">{children}</Small>;
}

/* .arow (v15:1449-1456, 954): one setting, its name and what it does on the
   left, its control on the right; on a phone the control drops under it. */
export function SettingRow({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-md border-b py-[11px] last:border-b-0">
      <div className="min-w-[190px] flex-1">
        <b className="block text-sm font-semibold">{title}</b>
        {desc && <span className="mt-px block text-xs text-text-muted">{desc}</span>}
      </div>
      <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-sm max-md:w-full max-md:justify-start">{children}</div>
    </div>);
}

/* .wtchip (v15:1477-1484): a pill that picks one record out of a few. The
   one picked is filled brand, the accent in dark; `add` is the dashed pill
   that starts a new one. */
export function ChipPicker({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div data-testid={testId} className="mb-lg flex flex-wrap gap-[7px]">{children}</div>;
}
export function Chip({ testId, on, add, onClick, children, ...rest }: {
  testId: string; on?: boolean; add?: boolean; onClick(): void; children: ReactNode; 'aria-label'?: string;
}) {
  return (
    <button type="button" data-testid={testId} aria-pressed={add ? undefined : !!on} onClick={onClick} {...rest}
      className={cn('inline-flex min-h-[34px] items-center gap-[6px] rounded-pill border px-[13px] py-[7px] text-sm font-medium transition-colors max-md:min-h-touch',
        on ? 'border-brand bg-brand text-text-on-brand dark:border-brand-accent dark:bg-brand-accent dark:text-text-on-accent'
          : 'border-border-strong bg-surface-card hover:bg-surface-tint',
        add && 'border-dashed text-brand dark:text-brand-accent')}>
      {children}
    </button>);
}

/* .setupcard (v15:1406-1432), as a button: the 34px icon tile, a 16px/600
   title, a 12px/600 line in brand ink, a count pill top right. The setup
   index draws the same card as a link. */
export function SetupCardButton({ testId, icon, title, sub, count, countLabel, describedBy, onClick }: {
  testId: string; icon: ReactNode; title: string; sub: string; count: number; countLabel: string; describedBy?: string; onClick(): void;
}) {
  return (
    <button type="button" data-testid={testId} aria-describedby={describedBy} onClick={onClick}
      className="flex items-start gap-md rounded-card border bg-surface-card p-lg text-left transition-[border-color,box-shadow] duration-(--qp-duration-fast) ease-qp hover:border-brand hover:shadow-sm dark:hover:border-brand-accent">
      <span aria-hidden="true" className="grid size-[34px] shrink-0 place-items-center rounded-sm bg-brand-subtle text-brand dark:text-brand-accent [&_svg]:size-[19px] [&_svg]:stroke-[1.7]">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-base leading-[normal] font-semibold text-text-primary">{title}</span>{' '}
        <span className="mt-xs text-xs leading-[normal] font-semibold text-brand dark:text-brand-accent">{sub}</span>
      </span>{' '}
      <span className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-pill bg-surface-tint px-xs text-xs font-bold text-text-muted">
        <span aria-hidden="true">{count}</span><span className="sr-only">{countLabel}</span></span>
    </button>);
}

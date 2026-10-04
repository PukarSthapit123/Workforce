import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import type { NotificationItem } from '@/contract/notifications';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { NavLink } from '@/ui';

/* What the bell shows: the reader's inbox as the server answered it. */
export interface InboxState {
  status: 'loading' | 'error' | 'ready'; items: NotificationItem[]; unread: number;
  /* marking read is off while looking at the app as someone else */
  readOnly: boolean; markAllPending: boolean;
  onOpen(item: NotificationItem): void; onMarkAll(): void;
}
export const emptyInbox = (unread = 0): InboxState =>
  ({ status: 'ready', items: [], unread, readOnly: false, markAllPending: false, onOpen: () => {}, onMarkAll: () => {} });

/* The bell (v15:1614-1622, .iconbtn .b v15:291-293) and its panel, .npanel
   (v15:646-698): 376px of card surface under the bell, a sticky head with
   "Mark all read", one row per item with its unread dot, title, detail, the
   source in capitals and, when the page it opens is reachable, " · <page>"
   and a chevron. Only a reachable item is a link (IMP-017). Outside the panel
   or Escape closes it (v15:10806-10808, 13223). */
export function NotificationBell({ inbox }: { inbox: InboxState }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (e.target instanceof Node && !box.current?.contains(e.target)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const { unread } = inbox;
  return (
    <div ref={box} className="relative">
      <button type="button" data-testid={tid.shell.bell} aria-label={`Notifications, ${unread} unread`} aria-expanded={open} aria-controls={open ? tid.inbox.panel : undefined}
        onClick={() => setOpen(o => !o)}
        className="relative grid size-[34px] shrink-0 place-items-center rounded-pill text-shell-ink transition-colors duration-(--qp-duration-fast) hover:bg-shell-hover max-md:size-11 [&>svg]:size-[18px]">
        <Bell aria-hidden="true" />
        {unread > 0 && <span data-testid={tid.shell.bellCount} className="absolute top-px right-0 grid h-4 min-w-4 place-items-center rounded-pill bg-brand-accent px-xs text-xs leading-none font-bold text-text-on-accent max-md:top-[6px] max-md:right-[4px]">{unread}</span>}
      </button>
      {open && <InboxPanel inbox={inbox} onClose={() => setOpen(false)} />}
    </div>);
}

function InboxPanel({ inbox, onClose }: { inbox: InboxState; onClose(): void }) {
  return (
    <div id={tid.inbox.panel} data-testid={tid.inbox.panel} role="dialog" aria-label="Notifications"
      className="absolute top-11 right-0 z-[90] max-h-[70vh] w-[376px] overflow-auto rounded-card border bg-surface-card text-text-primary shadow-lg max-md:fixed max-md:top-[60px] max-md:right-[12px] max-md:w-[min(340px,calc(100vw-24px))]">
      <div className="sticky top-0 flex items-center border-b bg-surface-card px-lg py-md">
        <h4 className="flex-1 text-sm font-semibold">Notifications</h4>
        <button type="button" data-testid={tid.inbox.markAll} onClick={inbox.onMarkAll}
          disabled={inbox.readOnly || inbox.markAllPending || inbox.unread === 0}
          title={inbox.readOnly ? 'You are looking at the app as someone else, so nothing is marked read.' : undefined}
          className="min-h-touch text-xs font-semibold text-brand disabled:opacity-55 dark:text-brand-accent">Mark all read</button>
      </div>
      {inbox.status === 'loading' && <p data-testid={tid.inbox.loading} className="px-lg py-md text-sm text-text-muted">Loading your notifications&hellip;</p>}
      {inbox.status === 'error' && <p data-testid={tid.inbox.error} className="px-lg py-md text-sm text-err">Your notifications could not be loaded. Close this and open it again.</p>}
      {inbox.status === 'ready' && (inbox.items.length
        ? inbox.items.map(n => <InboxRow key={n.id} n={n} onOpen={() => { onClose(); inbox.onOpen(n); }} />)
        : <p data-testid={tid.inbox.empty} className="px-lg py-xl text-center text-sm text-text-muted">Nothing new</p>)}
    </div>);
}

const ROW = 'flex items-start gap-[10px] border-b px-lg py-md text-sm last:border-b-0';
function InboxRow({ n, onOpen }: { n: NotificationItem; onOpen(): void }) {
  const body = (
    <>
      <span data-testid={tid.inbox.dot(n.id)} data-unread={!n.read || undefined} aria-hidden="true"
        className={cn('mt-[6px] size-[7px] flex-none rounded-full', n.read ? 'bg-transparent' : 'bg-brand dark:bg-brand-accent')} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{!n.read && <span className="sr-only">Unread. </span>}{n.title}</div>
        <div className="mt-px text-xs text-text-muted">{n.body}</div>
        <span className="mt-[3px] inline-block text-xs font-bold tracking-[.04em] text-text-muted uppercase">
          {n.area}{n.link && <span data-testid={tid.inbox.dest(n.id)}> · {n.link.label}</span>}</span>
      </div>
      <span className="flex-none text-xs text-text-muted">{n.ago}</span>
      {n.link && <span aria-hidden="true" className="mt-[2px] flex-none text-base leading-none text-text-muted">›</span>}
    </>);
  if (!n.link) return <div data-testid={tid.inbox.item(n.id)} className={ROW}>{body}</div>;
  return (
    <NavLink to={n.link.path} testId={tid.inbox.item(n.id)} onClick={onOpen} aria-label={`${n.read ? '' : 'Unread. '}${n.title}. Open ${n.link.label}.`}
      className={cn(ROW, 'cursor-pointer transition-colors duration-(--qp-duration-fast) hover:bg-surface-tint focus-visible:shadow-focus focus-visible:outline-none')}>
      {body}
    </NavLink>);
}

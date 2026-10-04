import { Megaphone } from 'lucide-react';
import { tid } from '@/testids';
import { Button, Card, CardHead, NavLink, Pill, Small, toastInfo } from '@/ui';
import { buttonVariants } from '@/ui/shadcn/button';
import { useAcknowledgeNotice, useMyNotices } from '@/api/notices';
import { formatDmy } from '@/domain/time';
import { useCaps } from '@/shell/useCaps';
import { useTenant } from '@/shell/shellData';
import { NoticeMarks, ReaderPill } from './NoticeParts';

/* The Notices card on My home: the prototype's noticeHomeCard
   (qnipay-workforce-v15.html:5811-5825). Shown only while the notice board
   is on, the person may read notices and something is live for them: up to
   three, urgent first, then pinned, then newest, each with Acknowledge while
   it is owed; how many are still to acknowledge; how many more there are;
   and View all. Group 7 places it on My home. */
export function NoticesHomeCard() {
  const caps = useCaps(), flags = useTenant().data?.flags ?? {};
  const on = caps.has('own_notices') && flags.NOTICES === true;
  const q = useMyNotices(on);
  const ack = useAcknowledgeNotice();
  const live = on ? q.data?.items.filter(n => n.status === 'current') ?? [] : [];
  if (!live.length || !q.data) return null;
  const more = live.length - 3, owed = q.data.owed;
  return (
    <Card testId={tid.noticeHome.card}>
      <CardHead title="Notices" actions={<>
        {owed > 0 && <Pill testId={tid.noticeHome.owed} tone="warn">{owed} to acknowledge</Pill>}
        <NavLink testId={tid.noticeHome.all} to="/work/notices" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>View all</NavLink>
      </>} />
      {live.slice(0, 3).map(n => (
        <div key={n.id} data-testid={tid.noticeHome.row(n.id)} className="flex items-center gap-md border-b py-[11px] last:border-b-0">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-tint [&_svg]:size-4"><Megaphone /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold"><NoticeMarks urgent={n.urgent} pinned={n.pinned} />{n.title}</div>
            <Small>{n.scopeLabel} · {formatDmy(n.from)}</Small>
          </div>
          {n.owed
            ? <Button testId={tid.noticeHome.ack(n.id)} kind="primary" small pending={ack.isPending(`notice/${n.id}`)} aria-label={`Acknowledge ${n.title}`}
                onClick={() => ack.mutate({ id: n.id, textVersion: n.textVersion }, { onSuccess: r => toastInfo(r.message) })}>Acknowledge</Button>
            : <ReaderPill testId={tid.noticeHome.state(n.id)} you={n.you} at={n.acknowledgedAt} />}
        </div>))}
      {more > 0 && <Small testId={tid.noticeHome.more} className="pt-sm">{more} more notice{more === 1 ? '' : 's'}</Small>}
    </Card>);
}

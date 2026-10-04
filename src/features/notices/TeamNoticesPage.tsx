import { useState } from 'react';
import { tid } from '@/testids';
import { Button, Card, ChipButton, Empty, FilterBar, GuideButton, Page, PageHead, Row, ScopeBadge, Small, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { usePostNotice, usePostedNotices, type PostedNotices, type PosterNotice, type StatusFilter } from '@/api/notices';
import { NOTICE_STATUS } from '@/domain/notices';
import { formatDmy } from '@/domain/time';
import { NoticeMarks, StatusPill } from './NoticeParts';
import { EditDialog, TrackDialog, WithdrawDialog } from './TeamNoticeDialogs';

/* My team → Notices: the prototype's mgrNotices (qnipay-workforce-v15.html:
   5870-5897). Every notice the poster manages, draft first, then live,
   scheduled, expired and withdrawn, each urgent, then pinned, then newest;
   organisation notices outside their scope are shown read-only. A row says
   who it is for, its state, how many of its audience have acknowledged the
   current version and when it ends, with Open (the tracker) and Post for a
   draft. Status filters with their counts sit above the table (the
   prototype had none). A manager posts within their own location, an
   administrator with Post notices to everyone anywhere; the server checks
   both again. The prototype's "working in" picker is not built: a manager's
   location is the one on their record. */
const FILTERS: readonly StatusFilter[] = ['all', 'draft', 'current', 'scheduled', 'expired', 'withdrawn'];
const filterLabel = (f: StatusFilter) => (f === 'all' ? 'All' : NOTICE_STATUS[f].label);

type Open = { kind: 'new' } | { kind: 'track'; id: string } | { kind: 'edit'; notice: PosterNotice } | { kind: 'withdraw'; notice: PosterNotice } | null;

export function TeamNoticesPage() {
  const [fil, setFil] = useState<StatusFilter>('all');
  const q = usePostedNotices(fil);
  const [open, setOpen] = useState<Open>(null);
  const refused = q.error instanceof ApiError ? q.error.refusal : null;
  const d = q.data;
  const lede = d ? `${d.org ? 'Everyone you can post to' : d.location || 'Your location'}. What was said, to whom, and who has acknowledged it.` : undefined;
  return (
    <Page testId={tid.page('tnotices')}>
      <PageHead title="Notices" crumb="My team · Notices" tip={lede} tipTestId={tid.tnotices.tip}
        actions={<><GuideButton view="tnotices" />
          <Button testId={tid.tnotices.add} kind="primary" disabled={!d} onClick={() => setOpen({ kind: 'new' })}>New notice</Button></>} />
      {q.isError && <p data-testid={tid.tnotices.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'The notices could not be loaded. Reload the page to try again.'}</p>}
      {!d && !q.isError && <p data-testid={tid.tnotices.loading} className="text-text-secondary">Loading the notices&hellip;</p>}
      {d && (
        <Card>
          <FilterBar>
            {FILTERS.map(f => <ChipButton key={f} testId={tid.tnotices.filter(f)} on={fil === f} onClick={() => setFil(f)}>{filterLabel(f)} · {d.counts[f]}</ChipButton>)}
          </FilterBar>
          <PostedTable d={d} fil={fil} onOpen={id => setOpen({ kind: 'track', id })} onNew={() => setOpen({ kind: 'new' })} />
        </Card>)}
      {d && open?.kind === 'new' && <EditDialog scopes={d.scopes} org={d.org} today={d.today} onClose={() => setOpen(null)} />}
      {d && open?.kind === 'edit' && <EditDialog key={`${open.notice.id}:${open.notice.version}`} notice={open.notice} scopes={d.scopes} org={d.org} today={d.today} onClose={() => setOpen(null)} />}
      {open?.kind === 'track' && <TrackDialog id={open.id} onClose={() => setOpen(null)}
        onEdit={n => setOpen({ kind: 'edit', notice: n })} onWithdraw={n => setOpen({ kind: 'withdraw', notice: n })} />}
      {open?.kind === 'withdraw' && <WithdrawDialog notice={open.notice} onClose={() => setOpen(null)} />}
    </Page>);
}

function PostedTable({ d, fil, onOpen, onNew }: { d: PostedNotices; fil: StatusFilter; onOpen: (id: string) => void; onNew: () => void }) {
  const post = usePostNotice();
  if (!d.items.length) return (
    <Empty testId={tid.tnotices.empty}>{fil === 'all'
      ? <>No notices yet. <Button testId={tid.tnotices.emptyAdd} kind="link" onClick={onNew}>Post the first one</Button></>
      : `No ${filterLabel(fil).toLowerCase()} notices.`}</Empty>);
  return (
    <Table data-testid={tid.tnotices.table} variant="records">
      <TableHeader><TableRow>
        <TableHead>Notice</TableHead><TableHead>For</TableHead><TableHead>State</TableHead><TableHead>Acknowledged</TableHead><TableHead>Ends</TableHead>
        <TableHead><span className="sr-only">Actions</span></TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {d.items.map(n => (
          <Row key={n.id} testId={tid.tnotices.row(n.id)}>
            <TableCell kind="title"><NoticeMarks urgent={n.urgent} pinned={n.pinned} /><b>{n.title}</b>
              <Small className="font-normal">{n.id} · v{n.textVersion} · {n.by}</Small></TableCell>
            <TableCell label="For"><ScopeBadge>{n.scopeLabel}</ScopeBadge></TableCell>
            <TableCell label="State"><StatusPill testId={tid.tnotices.state(n.id)} status={n.status} /></TableCell>
            <TableCell label="Acknowledged" className="tabular-nums">
              <span data-testid={tid.tnotices.acks(n.id)}>{n.mustAck && n.state !== 'draft' ? `${n.acknowledged} of ${n.audience}` : <span className="text-xs text-text-muted">—</span>}</span></TableCell>
            <TableCell label="Ends" className="tabular-nums">{n.until ? formatDmy(n.until) : <span className="text-xs text-text-muted">No end date</span>}</TableCell>
            <TableCell kind="foot" className="text-right whitespace-nowrap">
              <span className="inline-flex flex-wrap items-center justify-end gap-sm">
                <Button testId={tid.tnotices.open(n.id)} kind="ghost" small aria-label={`Open ${n.title}`} onClick={() => onOpen(n.id)}>Open</Button>
                {n.mine && n.state === 'draft' && <Button testId={tid.tnotices.post(n.id)} kind="primary" small pending={post.isPending(`notice/${n.id}`)}
                  aria-label={`Post ${n.title}`} onClick={() => post.mutate({ id: n.id, ifMatch: n.version }, { onSuccess: r => toastInfo(r.message) })}>Post</Button>}
                {!n.mine && <span data-testid={tid.tnotices.readOnly(n.id)} className="text-xs text-text-muted">Read only</span>}
              </span>
            </TableCell>
          </Row>))}
      </TableBody>
    </Table>);
}

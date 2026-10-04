import { useState } from 'react';
import { tid } from '@/testids';
import { Banner, Button, Card, CardHead, Empty, GuideButton, Modal, Page, PageHead, Row, ScopeBadge, Seg, Small, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useAcknowledgeNotice, useMyNotice, useMyNotices, type ReaderNotice } from '@/api/notices';
import { formatDmy } from '@/domain/time';
import { RotateCw } from 'lucide-react';
import { NoticeMarks, ReaderPill } from './NoticeParts';

/* My work → Notices: the prototype's essNotices (qnipay-workforce-v15.html:
   5828-5854) and noticeReadBox (5855-5867). Current and Expired, each with
   its count; a row per notice aimed at me (worked out from my record now)
   with who it is for, when it was posted, where I stand, Read, and
   Acknowledge while I owe it. Acknowledging sends the version I read, so an
   edit in between is refused and the notice read again (D10). The lede
   ("name · location") is left out, as every page head is (fidelity rule 3). */
type Fil = 'current' | 'expired';

export function NoticesPage() {
  const q = useMyNotices();
  const [fil, setFil] = useState<Fil>('current');
  const [reading, setReading] = useState<string | null>(null);
  const ack = useAcknowledgeNotice();
  const refused = q.error instanceof ApiError ? q.error.refusal : null;
  const list = q.data?.items.filter(n => n.status === fil) ?? [];
  const acknowledge = (n: ReaderNotice) => ack.mutate({ id: n.id, textVersion: n.textVersion }, { onSuccess: r => { toastInfo(r.message); setReading(null); } });
  const open = q.data?.items.find(n => n.id === reading);
  return (
    <Page testId={tid.page('notices')}>
      <PageHead title="Notices" crumb="My work · Notices" actions={<GuideButton view="notices" />} />
      {q.isError && <p data-testid={tid.notices.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Your notices could not be loaded. Reload the page to try again.'}</p>}
      {!q.data && !q.isError && <p data-testid={tid.notices.loading} className="text-text-secondary">Loading your notices&hellip;</p>}
      {q.data && (
        <Card>
          <CardHead title={<Seg label="Which notices" value={fil} onChange={setFil} testId={tid.notices.seg}
            options={[{ value: 'current', label: `Current · ${q.data.counts.current}` }, { value: 'expired', label: `Expired · ${q.data.counts.expired}` }]} />} />
          {list.length
            ? <Table data-testid={tid.notices.table} variant="records">
                <TableHeader><TableRow>
                  <TableHead>Notice</TableHead><TableHead>For</TableHead><TableHead>Posted</TableHead><TableHead>You</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.map(n => (
                    <Row key={n.id} testId={tid.notices.row(n.id)}>
                      <TableCell kind="title"><NoticeMarks urgent={n.urgent} pinned={n.pinned} /><b>{n.title}</b>
                        <Small className="font-normal">v{n.textVersion} · {n.by}</Small></TableCell>
                      <TableCell label="For"><ScopeBadge>{n.scopeLabel}</ScopeBadge></TableCell>
                      <TableCell label="Posted" className="tabular-nums">{formatDmy(n.from)}{n.until && <Small>until {formatDmy(n.until)}</Small>}</TableCell>
                      <TableCell label="You"><ReaderPill testId={tid.notices.you(n.id)} you={n.you} at={n.acknowledgedAt} /></TableCell>
                      <TableCell kind="foot" className="text-right whitespace-nowrap">
                        <span className="inline-flex flex-wrap justify-end gap-sm">
                          <Button testId={tid.notices.read(n.id)} kind="ghost" small aria-label={`Read ${n.title}`} onClick={() => setReading(n.id)}>Read</Button>
                          {n.owed && <Button testId={tid.notices.ack(n.id)} kind="primary" small pending={ack.isPending(`notice/${n.id}`)}
                            aria-label={`Acknowledge ${n.title}`} onClick={() => acknowledge(n)}>Acknowledge</Button>}
                        </span>
                      </TableCell>
                    </Row>))}
                </TableBody>
              </Table>
            : <Empty testId={tid.notices.empty}>{fil === 'expired' ? 'No expired notices.' : 'No notices for you right now.'}</Empty>}
        </Card>)}
      {open && <ReadDialog key={open.id} listed={open} pending={ack.isPending(`notice/${open.id}`)}
        onAck={acknowledge} onClose={() => setReading(null)} />}
    </Page>);
}

/* noticeReadBox: the whole text, the version and who posted it, a banner when
   it changed after I acknowledged it, and Acknowledge while I owe it. It reads
   the notice again on opening, so the words are the server's latest. */
function ReadDialog({ listed, pending, onAck, onClose }: {
  listed: ReaderNotice; pending: boolean; onAck: (n: ReaderNotice) => void; onClose: () => void;
}) {
  const n = useMyNotice(listed.id).data ?? listed;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={n.title}
      footer={<>
        <Button testId={tid.notices.readClose} kind="ghost" onClick={onClose}>Close</Button>
        {n.owed
          ? <Button testId={tid.notices.readAck} kind="primary" pending={pending} onClick={() => onAck(n)}>Acknowledge</Button>
          : <ReaderPill testId={tid.notices.readState} you={n.you} at={n.acknowledgedAt} />}
      </>}>
      <Small testId={tid.notices.readMeta}><NoticeMarks urgent={n.urgent} pinned={n.pinned} />
        {n.scopeLabel} · v{n.textVersion} · {n.by} · {formatDmy(n.from)}</Small>
      <div data-testid={tid.notices.readBody} className="my-md text-sm whitespace-pre-wrap">{n.body}</div>
      {n.you === 'again' && <Banner testId={tid.notices.readChanged} tone="warn" icon={<RotateCw />} title="This notice changed after you acknowledged it">
        You acknowledged an earlier version. Read this one and acknowledge again.</Banner>}
    </Modal>);
}

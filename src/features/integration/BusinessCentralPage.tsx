import { useEffect, useEffectEvent } from 'react';
import { Check, Clock, Shuffle, X } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Banner, Button, Empty, NavLink, Page, PageHead, Pill, Row, Small, Stat, Stats, Tip, toastInfo, toastRefusal } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useShellData } from '@/shell/shellData';
import { useDispatchPostings, usePostingLog, useRetryPosting, type PostingLog, type PostingRow } from '@/api/integration';
import { DISPATCH_DELAY_MS, POSTING_STATE, postingNote, resolutionToast } from '@/domain/integration';
import { PAY_BASIS, retryToast } from '@/domain/timesheet';
import { formatDateTime } from '@/lib/format';

const TIP = 'The payroll boundary. The platform posts hours and pay codes and never resolves money.';
const BANNER_TIP = 'The approval, the payload and the posting state are real and recorded. Only the outbound call is represented.';
const GLYPH = { queued: <Clock />, posted: <Check />, failed: <X /> } as const;

/* Business Central: the prototype's admBC (qnipay-workforce-v15.html:
   9911-9948). The banner says the integration is simulated; P's four tiles;
   the posting log, newest first, with its integration id and attempt, and
   Retry on a failed row only; then each pay code's Business Central element,
   read only here. A retry only re-queues and counts, and its toast never
   claims acceptance. The dispatcher stands in for the posting worker (P2):
   while a record is queued, the screen waits P's delay (INT_DELAY) and asks
   the server to dispatch, as P's timer does, and toasts what it resolved.
   Nothing changes on screen until the server has answered, so queued stays
   queued until the dispatcher has resolved it. */
export function BusinessCentralPage({ dispatchDelay = DISPATCH_DELAY_MS }: { dispatchDelay?: number }) {
  const q = usePostingLog();
  return (
    <Page testId={tid.page('ibc')}>
      <PageHead title="Business Central" crumb="Qnipay setup · Business Central" tip={TIP} tipTestId={tid.head.tip('ibc')} />
      <Banner testId={tid.ibc.banner} tone="info" title={<>Simulated integration<Tip testId={tid.ibc.bannerTip} text={BANNER_TIP} /></>}>
        The platform posts hours and pay codes and never resolves money. The call to Business Central is represented, not made.
        Every result below is <strong>simulated</strong>, not a Business Central confirmation.
      </Banner>
      {q.data
        ? <LogView log={q.data} dispatchDelay={dispatchDelay} />
        : q.isError
          ? <p data-testid={tid.ibc.error} role="alert" className="text-err">The posting log could not be loaded, so nothing here is current. Reload the page.</p>
          : <p data-testid={tid.ibc.loading} className="text-text-secondary">Loading the posting log&hellip;</p>}
    </Page>);
}

function announce(a: PostingRow) {
  const t = resolutionToast(a);
  if (t?.kind === 'info') toastInfo(t.message);
  else if (t) toastRefusal(t);
}

function LogView({ log, dispatchDelay }: { log: PostingLog; dispatchDelay: number }) {
  const retry = useRetryPosting(), dispatcher = useDispatchPostings();
  const shell = useShellData();
  const payCodes = shell.kind === 'ready' ? shell.nav.flatMap(g => g.tabs).find(t => t.view === 'mpay')?.path : undefined;
  /* the queued records as last read: the dispatcher is asked once per set of them */
  const queued = log.attempts.filter(a => a.state === 'queued').map(a => `${a.id}:${a.version}`).join('|');
  const runDispatcher = useEffectEvent(() => { dispatcher.mutate(undefined, { onSuccess: x => x.resolved.forEach(announce) }); });
  useEffect(() => {
    if (!queued) return;
    const t = window.setTimeout(() => runDispatcher(), dispatchDelay);
    return () => window.clearTimeout(t);
  }, [queued, dispatchDelay]);
  const t = log.tiles;
  return (
    <>
      <Stats>
        <Stat testId={tid.ibc.tile('posted')} label="Posted this period" foot="simulated posting · not BC-confirmed">{t.posted}</Stat>
        <Stat testId={tid.ibc.tile('queued')} label="Queued" foot="awaiting a result">{t.queued}</Stat>
        <Stat testId={tid.ibc.tile('failed')} label="Failed" tone={t.failed ? 'bad' : 'good'} foot="needs the cause fixing, then a retry">{t.failed}</Stat>
        <Stat testId={tid.ibc.tile('mapped')} label="Pay codes mapped" foot={`of ${t.codes} codes · each to one BC pay element`}>{t.mapped}</Stat>
      </Stats>
      <Table data-testid={tid.ibc.log} variant="records" dense>
        <TableHeader><TableRow>
          <TableHead>Time</TableHead><TableHead>Integration ID</TableHead><TableHead>Event</TableHead><TableHead>Reference</TableHead>
          <TableHead>Pay</TableHead><TableHead className="text-right">Attempt</TableHead><TableHead>State</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {log.attempts.map(a => {
            const S = POSTING_STATE[a.state];
            return (
              <Row key={a.id} testId={tid.ibc.row(a.id)}>
                <TableCell label="Time" className="text-xs tabular-nums">{formatDateTime(a.at)}</TableCell>
                <TableCell kind="title" className="text-xs tabular-nums">{a.integrationId}</TableCell>
                <TableCell label="Event">{a.event}</TableCell>
                <TableCell label="Reference">{a.ref}</TableCell>
                <TableCell label="Pay" className="text-xs">{a.summary}</TableCell>
                <TableCell label="Attempt" className="text-right tabular-nums" data-testid={tid.ibc.attempt(a.id)}>{a.attempt}</TableCell>
                <TableCell label="State">
                  <Pill testId={tid.ibc.state(a.id)} tone={S.tone} glyph={GLYPH[a.state]} note={postingNote(a)}>
                    {S.label}{a.state === 'posted' && a.simulated && <span className="text-xs font-normal"> (simulated)</span>}
                  </Pill></TableCell>
                <TableCell kind="foot" className="text-right">
                  {a.state === 'failed' && (
                    <Button testId={tid.ibc.retry(a.id)} kind="ghost" small pending={retry.isPending(`posting/${a.id}`)}
                      onClick={() => retry.mutate(a, { onSuccess: x => toastInfo(retryToast(x.record.attempt)) })}>Retry</Button>)}
                </TableCell>
              </Row>);
          })}
        </TableBody>
      </Table>
      {log.attempts.length === 0 && <Empty testId={tid.ibc.empty}>Nothing has been queued for Business Central yet. Approving a timesheet queues it.</Empty>}
      <Small testId={tid.ibc.retryNote} className="mb-md">A retry re-queues the record and counts the attempt. It does not clear the underlying cause: a payload
        that failed on bad reference data will fail again until the data is corrected.</Small>
      <AdminCard testId={tid.ibc.mapping} icon={<Shuffle />} title="Pay element mapping" desc="One pay code, one Business Central element">
        <Table variant="records" dense>
          <TableHeader><TableRow>
            <TableHead>Pay code</TableHead><TableHead>Basis</TableHead><TableHead>BC element</TableHead><TableHead>Direction</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {log.mapping.map(m => (
              <Row key={m.code} testId={tid.ibc.mappingRow(m.code)}>
                <TableCell kind="title" className="tabular-nums">{m.code}</TableCell>
                <TableCell label="Basis" className="text-xs">{PAY_BASIS[m.basis].label}</TableCell>
                <TableCell label="BC element" className="tabular-nums">{m.element || '—'}</TableCell>
                <TableCell label="Direction" className="text-xs">Workforce → Business Central</TableCell>
              </Row>))}
          </TableBody>
        </Table>
        <Small className="mt-[10px]">
          Read only here. {payCodes
            ? <>Codes and their elements are kept on <NavLink testId={tid.ibc.payCodes} to={payCodes} className="font-semibold text-brand underline dark:text-brand-accent">Pay codes</NavLink>.</>
            : 'Codes and their elements are kept on Pay codes.'}
        </Small>
      </AdminCard>
    </>);
}

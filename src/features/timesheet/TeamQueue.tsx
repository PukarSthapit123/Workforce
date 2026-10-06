import { useState } from 'react';
import { AlarmClock, History } from 'lucide-react';
import { tid } from '@/testids';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { Avatar, Button, ChipButton, Empty, FilterBar, FormWarn, Pill, Row, SearchFilter, Small, Tip, toastInfo } from '@/ui';
import { useApprovalQueue, useDecideDay, type QueueRow, type QueueStatus } from '@/api/timesheets';
import { formatDmy } from '@/domain/timesheet';
import { latest } from '@/lib/latest';
import { ReturnDialog } from './TeamDialogs';
import { HistoryCount, PostingDot, isPending, payElements, queueHours, rotaLine, statePill } from './team';

/* mgrTeamDay (qnipay-workforce-v15.html:7035-7075): the approver's queue.
   "Needs approval" is anything awaiting a decision, so a corrected
   resubmission cannot fall out of it. Approve writes and toasts once the
   server has answered; Return opens the dialog. */
const FILTERS: QueueStatus[] = ['pend', 'all', 'resub', 'ok', 'back'];

export function TeamQueue({ returnReasonRequired }: { returnReasonRequired: boolean }) {
  const [status, setStatus] = useState<QueueStatus>('pend');
  const [q, setQ] = useState('');
  const list = useApprovalQueue({ status, q });
  const decide = useDecideDay();
  const [returning, setReturning] = useState<QueueRow | null>(null);
  const counts = list.data?.counts;
  const label = (f: QueueStatus) => f === 'pend' ? `Needs approval · ${counts?.pend ?? 0}` : f === 'all' ? 'All'
    : f === 'resub' ? `Resubmitted · ${counts?.resub ?? 0}` : f === 'ok' ? 'Approved' : 'Sent back';
  const approve = (r: QueueRow) => decide.mutate({ day: r, to: 'ok', reason: '' },
    { onSuccess: () => toastInfo(`Approved · ${r.personName} · queued for Business Central`) });
  const rows = list.data?.rows ?? [];
  /* the dialog works on the row as last read, so a retry after a 412 sends the fresh version */
  const ret = returning && latest(returning, rows);
  return (
    <>
      <FilterBar>
        {FILTERS.map(f => <ChipButton key={f} testId={tid.tteam.filter(f)} on={status === f} onClick={() => setStatus(f)}>{label(f)}</ChipButton>)}
        <SearchFilter testId={tid.tteam.search} label="Search employee or date" placeholder="Search employee or date" value={q} onChange={e => setQ(e.target.value)} />
      </FilterBar>
      {list.isError && <p data-testid={tid.tteam.error} role="alert" className="text-err">The queue could not be loaded. Reload the page to try again.</p>}
      {decide.refusal && <FormWarn testId={tid.tteam.refusal}>{decide.refusal.message} <span className="opacity-90">{decide.refusal.next}</span></FormWarn>}
      <Table variant="records" data-testid={tid.tteam.table}>
        <TableHeader><TableRow>
          <TableHead>Employee</TableHead><TableHead>Date</TableHead><TableHead>Rota line</TableHead>
          <TableHead>Pay elements<Tip testId={tid.tteam.elementsTip} text="Employee-declared allowances plus base hours." /></TableHead>
          <TableHead className="text-right">Hours</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {list.data && !rows.length && <Row testId={tid.tteam.empty}><TableCell colSpan={7}><Empty>Nothing matches that filter</Empty></TableCell></Row>}
          {rows.map(r => {
            const pill = statePill(r.state), open = isPending(r.state), busy = decide.isPending(r.id);
            return (
              <Row key={r.id} testId={tid.tteam.row(r.id)}>
                <TableCell kind="title">
                  <span className="flex items-center gap-[9px]"><Avatar name={r.personName} /><strong className="font-semibold">{r.personName}</strong>
                    {r.captureSource === 'proxy' && <Pill testId={tid.tteam.proxyPill(r.id)} tone="neu">Proxy</Pill>}
                    {/* a clocked day: a late first clock in (2b D5), a forgotten clock closed later (D6) */}
                    {r.clock?.late && <Pill testId={tid.clock.queueLate(r.id)} tone="warn" glyph={<AlarmClock />}>Late</Pill>}
                    {r.clock?.closedLate && <Pill testId={tid.clock.queueClosedLate(r.id)} tone="neu" glyph={<History />}>Closed later</Pill>}</span>
                </TableCell>
                <TableCell label="Date" className="tabular-nums">{formatDmy(r.date)}</TableCell>
                <TableCell label="Rota line">{rotaLine(r)}</TableCell>
                <TableCell label="Pay elements" className="text-xs"><PostingDot testId={tid.tteam.dot(r.id)} posting={r.posting} />{payElements(r)}</TableCell>
                <TableCell label="Hours" className="text-right tabular-nums">{queueHours(r.minutes)}</TableCell>
                <TableCell label="Status">
                  <span className="inline-flex items-center"><Pill testId={tid.tteam.state(r.id)} tone={pill.tone} glyph={pill.glyph}>{pill.label}</Pill>
                    <HistoryCount testId={tid.tteam.history(r.id)} row={r} /></span>
                </TableCell>
                <TableCell kind="foot" empty={!open} className="text-right whitespace-nowrap">
                  {open && <span className="inline-flex gap-sm max-md:w-full">
                    <Button testId={tid.tteam.ret(r.id)} kind="ghost" small disabled={busy} onClick={() => setReturning(r)}>Return</Button>
                    <Button testId={tid.tteam.approve(r.id)} kind="primary" small pending={busy} onClick={() => approve(r)}>Approve</Button>
                  </span>}
                </TableCell>
              </Row>);
          })}
        </TableBody>
      </Table>
      {list.data?.nextCursor && <Small testId={tid.tteam.more}>Showing the first {rows.length}. Search for a name or a date to find the rest.</Small>}
      <Small>Approval queues the timesheet as hours and pay codes. Business Central resolves what they are worth.</Small>
      {ret && <ReturnDialog key={ret.id} row={ret} required={returnReasonRequired} onClose={() => setReturning(null)} />}
    </>);
}

import { useState } from 'react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { Avatar, Button, Card, CardHead, CheckboxField, FormWarn, Row, toastInfo, toastRefusal } from '@/ui';
import { useApprovalQueue, useBulkApprove, type BulkApproved, type QueueRow } from '@/api/timesheets';
import { usePeople } from '@/api/people';
import { addDays, formatDay, isoWeek, periodStart, queueChecksum } from '@/domain/timesheet';
import { PIP, isPending, pipFor } from './team';

/* mgrTeamMatrix (qnipay-workforce-v15.html:7076-7097) and approve-matrix
   (11904-11920): everyone at the approver's location against the days of
   one week. Approve selected sends the chosen people's pending days on this
   week, with queueChecksum over exactly those rows (D7). A weekStart read
   comes whole, never paged, so those rows are every day of the week. The
   matrix is this week's, as the prototype's (WEEK_START): the card head is
   its title and Approve selected, with no week arrows. */
export function TeamMatrix({ today, self, rota, onDone }: {
  today: string; self: string; rota: boolean; onDone: (res: BulkApproved, rows: QueueRow[]) => void;
}) {
  const weekStart = periodStart(today);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const mx = useApprovalQueue({ status: 'all', weekStart });
  const roster = usePeople('here', '');
  const bulk = useBulkApprove();
  const rows = mx.data?.rows ?? [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  /* the roster at the location; without the people list, whoever appears in the queue */
  const fromRows = [...new Map(rows.map(r => [r.personCode, { code: r.personCode, name: r.personName }])).values()];
  const team = (roster.data ? roster.data.map(p => ({ code: p.code, name: p.name })) : fromRows).filter(p => p.code !== self);
  const allOn = team.length > 0 && team.every(p => chosen.has(p.code));
  const toggle = (code: string, on: boolean) => setChosen(s => { const n = new Set(s); if (on) n.add(code); else n.delete(code); return n; });

  const approve = () => {
    if (!chosen.size) { toastRefusal({ message: 'Select at least one person to approve.', next: 'Tick the people whose week you have checked.' }); return; }
    const targets = rows.filter(r => isPending(r.state) && chosen.has(r.personCode));
    if (!targets.length) {
      toastRefusal({ message: `Nothing pending for the ${chosen.size} person(s) selected on this week.`, next: 'Choose another week or other people.' });
      return;
    }
    bulk.mutate({ ids: targets.map(r => r.id), checksum: queueChecksum(targets) }, { onSuccess: res => {
      const n = res.approved.length, people = res.people;
      if (n) toastInfo(`${n} day${n > 1 ? 's' : ''} approved · ${people} employee${people > 1 ? 's' : ''} · queued for Business Central`);
      setChosen(new Set());
      onDone(res, targets);
    } });
  };
  return (
    <>
      <Card testId={tid.tteam.matrix}>
        <CardHead title={<span data-testid={tid.tteam.weekLabel}>Week {isoWeek(weekStart)} · employee × day</span>}
          actions={<Button testId={tid.tteam.approveSelected} kind="primary" small pending={bulk.isPending('timesheet-bulk')} onClick={approve}>Approve selected</Button>} />
        {bulk.refusal && <FormWarn testId={tid.tteam.refusal}>{bulk.refusal.message} <span className="opacity-90">{bulk.refusal.next}</span></FormWarn>}
        <Table variant="matrix" className="[&_td]:px-[5px] [&_td]:py-[7px] [&_td]:text-center [&_td:first-child]:min-w-[190px] [&_td:first-child]:text-left [&_th]:px-[5px] [&_th]:py-[7px] [&_th]:text-center [&_th:first-child]:min-w-[190px] [&_th:first-child]:text-left">
          <TableHeader><TableRow>
            <TableHead><CheckboxField testId={tid.tteam.mxAll} aria-label="Select everyone" checked={allOn}
              onCheckedChange={v => setChosen(v === true ? new Set(team.map(p => p.code)) : new Set())} /></TableHead>
            {days.map(d => <TableHead key={d}>{formatDay(d).slice(0, -4)}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {team.map(p => (
              <Row key={p.code} testId={tid.tteam.mxRow(p.code)}>
                <TableCell>
                  <label className="flex cursor-pointer items-center gap-[9px]">
                    <CheckboxField testId={tid.tteam.mxCheck(p.code)} className="mr-xs" aria-label={`Select ${p.name}`} checked={chosen.has(p.code)}
                      onCheckedChange={v => toggle(p.code, v === true)} />
                    <Avatar name={p.name} /><span className="font-semibold">{p.name}</span>
                  </label>
                </TableCell>
                {days.map((d, i) => {
                  const pip = pipFor(rows.find(r => r.personCode === p.code && r.date === d), mx.data?.rota?.[p.code]?.[i]);
                  return <TableCell key={d}>
                    <span data-testid={tid.tteam.pip(p.code, i)} data-state={pip.state}
                      className={cn('inline-grid h-7 w-[34px] place-items-center rounded-sm text-xs font-semibold tabular-nums', PIP[pip.state])}>{pip.value}</span>
                  </TableCell>;
                })}
              </Row>))}
          </TableBody>
        </Table>
      </Card>
      <div className="-mt-xs mb-md flex flex-wrap gap-md px-[2px] text-xs text-text-muted">
        <span className="flex items-center gap-[5px]"><i className="inline-block size-[14px] rounded-[3px] bg-ok" />Approved</span>
        <span className="flex items-center gap-[5px]"><i className="inline-block size-[14px] rounded-[3px] bg-info" />Submitted or draft</span>
        <span className="flex items-center gap-[5px]"><i className="inline-block size-[14px] rounded-[3px] bg-err-surface" />Sent back</span>
        {rota && <span className="flex items-center gap-[5px]"><i className="inline-block size-[14px] rounded-[3px] bg-surface-tint" />Scheduled, not yet worked</span>}
      </div>
    </>);
}

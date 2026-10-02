import { useState } from 'react';
import { Clock, Minus } from 'lucide-react';
import { tid } from '@/testids';
import { Banner, Button, Card, CardHead, CheckboxField, Empty, Pill, Row, Tip, toastInfo, toastRefusal } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useSubmitMultiweek } from '@/api/timesheets';
import type { MultiweekSubmitted, TimesheetWeek } from '@/contract/timesheets';
import { hm } from './capture';

/* Catch up on earlier weeks: the prototype's multi-week card in tsWeekView
   (qnipay-workforce-v15.html:6358-6365) and submit-multiweek (11429-11433).
   Several past weeks go in one request and each routes through approval on
   its own; a week in a closed period comes back held with its lock note. */
export function MultiWeek({ week, personId }: { week: TimesheetWeek; personId: string }) {
  const c = week.capture, rows = week.earlierWeeks;
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [result, setResult] = useState<MultiweekSubmitted | null>(null);
  const submit = useSubmitMultiweek();
  const all = rows.length > 0 && rows.every(r => picked.has(r.weekStart));
  const toggle = (ws: string, on: boolean) => setPicked(p => { const n = new Set(p); if (on) n.add(ws); else n.delete(ws); return n; });
  const send = () => {
    if (!picked.size) { toastRefusal({ message: 'Select at least one week.', next: 'Tick the weeks you want to send, then submit them.' }); return; }
    submit.mutate({ personId, weeks: [...picked] }, { onSuccess: res => {
      const sent = res.weeks.filter(w => w.outcome === 'submitted').length;
      if (sent) toastInfo(`${sent} week${sent === 1 ? '' : 's'} submitted · each routes through approval separately`);
      else toastInfo('Nothing was submitted', 'Each week below says why it was held back.');
      setResult(res);
      setPicked(new Set());
    } });
  };
  const held = result?.weeks.filter(w => w.outcome === 'held') ?? [];
  return (
    <Card testId={tid.ts.multiweek}>
      <CardHead title={<>Catch up on earlier weeks<Tip testId={tid.ts.mwTip} text="Submit several past weeks at once. Each week still routes through approval separately." /></>} />
      {rows.length === 0 ? <Empty>Nothing to catch up on. Every earlier week is submitted or decided.</Empty> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-[38px]"><CheckboxField testId={tid.ts.mwAll} aria-label="Select every week" checked={all}
              onCheckedChange={v => setPicked(v === true ? new Set(rows.map(r => r.weekStart)) : new Set())} /></TableHead>
            <TableHead>Week</TableHead><TableHead className="text-right">Hours</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <Row key={r.weekStart} testId={tid.ts.mwRow(r.weekStart)}>
                <TableCell><CheckboxField testId={tid.ts.mwCheck(r.weekStart)} aria-label={`Select ${r.label}`} checked={picked.has(r.weekStart)}
                  onCheckedChange={v => toggle(r.weekStart, v === true)} /></TableCell>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{hm(c, r.minutes)}</TableCell>
                <TableCell><span className="flex flex-wrap gap-xs">
                  {r.status === 'ready' ? <Pill tone="neu" glyph={<Minus />}>Ready</Pill> : <Pill tone="info" glyph={<Clock />}>Submitted</Pill>}
                  {r.locked && <Pill testId={tid.ts.mwState(r.weekStart)} tone="warn" note={r.lockNote}>Closed</Pill>}</span></TableCell>
              </Row>))}
          </TableBody>
        </Table>)}
      {held.length > 0 && <Banner testId={tid.ts.mwResult} tone="warn" title={`${held.length} week${held.length === 1 ? '' : 's'} held back`}>
        {held.map(w => <span key={w.weekStart} className="block">{w.label}: {w.reason}</span>)}</Banner>}
      {rows.length > 0 && <div className="mt-lg flex flex-wrap justify-end gap-sm">
        <Button testId={tid.ts.mwSubmit} kind="ghost" pending={submit.isPending(`${personId}/multiweek`)} onClick={send}>Submit selected</Button>
      </div>}
    </Card>);
}

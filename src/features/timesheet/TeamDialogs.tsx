import { useState, type TextareaHTMLAttributes } from 'react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { fieldControl } from '@/ui/shadcn/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { Banner, Button, CheckboxField, CheckRow, Field, FormWarn, Modal, Row, Small, Stat, Stats, toastInfo } from '@/ui';
import { useBulkApprove, useDecideDay, type ApprovalQueue, type BulkApproved, type QueueRow } from '@/api/timesheets';
import { formatDmy, returnReasonProblem } from '@/domain/timesheet';
import { queueHours } from './team';

/* bulkApproveBox (qnipay-workforce-v15.html:9756-9793) and confirm-approve-all
   (11880-11903): what approve-all would do, shown before anything is written.
   The set is the server's (ApprovalQueue.bulk), read again on every render,
   so after QUEUE_CHANGED the dialog shows what is there now and the next
   attempt sends that checksum. */
export function BulkApproveDialog({ queue, where, onClose, onDone }: {
  queue: ApprovalQueue; where: string; onClose: () => void; onDone: (res: BulkApproved) => void;
}) {
  const s = queue.bulk, n = s.ids.length, flagged = s.flagged;
  /* the tick confirms this set: it clears itself when the set read again after QUEUE_CHANGED differs */
  const [ackFor, setAckFor] = useState<string | null>(null);
  const ack = ackFor === s.checksum;
  const [warn, setWarn] = useState(false);
  const bulk = useBulkApprove();
  const records = `record${n === 1 ? '' : 's'}`;
  const confirm = () => {
    if (!n) { onClose(); toastInfo('Nothing to approve'); return; }
    if (!ack) { setWarn(true); return; }
    bulk.mutate({ ids: s.ids, checksum: s.checksum }, { onSuccess: res => {
      const k = res.approved.length;
      if (k) toastInfo(`${k} approved · ${queueHours(res.minutes)} · ${res.people} colleague(s) · queued for Business Central`
        + (flagged.length ? ` · ${flagged.length} had exceptions` : ''));
      onDone(res);
    } });
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Approve ${n} timesheet${n === 1 ? '' : 's'}?`} width={flagged.length ? 'wide' : undefined}
      footer={<>
        <Button testId={tid.tteam.bulkCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.tteam.bulkConfirm} kind="primary" pending={bulk.isPending('timesheet-bulk')} onClick={confirm}>Approve {n} and queue</Button>
      </>}>
      <Banner tone="warn" title="This cannot be undone from here">
        Each approval queues a posting to Business Central. Reversing one afterwards needs an amendment, not a second approval.</Banner>
      <Stats>
        <Stat label="Records" testId={tid.tteam.bulkStat('records')} foot={`${where} only`}>{n}</Stat>
        <Stat label="Colleagues" testId={tid.tteam.bulkStat('people')}>{s.people}</Stat>
        <Stat label="Hours" testId={tid.tteam.bulkStat('hours')} foot="to be queued for payroll">{queueHours(s.minutes)}</Stat>
        <Stat label="With exceptions" testId={tid.tteam.bulkStat('flagged')} tone={flagged.length ? 'bad' : undefined}
          foot={flagged.length ? 'review before approving' : 'none flagged'}>{flagged.length}</Stat>
      </Stats>
      {flagged.length > 0 && <>
        <Table>
          <TableHeader><TableRow><TableHead>Colleague</TableHead><TableHead>Date</TableHead><TableHead>Why it is flagged</TableHead></TableRow></TableHeader>
          <TableBody>{flagged.slice(0, 8).map(f => (
            <Row key={f.id} testId={tid.tteam.bulkFlagRow(f.id)}>
              <TableCell>{f.personName}</TableCell>
              <TableCell className="text-xs tabular-nums">{formatDmy(f.date)}</TableCell>
              <TableCell className="text-xs">{f.why.join('; ')}</TableCell>
            </Row>))}</TableBody>
        </Table>
        {flagged.length > 8 && <Small>and {flagged.length - 8} more.</Small>}
      </>}
      {s.outside > 0 && <Small testId={tid.tteam.bulkOutside}>{s.outside} further record(s) are pending at other locations. They are outside your scope and will not be approved.</Small>}
      <CheckRow className="mt-[14px] items-start" control={<CheckboxField testId={tid.tteam.bulkAck} checked={ack}
        onCheckedChange={v => { setAckFor(v === true ? s.checksum : null); if (v === true) setWarn(false); }} />}>
        <span className="text-xs">I have reviewed {n} {records} totalling {queueHours(s.minutes)}
          {flagged.length ? `, including ${flagged.length} flagged for review` : ''}, and I am approving them for payroll.</span>
      </CheckRow>
      {warn && <FormWarn testId={tid.tteam.bulkWarn}>Tick the confirmation to continue.</FormWarn>}
      {bulk.refusal && <FormWarn testId={tid.tteam.refusal}>{bulk.refusal.message} <span className="opacity-90">{bulk.refusal.next}</span></FormWarn>}
    </Modal>);
}

function TextArea({ testId, className, ...rest }: { testId: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-testid={testId} rows={3} {...rest} className={cn(fieldControl, 'h-auto resize-y py-[9px] leading-[1.5]', className)} />;
}

/* returnBox (v15:10264-10272) and confirm-return (11904-11914). The row is
   the one the queue last read, so after a 412 the next attempt sends the
   version just read (as 1b's dialogs do, 050caca). */
export function ReturnDialog({ row, required, onClose }: { row: QueueRow; required: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const decide = useDecideDay();
  const send = () => {
    const why = reason.trim();
    if (returnReasonProblem(why, required)) { setMissing(true); return; }
    decide.mutate({ day: row, to: 'back', reason: why }, { onSuccess: () => {
      toastInfo(`Sent back with a reason · ${row.personName}`);
      onClose();
    } });
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Send back for correction"
      footer={<>
        <Button testId={tid.tteam.returnCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.tteam.returnConfirm} kind="danger" pending={decide.isPending(row.id)} onClick={send}>Send back</Button>
      </>}>
      <Small className="mb-md">{row.personName} · {formatDmy(row.date)} · {queueHours(row.minutes)}</Small>
      <Field label="Reason" required={required} error={(missing ? returnReasonProblem('', true)?.message : undefined) ?? decide.fieldError('reason')}>
        <TextArea testId={tid.tteam.returnReason} value={reason} placeholder="Sent to the employee with the returned timesheet and stored on the entry"
          onChange={e => { setReason(e.target.value); setMissing(false); }} />
      </Field>
      {decide.refusal && <FormWarn testId={tid.tteam.returnWarn}>{decide.refusal.message} <span className="opacity-90">{decide.refusal.next}</span></FormWarn>}
    </Modal>);
}

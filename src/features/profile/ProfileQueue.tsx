import { useState } from 'react';
import { Clock } from 'lucide-react';
import { tid } from '@/testids';
import type { ProfileChange } from '@/contract/profile';
import { Avatar, Button, Card, CardHead, Field, FormWarn, Modal, Pill, Small, TextInput, toastInfo } from '@/ui';
import { useDecide, useProfileQueue } from '@/api/profile';
import { selfField } from '@/domain/selfService';
import { formatDate } from '@/lib/format';
import { latest } from '@/lib/latest';

const TITLE = { manager: 'Profile changes awaiting you', payroll: 'Bank detail changes awaiting payroll' } as const;

/* Ported from the prototype's profileQueue (qnipay-workforce-v15.html:7595-
   7612): each change with who raised it, the old value struck through and
   the new one, Decline and Approve. A bank change goes on to payroll after
   its manager approves (plan 1b decision D3), which shows here as the
   payroll stage on Qnipay setup · People. Declining needs a reason (D4). */
export function ProfileQueue({ stage }: { stage: 'manager' | 'payroll' }) {
  const queue = useProfileQueue(true);
  const [held, setDeclining] = useState<ProfileChange | null>(null);
  /* the decline sends the change as last read, so a retry after a 412 carries the fresh version */
  const declining = held && latest(held, queue.data);
  const [reason, setReason] = useState('');
  const decide = useDecide();
  const done = (c: ProfileChange) => {
    const label = selfField(c.field).label;
    if (c.status === 'approved') toastInfo(`Approved · ${label} updated on the workforce record`);
    else if (c.status === 'declined') toastInfo(`Declined · ${label} left unchanged`);
    else toastInfo(`Approved · ${label} passed to payroll to verify`, 'It takes effect once payroll approves.');
  };
  const rows = (queue.data ?? []).filter(c => c.stage === stage);
  if (!rows.length) return null;
  return (
    <Card testId={tid.queue.root(stage)}>
      <CardHead title={TITLE[stage]} actions={<Pill testId={tid.queue.count(stage)} tone="warn" glyph={<Clock />}>{rows.length}</Pill>} />
      <ul>{rows.map(c => (
        <li key={c.id} data-testid={tid.queue.row(c.id)} className="flex flex-wrap items-center gap-md border-b py-sm last:border-b-0">
          <div className="flex min-w-0 flex-1 items-center gap-[9px]">
            <Avatar name={c.personName} />
            <div className="min-w-0">
              <strong className="text-sm font-semibold">{c.personName}</strong>
              <Small>{selfField(c.field).label} · raised {formatDate(c.raisedAt.slice(0, 10))}{c.note ? ` · ${c.note}` : ''}</Small>
              <Small><span className="line-through">{c.from || '—'}</span> → <strong className="text-text-primary">{c.to}</strong></Small>
            </div>
          </div>
          <span className="ml-auto inline-flex flex-wrap items-center gap-xs">
            {stage === 'manager' && c.route.includes('payroll') && <Pill testId={tid.queue.payroll(c.id)} tone="warn">Payroll verifies</Pill>}
            <Button testId={tid.queue.decline(c.id)} kind="ghost" small onClick={() => { setDeclining(c); setReason(''); decide.clearFieldErrors(); }}>Decline</Button>
            <Button testId={tid.queue.approve(c.id)} kind="primary" small pending={decide.isPending(c.id)}
              onClick={() => decide.mutate({ change: c, decision: 'approve', reason: '' }, { onSuccess: d => done(d.record) })}>Approve</Button></span>
        </li>))}</ul>
      <Small className="mt-[10px]">Approving writes the new value to the one workforce record every module reads, and keeps the old value in its history.</Small>
      {declining && <Modal open onOpenChange={o => { if (!o) setDeclining(null); }} title={`Decline the ${selfField(declining.field).label.toLowerCase()} change`}
        description={`${declining.personName} is told why.`}
        footer={<>
          <Button testId={tid.queue.cancelDecline} kind="ghost" onClick={() => setDeclining(null)}>Keep it as it is</Button>
          <Button testId={tid.queue.confirmDecline} kind="danger" pending={decide.isPending(declining.id)}
            onClick={() => decide.mutate({ change: declining, decision: 'decline', reason }, { onSuccess: d => { done(d.record); setDeclining(null); } })}>Decline</Button></>}>
        <Field label="Reason" required error={decide.fieldError('reason')}>
          <TextInput testId={tid.queue.reason} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        {decide.refusal && <FormWarn testId={tid.queue.warn}>{decide.refusal.message}</FormWarn>}
      </Modal>}
    </Card>);
}

import { useState } from 'react';
import { tid } from '@/testids';
import { Button, CheckboxField, CheckRow, Field, FormWarn, Modal, SelectBox, Small, TextArea, toastInfo } from '@/ui';
import { useDeclineLeave, useEntitlement, useGiveDaysBack, type SicknessBoard, type TeamRequestView } from '@/api/leave';
import { formatDay } from '@/domain/time';
import { EntitlementDialog, SimulateDialog } from './LeaveDialogs';

/* The dialogs Team leave and Sickness open. */

/* "Decline with a reason" (mgrLeave, v15:7873). The prototype declined at
   once and only said a reason had been sent; here the reason is asked for and
   is what the colleague sees (D4). The server owns the rule: an empty reason
   comes back as REASON_REQUIRED on the field. The request is the one the
   queue last read, so after a 412 the next attempt sends the fresh version. */
export function DeclineDialog({ r, onClose }: { r: TeamRequestView; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const decline = useDeclineLeave();
  const general = decline.refusal && decline.refusal.field !== 'reason' ? decline.refusal : null;
  const send = () => decline.mutate({ request: r, reason: reason.trim() }, { onSuccess: x => { toastInfo(x.summary); onClose(); } });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Decline with a reason"
      footer={<>
        <Button testId={tid.tleave.declineCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.tleave.declineConfirm} kind="danger" pending={decline.isPending(`leave/request/${r.id}`)} onClick={send}>Decline</Button>
      </>}>
      <Small className="mb-md">{r.name} · {r.typeName} · {r.range} · {r.qtyText}</Small>
      <Field label="Reason" required error={decline.fieldError('reason')}>
        <TextArea testId={tid.tleave.reason} value={reason} maxLength={300} placeholder="Sent to the colleague with the decision"
          onChange={e => { setReason(e.target.value); decline.clearFieldErrors(); }} />
      </Field>
      {general && <FormWarn testId={tid.tleave.declineWarn}>{general.message} <span className="opacity-90">{general.next}</span></FormWarn>}
    </Modal>);
}

/* A colleague's "How it was worked out" (entitlementModal, v15:7793): the
   same dialog My leave opens, read for that person. With LV_PRORATA it
   offers the hours simulation, which writes nothing (D3). */
export function PersonEntitlement({ code, canSimulate, onClose }: { code: string; canSimulate: boolean; onClose: () => void }) {
  const q = useEntitlement(code);
  const [simulating, setSimulating] = useState(false);
  if (!q.data) return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="How the entitlement was worked out"
      footer={<Button testId={tid.leave.entClose} kind="ghost" onClick={onClose}>Close</Button>}>
      <p data-testid={tid.tleave.entLoading} role={q.isError ? 'alert' : undefined} className={q.isError ? 'text-err' : 'text-text-secondary'}>
        {q.isError ? 'The entitlement could not be loaded. Close this and try again.' : 'Loading the entitlement…'}</p>
    </Modal>);
  return simulating
    ? <SimulateDialog m={q.data} onClose={onClose} />
    : <EntitlementDialog m={q.data} onClose={onClose} onSimulate={canSimulate ? () => setSimulating(true) : undefined} />;
}

/* "Give days back" (give-days-back, v15:12481). The prototype returned two
   days for one hard-coded colleague; here the manager picks the colleague
   and which of their approved leave days the sickness covered, and the server
   writes one ledger adjustment for exactly those days (D10). */
type OnLeaveDay = SicknessBoard['sickOnLeave'][number];
export function GiveBackDialog({ days, onClose }: { days: readonly OnLeaveDay[]; onClose: () => void }) {
  const people = [...new Map(days.map(d => [d.personCode, d.name])).entries()].map(([code, name]) => ({ value: code, label: name }));
  const [who, setWho] = useState(people[0]?.value ?? '');
  const theirs = days.filter(d => d.personCode === who);
  const [picked, setPicked] = useState<readonly string[]>(() => theirs.map(d => d.date));
  const give = useGiveDaysBack();
  const total = theirs.filter(d => picked.includes(d.date)).reduce((n, d) => n + d.days, 0);
  const problem = give.refusal ? `${give.refusal.message} ${give.refusal.next}` : undefined;
  const pick = (code: string) => { setWho(code); setPicked(days.filter(d => d.personCode === code).map(d => d.date)); give.clearFieldErrors(); };
  const toggle = (date: string, on: boolean) => { setPicked(p => on ? [...p, date] : p.filter(x => x !== date)); give.clearFieldErrors(); };
  const send = () => give.mutate({ personCode: who, dates: [...picked] }, { onSuccess: x => { toastInfo(x.summary); onClose(); } });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Give days back"
      description="Where sickness falls across annual leave, those days go back to the colleague’s balance. Pick the days the sickness covered."
      footer={<>
        <Button testId={tid.tsick.gbCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.tsick.gbConfirm} kind="primary" pending={give.isPending(`leave/give-back/${who}`)} onClick={send}>
          Give {total} day{total === 1 ? '' : 's'} back</Button>
      </>}>
      <Field label="Colleague">
        <SelectBox testId={tid.tsick.gbPerson} value={who} options={people} onValueChange={pick} />
      </Field>
      {theirs.map(d => (
        <CheckRow key={d.date} control={<CheckboxField testId={tid.tsick.gbDay(d.date)} checked={picked.includes(d.date)}
          onCheckedChange={v => toggle(d.date, v === true)} />}>
          {formatDay(d.date)} · {d.days === 1 ? '1 day' : `${d.days} days`} of annual leave
        </CheckRow>))}
      {problem && <FormWarn testId={tid.tsick.gbWarn}>{problem}</FormWarn>}
    </Modal>);
}

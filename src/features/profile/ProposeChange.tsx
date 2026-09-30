import { useState } from 'react';
import { tid } from '@/testids';
import type { Profile } from '@/contract/profile';
import { Banner, Button, Field, FormWarn, Modal, Pill, TextInput, toastInfo } from '@/ui';
import { useProposeChanges } from '@/api/profile';

/* Ported from the prototype's profileEditBox (qnipay-workforce-v15.html:
   5652-5672). Nothing is written to the record here: a request is raised and
   routed for approval, and a field already awaiting a decision is locked. */
export function ProposeChange({ profile, onClose }: { profile: Profile; onClose(): void }) {
  const p = profile.person;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(profile.fields.map(f => [f.key, p[f.key]])));
  const [note, setNote] = useState('');
  const send = useProposeChanges();
  const pendingFor = (key: string) => profile.pending.find(c => c.field === key);
  const submit = () => send.mutate({ changes: profile.fields.filter(f => !pendingFor(f.key)).map(f => ({ field: f.key, to: values[f.key] ?? '' })), note }, {
    onSuccess: d => {
      const labels = d.records.map(r => profile.fields.find(f => f.key === r.field)?.label ?? r.field).join(', ');
      toastInfo(`Sent for approval · ${labels}`, `With ${p.manager || 'your manager'}. Nothing changes until it is approved.`);
      onClose();
    },
  });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Propose a change to your details"
      footer={<>
        <Button testId={tid.profile.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.profile.send} kind="primary" pending={send.anyPending} onClick={submit}>Send for approval</Button></>}>
      {profile.fields.map(f => {
        const c = pendingFor(f.key);
        return (
          <div key={f.key} className="relative">
            {f.sensitive && <Pill testId={tid.profile.payroll(f.key)} tone="warn" className="absolute top-0 right-0">Payroll checks this</Pill>}
            <Field label={f.label} hint={c ? `A change to ${c.to} is already awaiting approval.` : f.hint || undefined}>
              <TextInput testId={tid.profile.field(f.key)} type={f.inputType} disabled={!!c} value={values[f.key] ?? ''}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} /></Field>
          </div>);
      })}
      <Field label="Note for your approver">
        <TextInput testId={tid.profile.note} value={note} placeholder="Optional. Why it is changing" onChange={e => setNote(e.target.value)} /></Field>
      <Banner tone="info" title="Who sees this">
        Your line manager approves every change. Bank details are also verified by payroll before they take effect. Workforce never uses them; they are held for payroll.
      </Banner>
      {send.refusal && <FormWarn testId={tid.profile.warn}>{send.refusal.message}</FormWarn>}
    </Modal>);
}

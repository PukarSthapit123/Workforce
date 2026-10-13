import { useState } from 'react';
import { tid } from '@/testids';
import { Banner, Button, Field, FormWarn, Modal, NativeSelect, Small, SwitchField, TextInput, UnitInput, toastInfo } from '@/ui';
import { useCreatePayCode, useRemovePayCode, useUpdatePayCode, type PayCodeRow } from '@/api/pay-codes';
import { PAY_CODE_BASES, isValued, usagePhrase, type PayCodeBasis } from '@/domain/pay-codes';
import { PAY_BASIS } from '@/domain/timesheet';

const MONEY = 'Workforce posts hours against a code. Business Central owns what the code is worth. Nothing here sets a monetary value.';
const TIP = {
  code: 'What Business Central matches on. It cannot change once the code exists, because postings already reference it.',
  basis: 'The basis is what lets one value column hold 1.5×, 1 day and a marker without ambiguity.',
  element: 'The element in Business Central this code maps to. One code, one element.',
  wt: 'A work type answers "at what rate was this hour worked" and can be derived automatically from a rule. An allowance-style code is claimed, not derived.',
};
const NO_VALUE: Record<string, string> = {
  flat: 'The amount is set in Business Central.',
  units: 'Left blank for a units basis, which posts as a marker.',
};

/* Ported from the prototype's payCodeBox and its pc-save and pc-del handlers
   (qnipay-workforce-v15.html:9554-9595, 12858-12913). The server runs every
   check and the dialog shows its refusal, on the field it names and under
   the fields. The code is locked once it exists and says why. The work type
   toggle (#pc-wt), whose handler the prototype lacks, is a real switch. A
   value is asked for only where the basis posts one; a flat code shows that
   the amount is set in Business Central (P1). Remove is offered on a code
   that exists; the server refuses it while anything uses the code, naming
   what does. */
export function PayCodeForm({ row, onClose }: { row?: PayCodeRow; onClose(): void }) {
  const [v, setV] = useState({
    code: row?.code ?? '', label: row?.label ?? '', basis: (row?.basis ?? 'multiplier') as PayCodeBasis,
    value: row?.value ?? '', element: row?.element ?? '', workType: row?.workType ?? false,
  });
  const create = useCreatePayCode(), update = useUpdatePayCode(), remove = useRemovePayCode();
  /* the refusal to show is the one from the write that was sent last */
  const [last, setLast] = useState<'create' | 'update' | 'remove'>(row ? 'update' : 'create');
  const current = { create, update, remove }[last];
  const busy = create.anyPending || update.anyPending || remove.anyPending;
  const valued = isValued(v.basis);
  const body = { label: v.label, basis: v.basis, value: valued ? v.value.trim() : '', element: v.element, workType: v.workType };

  function save() {
    if (row) {
      setLast('update');
      update.mutate({ row, body }, { onSuccess: d => {
        toastInfo(d.changed.length ? `${row.code} updated · ${d.changed.length} field(s) changed` : `${row.code} · nothing changed`); onClose(); } });
    } else {
      setLast('create');
      create.mutate({ ...body, code: v.code }, { onSuccess: d => {
        const where = d.record.workType ? 'available now as a rate type on timesheets and in Timesheet setup’s pay rules'
          : 'claimable now by an employee type in Timesheet setup';
        toastInfo(`${d.record.code} created · ${d.record.label} · ${where}`); onClose(); } });
    }
  }
  function drop() {
    if (!row) return;
    setLast('remove');
    remove.mutate(row, { onSuccess: () => { toastInfo(`${row.label || row.code} removed`); onClose(); } });
  }
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV(s => ({ ...s, [k]: x }));
  const refusal = current.refusal, fe = current.fieldError;
  const used = row?.usedBy.length ? usagePhrase(row.usedBy) : '';
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={row ? row.code : 'New pay code'} scope={row ? (used ? `In use by ${used}` : 'Not in use') : undefined} width="wide"
      footer={<>
        <Button testId={tid.mpay.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        {row && <Button testId={tid.mpay.remove} kind="ghost" pending={busy} onClick={drop}>Remove</Button>}
        <Button testId={tid.mpay.save} kind="primary" pending={busy} onClick={save}>{row ? 'Save changes' : 'Create code'}</Button></>}>
      <Small testId={tid.mpay.money} className="mb-md">{MONEY}</Small>
      <div className="grid grid-cols-2 gap-md max-md:grid-cols-1">
        <Field label="Code" required tip={TIP.code} error={fe('code')} hint={row ? 'Codes cannot change. Postings already reference them.' : undefined}>
          <TextInput testId={tid.mpay.code} className="tabular-nums uppercase" maxLength={12} placeholder="e.g. OT-BH" disabled={!!row}
            value={v.code} onChange={e => set('code', e.target.value)} /></Field>
        <Field label="Name" required error={fe('label')}>
          <TextInput testId={tid.mpay.label} placeholder="e.g. Overtime, bank holiday" value={v.label} onChange={e => set('label', e.target.value)} /></Field>
        <Field label="Posts as" tip={TIP.basis} error={fe('basis')}>
          <NativeSelect testId={tid.mpay.basis} value={v.basis} onChange={e => set('basis', e.target.value as PayCodeBasis)}>
            {PAY_CODE_BASES.map(b => <option key={b} value={b}>{PAY_BASIS[b].label}</option>)}</NativeSelect></Field>
        <Field label="Value" error={fe('value')} hint={valued ? 'A multiplier such as 1.5, or a count such as 1.' : NO_VALUE[v.basis]}>
          <UnitInput testId={tid.mpay.valueInput} unit={PAY_BASIS[v.basis].unit || '—'} type="number" inputMode="decimal" step="0.01" min="0"
            placeholder={valued ? '1.5' : ''} disabled={!valued} value={valued ? v.value : ''} onChange={e => set('value', e.target.value)} /></Field>
        <Field label="Business Central pay element" required tip={TIP.element} error={fe('element')}>
          <TextInput testId={tid.mpay.element} className="tabular-nums uppercase" maxLength={20} placeholder="PE-OTBH"
            value={v.element} onChange={e => set('element', e.target.value)} /></Field>
        <Field label="Is it a work type?" tip={TIP.wt} error={fe('workType')}>
          <SwitchField testId={tid.mpay.wt} checked={v.workType} onCheckedChange={c => set('workType', c)} /></Field>
      </div>
      {row && used && (
        <Banner testId={tid.mpay.inUse} tone="info" title={`In use by ${used}`}>
          Changing the value or element affects everything that posts through this code from now on. Records already posted keep the value they were posted with.
        </Banner>)}
      {refusal && <FormWarn testId={tid.mpay.warn}>{refusal.usedBy ? `${refusal.message} ${refusal.next}` : refusal.message}</FormWarn>}
    </Modal>);
}

import { useState } from 'react';
import { tid } from '@/testids';
import type { EmployeeType } from '@/contract/employee-types';
import { Button, Field, FormWarn, Modal, NativeSelect, SelectBox, TextInput, toastInfo } from '@/ui';
import { useEmployeeTypes } from '@/api/reference';
import { useCreateType, useTypeLibrary } from '@/api/employee-types';

type Mode = EmployeeType['mode']; type Uom = EmployeeType['uom']; type Cat = EmployeeType['category']; type Cap = EmployeeType['capabilities'][number];
/* A lower-case slug (plan 1b decision D13), leading words first: "24/7 Cover" becomes cover_24_7. */
export const slugOf = (name: string) => {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const lead = words.findIndex(w => /^[a-z]/.test(w));
  return (lead < 0 ? words : [...words.slice(lead), ...words.slice(0, lead)]).join('_').slice(0, 32);
};
export const MODES: { value: Mode; label: string }[] = [{ value: 'form', label: 'Day form' }, { value: 'grid', label: 'Weekly grid' }, { value: 'clock', label: 'Clock in and out' }];
export const UOMS: { value: Uom; label: string }[] = [{ value: 'hour', label: 'Per hour' }, { value: 'day', label: 'Per day' }];
export const CATEGORIES: { value: Cat; label: string }[] = (['Contracted', 'Bank', 'Agency', 'Salaried'] as const).map(c => ({ value: c, label: c }));
export const pick = <T extends string>(list: { value: T }[], v: string): T | undefined => list.find(x => x.value === v)?.value;

/* Ported from the prototype's newTypeBox (qnipay-workforce-v15.html:10272-
   10300): start blank, from a live type, or from an archetype we ship. The
   new type is a copy; nothing is shared back to what it was copied from. */
export function NewTypeModal({ onClose, onCreated }: { onClose(): void; onCreated(t: EmployeeType): void }) {
  const live = useEmployeeTypes(), lib = useTypeLibrary();
  const [name, setName] = useState(''); const [code, setCode] = useState<string | null>(null);
  const [base, setBase] = useState('blank');
  const [mode, setMode] = useState<Mode>('form'); const [uom, setUom] = useState<Uom>('hour'); const [category, setCategory] = useState<Cat>('Contracted');
  const [caps, setCaps] = useState<Cap[]>([]);
  const create = useCreateType();
  function pickBase(v: string) {
    setBase(v);
    const [kind, key] = v.split(':');
    const src = kind === 'live' ? live.data?.find(t => t.code === key) : kind === 'lib' ? lib.data?.archetypes.find(a => a.key === key) : undefined;
    if (src) { setMode(src.mode); setUom(src.uom); setCaps([...src.capabilities]); if ('category' in src) setCategory(src.category); }
  }
  const submit = () => create.mutate({ code: code ?? slugOf(name), name, category, mode, uom, capabilities: caps, startedFrom: base }, {
    onSuccess: d => { toastInfo(`${d.record.name} created · ${base === 'blank' ? 'started blank' : 'copied from what you picked'}`, 'Adjust its capabilities on the page.'); onCreated(d.record); onClose(); },
  });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="New employee type"
      description="The new type starts as a copy of what you pick. Nothing is shared back to the type you copied."
      footer={<>
        <Button testId={tid.types.newCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.types.newSave} kind="primary" pending={create.anyPending} onClick={submit}>Create</Button></>}>
      <Field label="Type name" required error={create.fieldError('name')}>
        <TextInput testId={tid.types.newField('name')} value={name} placeholder="For example, Waking Night Support" onChange={e => setName(e.target.value)} /></Field>
      <Field label="Type code" error={create.fieldError('code')} tip="People reference a type by this code. It cannot change once the type exists.">
        <TextInput testId={tid.types.newField('code')} value={code ?? slugOf(name)} onChange={e => setCode(e.target.value)} /></Field>
      <Field label="Start from">
        <NativeSelect testId={tid.types.newField('base')} value={base} onChange={e => pickBase(e.target.value)}>
          <option value="blank">Blank, with times and notes only</option>
          <optgroup label="Types in this tenant">{(live.data ?? []).map(t => <option key={t.code} value={`live:${t.code}`}>{t.name}</option>)}</optgroup>
          <optgroup label="Archetypes we ship">{(lib.data?.archetypes ?? []).map(a => <option key={a.key} value={`lib:${a.key}`}>{a.name}</option>)}</optgroup>
        </NativeSelect></Field>
      <div className="grid grid-cols-3 gap-md max-md:grid-cols-1">
        <Field label="Entry mode"><SelectBox testId={tid.types.newField('mode')} options={MODES} value={mode} onValueChange={v => setMode(pick(MODES, v) ?? mode)} /></Field>
        <Field label="Pay basis"><SelectBox testId={tid.types.newField('uom')} options={UOMS} value={uom} onValueChange={v => setUom(pick(UOMS, v) ?? uom)} /></Field>
        <Field label="Usual basis"><SelectBox testId={tid.types.newField('category')} options={CATEGORIES} value={category} onValueChange={v => setCategory(pick(CATEGORIES, v) ?? category)} /></Field>
      </div>
      {create.refusal && <FormWarn testId={tid.types.newWarn}>{create.refusal.message}</FormWarn>}
    </Modal>);
}

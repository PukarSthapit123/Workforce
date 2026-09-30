import { useState } from 'react';
import { tid } from '@/testids';
import { DIMENSIONS, type DimensionKind } from '@/contract/dimensions';
import { Button, Field, FormWarn, Modal, ScopeBadge, SelectBox, Small, SwitchField, TextInput, UnitInput, toastInfo } from '@/ui';
import { useDimension, type InUseRow } from '@/api/reference';
import { useCreateDimension, useRemoveDimension, useUpdateDimension } from '@/api/dimensions';
import { DIM_SPECS, type DimField } from './spec';

const NONE = 'none';
type Value = string | boolean;
/* what a new entry starts with; a location is active from the day it is made */
const blank = (f: DimField): Value => (f.kind === 'bool' ? false : f.kind === 'number' ? '1' : f.key === 'status' ? 'Active' : f.key === 'level' ? 'Low' : '');
const EXTRA: Partial<Record<DimensionKind, Record<string, unknown>>> = { locations: { active: true } };
const toBody = (fields: DimField[], v: Record<string, Value>) => Object.fromEntries(fields.map(f =>
  [f.key, f.kind === 'number' ? Number(v[f.key] || 0) : f.kind === 'bool' ? Boolean(v[f.key]) : String(v[f.key] ?? '')]));

/* Ported from the prototype's dimBox (qnipay-workforce-v15.html:9182-9211):
   one form, built from the dimension's spec, for all five. The code is
   locked once the entry exists, and says why. Remove is offered on an entry
   that exists; the server refuses it while anything uses the entry, naming
   what does. */
export function DimensionForm({ kind, row, onClose }: { kind: DimensionKind; row?: InUseRow; onClose(): void }) {
  const spec = DIM_SPECS[kind], singular = DIMENSIONS[kind].singular;
  const ctx = { departments: useDimension('departments').data ?? [], costCentres: useDimension('cost-centres').data ?? [], locations: useDimension('locations').data ?? [] };
  const [v, setV] = useState<Record<string, Value>>(() => Object.fromEntries(spec.fields.map(f => {
    const cur = row?.[f.key];
    return [f.key, row ? (typeof cur === 'boolean' ? cur : String(cur ?? '')) : blank(f)];
  })));
  const create = useCreateDimension(kind), update = useUpdateDimension(kind), remove = useRemoveDimension(kind);
  /* the refusal to show is the one from the write that was sent last */
  const [last, setLast] = useState<'create' | 'update' | 'remove'>(row ? 'update' : 'create');
  const writes = { create, update, remove }, current = writes[last];
  const busy = create.anyPending || update.anyPending || remove.anyPending;

  function save() {
    const body = toBody(spec.fields, v);
    if (row) {
      const rest = { ...body };
      delete rest.code;
      setLast('update');
      update.mutate({ row, body: rest }, { onSuccess: d => {
        toastInfo(d.changed?.length ? `${d.record.name} updated · ${d.changed.length} field(s) changed` : `${d.record.name} · nothing changed`); onClose(); } });
    } else {
      setLast('create');
      create.mutate({ ...body, ...EXTRA[kind] }, { onSuccess: d => { toastInfo(`${d.record.name} created · available everywhere this ${singular} is offered`); onClose(); } });
    }
  }
  function drop() {
    if (!row) return;
    setLast('remove');
    remove.mutate(row, { onSuccess: () => { toastInfo(`${row.name} removed`); onClose(); } });
  }
  const control = (f: DimField) => {
    const id = tid.dims.field(f.key);
    if (f.kind === 'bool') return <SwitchField testId={id} checked={Boolean(v[f.key])} onCheckedChange={c => setV(x => ({ ...x, [f.key]: c }))} />;
    if (f.kind === 'select') {
      const options = [...(f.optional ? [{ value: NONE, label: 'None' }] : []), ...(f.options?.(ctx) ?? [])];
      return <SelectBox testId={id} options={options} value={String(v[f.key] || NONE)} onValueChange={x => setV(y => ({ ...y, [f.key]: x === NONE ? '' : x }))} />;
    }
    if (f.kind === 'number') return <UnitInput testId={id} unit="people" type="number" inputMode="numeric" step="1" min="0"
      value={String(v[f.key] ?? '')} onChange={e => setV(x => ({ ...x, [f.key]: e.target.value }))} />;
    return <TextInput testId={id} type={f.kind === 'date' ? 'date' : 'text'} disabled={!!row && f.code}
      className={f.code ? 'tabular-nums uppercase' : undefined}
      value={String(v[f.key] ?? '')} onChange={e => setV(x => ({ ...x, [f.key]: e.target.value }))} />;
  };
  const refusal = current.refusal;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={row ? row.name : `New ${singular}`} width="wide"
      footer={<>
        <Button testId={tid.dims.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        {row && <Button testId={tid.dims.remove} kind="ghost" pending={busy} onClick={drop}>Remove</Button>}
        <Button testId={tid.dims.save} kind="primary" pending={busy} onClick={save}>{row ? 'Save changes' : 'Create'}</Button></>}>
      <div className="mb-md flex items-center gap-sm">
        <Small>{spec.desc}</Small>
        {row && <ScopeBadge>{row.code}</ScopeBadge>}
      </div>
      <div className="grid grid-cols-2 gap-md max-md:grid-cols-1">
        {spec.fields.map(f => (
          <div key={f.key} className={f.wide ? 'col-span-full' : undefined}>
            <Field label={f.label} required={f.required} tip={f.hint} error={current.fieldError(f.key)}
              hint={row && f.code ? 'Codes cannot change. Existing records reference them.' : undefined}>{control(f)}</Field>
          </div>))}
      </div>
      {refusal && <FormWarn testId={tid.dims.warn}>{refusal.usedBy ? `${refusal.message} ${refusal.next}` : refusal.message}</FormWarn>}
    </Modal>);
}

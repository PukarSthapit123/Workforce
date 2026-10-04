import { useState } from 'react';
import { Lock } from 'lucide-react';
import { tid } from '@/testids';
import { AddLine, Button, CheckboxField, CheckRow, Field, FieldGrid, FormWarn, Modal, NativeSelect, Pill, Row, SettingSelect, TextInput, Tip, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useCreateDelegation, useSaveChain, type ApprovalChain, type ChainLayer, type ChainModule, type Delegations } from '@/api/approvals';
import { CHAIN_MODULES, FIXED_TIP, SLA_UNITS, STEP_SCOPES, parseSla, roleOptions, slaText, whenOptions, withLayer, type SlaUnit } from '@/domain/approvals';
import { cn } from '@/lib/utils';

/* One module's chain, edited whole (D8): the prototype's chain table with its
   inline selects, Remove on each layer and Add approval layer, held here
   until Save sends the whole chain with the version it was read at. The
   posting step shows locked and goes back exactly as it came. A refusal on a
   layer's field marks that field; one about the chain as a whole shows under
   the table. */
interface Draft { role: string; scope: string; when: string; n: string; unit: SlaUnit; fixed: boolean; sla: string }
const toDraft = (s: ChainLayer): Draft => {
  const p = parseSla(s.sla);
  return { role: s.role, scope: s.scope, when: s.when, n: p ? String(p.n) : '', unit: p?.unit ?? 'hours', fixed: s.fixed, sla: s.sla };
};
const toLayer = (d: Draft): ChainLayer => {
  if (d.fixed) return { role: d.role, scope: d.scope, when: d.when, sla: d.sla, fixed: true };
  const n = Number(d.n);
  return { role: d.role, scope: d.scope, when: d.when, sla: /^\d{1,3}$/.test(d.n) ? slaText(n, d.unit) : `${d.n.trim()} ${d.unit}`.trim(), fixed: false };
};
const CELL_SELECT = 'w-full min-w-[150px]';

export function ChainDialog({ chain, onClose }: { chain: ApprovalChain; onClose: () => void }) {
  const save = useSaveChain();
  const m: ChainModule = chain.module;
  const [rows, setRows] = useState<Draft[]>(() => chain.steps.map(toDraft));
  const set = (i: number, patch: Partial<Draft>) => { setRows(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x))); save.clearFieldErrors(); };
  const add = () => { setRows(r => withLayer(r.map(x => ({ ...toLayer(x), module: m })), m).map(toDraft)); save.clearFieldErrors(); };
  const drop = (i: number) => { setRows(r => r.filter((_, j) => j !== i)); save.clearFieldErrors(); };
  const err = (i: number, f: string) => save.fieldError(`steps.${i}.${f}`);
  const general = save.refusal && !/^steps\.\d+\./.test(save.refusal.field ?? '') ? save.refusal : null;
  const send = () => save.mutate({ module: m, steps: rows.map(toLayer), ifMatch: chain.version },
    { onSuccess: r => { toastInfo(r.message); onClose(); } });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} width="xwide" title={`${m} approval chain`}
      description="Layers run in order. Each one signs off when its condition applies, within its SLA."
      footer={<>
        <Button testId={tid.aappr.chainCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.aappr.chainSave} kind="primary" pending={save.isPending(`chain/${m}`)} onClick={send}>Save</Button>
      </>}>
      <Table>
        <TableHeader><TableRow>
          <TableHead className="w-[52px]">Layer</TableHead><TableHead>Approver role</TableHead><TableHead>Scope</TableHead>
          <TableHead>When it applies</TableHead><TableHead>SLA</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r, i) => r.fixed
            ? <Row key={i} testId={tid.aappr.layer(i)}>
                <TableCell><Pill tone="neu">{i + 1}</Pill></TableCell>
                <TableCell><span className="inline-flex items-center gap-xs">{r.role}<Lock aria-hidden="true" className="size-[13px] text-text-muted" />
                  <Tip testId={tid.aappr.dialogFixedTip} text={FIXED_TIP} /></span></TableCell>
                <TableCell className="text-xs text-text-muted">{r.scope}</TableCell>
                <TableCell className="text-xs text-text-muted">{r.when}</TableCell>
                <TableCell className="text-xs text-text-muted">{r.sla}</TableCell>
                <TableCell />
              </Row>
            : <Row key={i} testId={tid.aappr.layer(i)}>
                <TableCell className="align-top"><Pill tone="ok">{i + 1}</Pill></TableCell>
                <TableCell className="align-top"><CellSelect testId={tid.aappr.role(i)} label={`Layer ${i + 1} approver role`} value={r.role} error={err(i, 'role')}
                  options={roleOptions(m)} onChange={v => set(i, { role: v })} /></TableCell>
                <TableCell className="align-top"><CellSelect testId={tid.aappr.scope(i)} label={`Layer ${i + 1} scope`} value={r.scope} error={err(i, 'scope')}
                  options={STEP_SCOPES} onChange={v => set(i, { scope: v })} /></TableCell>
                <TableCell className="align-top"><CellSelect testId={tid.aappr.when(i)} label={`Layer ${i + 1} condition`} value={r.when} error={err(i, 'when')}
                  options={whenOptions(m)} onChange={v => set(i, { when: v })} /></TableCell>
                <TableCell className="align-top">
                  <span className="flex items-center gap-xs">
                    <input data-testid={tid.aappr.slaN(i)} aria-label={`Layer ${i + 1} SLA`} inputMode="numeric" value={r.n} aria-invalid={err(i, 'sla') ? 'true' : undefined}
                      onChange={e => set(i, { n: e.target.value })}
                      className="h-7 w-[56px] rounded-sm border border-border-strong bg-surface-sunken px-sm text-right text-xs tabular-nums outline-none focus:border-brand focus:shadow-focus aria-invalid:border-err max-md:min-h-touch max-md:text-base" />
                    <SettingSelect small testId={tid.aappr.slaUnit(i)} aria-label={`Layer ${i + 1} SLA unit`} value={r.unit}
                      onChange={e => set(i, { unit: e.target.value === 'days' ? 'days' : 'hours' })}>
                      {SLA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </SettingSelect>
                  </span>
                  {err(i, 'sla') && <p className="mt-xs text-xs text-err">{err(i, 'sla')}</p>}
                </TableCell>
                <TableCell className="text-right align-top">
                  <Button testId={tid.aappr.remove(i)} kind="ghost" small aria-label={`Remove layer ${i + 1}`} onClick={() => drop(i)}>Remove</Button>
                </TableCell>
              </Row>)}
        </TableBody>
      </Table>
      <AddLine testId={tid.aappr.add} label="Add approval layer" note={m === 'Timesheet' ? 'It goes in before the posting step.' : undefined} onClick={add} />
      {general && <FormWarn testId={tid.aappr.chainWarn}>{general.message} <span className="opacity-90">{general.next}</span></FormWarn>}
    </Modal>);
}

function CellSelect({ testId, label, value, options, error, onChange }: {
  testId: string; label: string; value: string; options: readonly string[]; error?: string; onChange: (v: string) => void;
}) {
  /* a value the list does not hold (an older chain) stays shown until it is changed */
  const all = options.includes(value) ? options : [value, ...options];
  return (
    <>
      <SettingSelect small testId={testId} aria-label={label} value={value} aria-invalid={error ? 'true' : undefined}
        className={cn(CELL_SELECT, error && 'border-err')} onChange={e => onChange(e.target.value)}>
        {all.map(o => <option key={o} value={o}>{o}</option>)}
      </SettingSelect>
      {error && <p className="mt-xs text-xs text-err">{error}</p>}
    </>);
}

/* Set up delegation: the prototype's deleg-add pushed one fixed row; here the
   approver, who covers, the first and last day (both included) and the
   modules are chosen, and the server refuses covering yourself, a loop and
   an overlap on the field they concern. */
export function DelegationDialog({ approvers, onClose }: { approvers: Delegations['approvers']; onClose: () => void }) {
  const create = useCreateDelegation();
  const [who, setWho] = useState(''), [to, setTo] = useState(''), [from, setFrom] = useState(''), [until, setUntil] = useState('');
  const [modules, setModules] = useState<ChainModule[]>(['Timesheet', 'Leave']);
  const edited = () => create.clearFieldErrors();
  const toggle = (m: ChainModule, on: boolean) => { setModules(ms => (on ? [...ms, m] : ms.filter(x => x !== m))); edited(); };
  const general = create.refusal && !['who', 'to', 'from', 'until', 'modules'].includes(create.refusal.field ?? '') ? create.refusal : null;
  const send = () => create.mutate({ who, to, from, until, modules }, { onSuccess: r => { toastInfo(r.message); onClose(); } });
  const people = (
    <>
      <option value="">Choose a person</option>
      {approvers.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
    </>);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Set up delegation"
      description="Another approver receives the queue for these dates, both days included. Every decision records who acted."
      footer={<>
        <Button testId={tid.aappr.delegCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.aappr.delegSave} kind="primary" pending={create.isPending('delegations/new')} onClick={send}>Set up delegation</Button>
      </>}>
      <FieldGrid>
        <Field label="Approver" required error={create.fieldError('who')}>
          <NativeSelect testId={tid.aappr.who} value={who} onChange={e => { setWho(e.target.value); edited(); }}>{people}</NativeSelect>
        </Field>
        <Field label="Delegated to" required error={create.fieldError('to')}>
          <NativeSelect testId={tid.aappr.to} value={to} onChange={e => { setTo(e.target.value); edited(); }}>{people}</NativeSelect>
        </Field>
        <Field label="From" required error={create.fieldError('from')}>
          <TextInput testId={tid.aappr.from} type="date" value={from} onChange={e => { setFrom(e.target.value); edited(); }} />
        </Field>
        <Field label="Until" required error={create.fieldError('until')}>
          <TextInput testId={tid.aappr.until} type="date" value={until} onChange={e => { setUntil(e.target.value); edited(); }} />
        </Field>
      </FieldGrid>
      <fieldset aria-describedby={create.fieldError('modules') ? 'deleg-modules-error' : undefined}>
        <legend className="mb-[5px] text-xs font-semibold text-text-secondary">Modules</legend>
        {CHAIN_MODULES.map(m => (
          <CheckRow key={m} control={<CheckboxField testId={tid.aappr.module(m)} checked={modules.includes(m)} onCheckedChange={v => toggle(m, v === true)} />}>{m}</CheckRow>))}
        {create.fieldError('modules') && <p id="deleg-modules-error" className="mt-xs text-xs text-err">{create.fieldError('modules')}</p>}
      </fieldset>
      {general && <FormWarn testId={tid.aappr.delegWarn}>{general.message} <span className="opacity-90">{general.next}</span></FormWarn>}
    </Modal>);
}

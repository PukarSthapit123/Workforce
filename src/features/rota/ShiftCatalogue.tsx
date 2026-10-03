import { useState } from 'react';
import { tid } from '@/testids';
import {
  Banner, Button, CheckboxField, CheckRow, Field, FieldGrid, InlineInput, Modal, Pill, Row, SettingSelect, SwitchField, TextInput, Tip, UnitInput,
  toastInfo, toastRefusal,
} from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useCreateShiftType, useDeleteShiftType, useUpdateShiftType, type ShiftCatalogue, type ShiftTypeRecord, type UpdateShiftType } from '@/api/rota';
import { SHIFT_TONES, recalcShift, shiftTypeProblem, type ShiftTone } from '@/domain/rota';

/* The shift catalogue: the prototype's shiftCatalogueBody and shiftTypeBox
   (qnipay-workforce-v15.html:7206-7227, 10297-10328), built once and shown in
   two places, Shift catalogue for a manager and Rota setup for an admin.
   The prototype applied each inline change as it was typed. Here a row's
   edits are a draft until that row's Save (Cancel puts it back): each shift
   type is its own versioned record, so one Save is one If-Match write and one
   audit row with the before and after (D12). Paid hours and the midnight
   crossing are worked out from the times as you type, and again on the server. */

const TONE_OPTIONS = SHIFT_TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>);
const isTone = (v: string): v is ShiftTone => SHIFT_TONES.some(([t]) => t === v);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const paidLine = (s: { name: string; from: string; to: string; hours: number; cross: boolean }) =>
  `${s.name} · ${s.from}–${s.to} · ${s.hours}h paid${s.cross ? ' · crosses midnight' : ''}`;

export function ShiftCatalogueBody({ catalogue, onAdd }: { catalogue: ShiftCatalogue; onAdd: () => void }) {
  const update = useUpdateShiftType(), remove = useDeleteShiftType();
  return (
    <>
      <Table data-testid={tid.tshifts.catalogue}>
        <TableHeader><TableRow>
          <TableHead>Code</TableHead><TableHead>Shift</TableHead><TableHead>From</TableHead><TableHead>To</TableHead>
          <TableHead className="text-right">Break</TableHead><TableHead className="text-right">Paid</TableHead>
          <TableHead>Night</TableHead><TableHead>Colour</TableHead><TableHead>In use</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{catalogue.items.map(s => (
          /* a saved row starts again from the server's copy */
          <ShiftRow key={`${s.code}:${s.version}`} s={s} codes={catalogue.items.map(x => x.code)}
            usage={catalogue.usage[s.code] ?? { rota: 0, patterns: 0 }} update={update} remove={remove} />))}
        </TableBody>
      </Table>
      <div className="mt-lg flex flex-wrap justify-end gap-sm">
        <Button testId={tid.tshifts.add} kind="ghost" small onClick={onAdd}>Add shift type</Button>
      </div>
    </>);
}

interface Draft { name: string; from: string; to: string; brk: string; night: boolean; tone: string }
const draftOf = (s: ShiftTypeRecord): Draft => ({ name: s.name, from: s.from, to: s.to, brk: String(s.breakMinutes), night: s.night, tone: s.tone });

function ShiftRow({ s, codes, usage, update, remove }: {
  s: ShiftTypeRecord; codes: readonly string[]; usage: { rota: number; patterns: number };
  update: ReturnType<typeof useUpdateShiftType>; remove: ReturnType<typeof useDeleteShiftType>;
}) {
  const [d, setD] = useState<Draft>(() => draftOf(s));
  const [bad, setBad] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => { setD(x => ({ ...x, ...p })); setBad(null); };
  const input = { code: s.code, name: d.name, from: d.from.trim(), to: d.to.trim(), breakMinutes: Number(d.brk), night: d.night, tone: d.tone };
  /* the paid hours and midnight crossing the draft would have */
  const shown = recalcShift(input) ?? s;
  const body: UpdateShiftType = {
    ...(d.name.trim() !== s.name ? { name: d.name.trim() } : {}),
    ...(input.from !== s.from ? { from: input.from } : {}),
    ...(input.to !== s.to ? { to: input.to } : {}),
    ...(input.breakMinutes !== s.breakMinutes ? { breakMinutes: input.breakMinutes } : {}),
    ...(d.night !== s.night ? { night: d.night } : {}),
    ...(d.tone !== s.tone && isTone(d.tone) ? { tone: d.tone } : {}),
  };
  const dirty = Object.keys(body).length > 0;
  const key = `rota/shift-type/${s.code}`;
  /* the domain rule the server applies; its refusal is toasted too */
  const err = (f: string) => (bad === f ? true : undefined);
  const save = () => {
    const p = shiftTypeProblem(input, codes, false);
    if (p) { setBad(p.field ?? null); toastRefusal({ message: p.message, next: 'Correct it, then save the row.' }); return; }
    update.mutate({ shift: s, body }, { onSuccess: r => {
      const timed = body.from !== undefined || body.to !== undefined || body.breakMinutes !== undefined;
      toastInfo(paidLine(r.record), body.night === true ? 'Only night-eligible types can be assigned to it now.'
        : timed ? 'Rest and coverage checks are recalculated.' : undefined);
    } });
  };
  return (
    <Row testId={tid.tshifts.row(s.code)}>
      <TableCell className="font-mono"><strong>{s.code}</strong></TableCell>
      <TableCell><InlineInput testId={tid.tshifts.name(s.code)} aria-label={`Name of shift ${s.code}`} className="min-w-[104px]"
        value={d.name} aria-invalid={err('name')} onChange={e => set({ name: e.target.value })} /></TableCell>
      <TableCell><InlineInput testId={tid.tshifts.from(s.code)} aria-label={`${s.name} starts`} className="w-20 min-w-20 text-center font-mono"
        value={d.from} aria-invalid={err('from')} onChange={e => set({ from: e.target.value })} /></TableCell>
      <TableCell><span className="inline-flex items-center gap-xs">
        <InlineInput testId={tid.tshifts.to(s.code)} aria-label={`${s.name} finishes`} className="w-20 min-w-20 text-center font-mono"
          value={d.to} aria-invalid={err('to')} onChange={e => set({ to: e.target.value })} />
        {shown.cross && <Pill testId={tid.tshifts.cross(s.code)} tone="info" note="Crosses midnight. It finishes the next day.">+1d</Pill>}</span></TableCell>
      <TableCell className="text-right"><UnitInput testId={tid.tshifts.brk(s.code)} unit="min" aria-label={`${s.name} unpaid break`} className="ml-auto [&_input]:w-[46px]"
        type="number" inputMode="numeric" min="0" max="180" step="5" value={d.brk} aria-invalid={err('breakMinutes')} onChange={e => set({ brk: e.target.value })} /></TableCell>
      <TableCell className="text-right font-mono" data-testid={tid.tshifts.paid(s.code)}><strong>{shown.hours}</strong></TableCell>
      <TableCell><SwitchField testId={tid.tshifts.night(s.code)} aria-label={`${s.name} is a night shift`} checked={d.night} onCheckedChange={v => set({ night: v })} /></TableCell>
      <TableCell><SettingSelect testId={tid.tshifts.tone(s.code)} small aria-label={`${s.name} colour on the rota`} value={d.tone}
        onChange={e => set({ tone: e.target.value })}>{TONE_OPTIONS}</SettingSelect></TableCell>
      <TableCell className="text-xs whitespace-nowrap text-text-muted" data-testid={tid.tshifts.usage(s.code)}>
        {plural(usage.rota, 'rota day')}<br />{plural(usage.patterns, 'pattern day')}</TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {dirty
          ? <span className="inline-flex gap-[6px]">
              <Button testId={tid.tshifts.cancel(s.code)} kind="ghost" small disabled={update.isPending(key)} onClick={() => { setD(draftOf(s)); setBad(null); }}>Cancel</Button>
              <Button testId={tid.tshifts.save(s.code)} kind="primary" small pending={update.isPending(key)} onClick={save}>Save</Button></span>
          : <Button testId={tid.tshifts.remove(s.code)} kind="ghost" small pending={remove.isPending(key)}
              onClick={() => remove.mutate(s, { onSuccess: () => toastInfo(`${s.name} (${s.code}) removed from the catalogue.`, 'Employee types no longer list it.') })}>Remove</Button>}
      </TableCell>
    </Row>);
}

/* shiftTypeBox and ns-create (v15:10297-10328, 12294-12319): a bespoke shift
   type. Times define it; length and midnight crossing are worked out. */
export function NewShiftTypeDialog({ codes, onClose }: { codes: readonly string[]; onClose: () => void }) {
  const [f, setF] = useState({ code: '', name: '', from: '16:00', to: '00:30', brk: '0', tone: 'N', night: false, eligibleAll: true });
  const [shown, setShown] = useState<string | null>(null);
  const create = useCreateShiftType();
  const set = (p: Partial<typeof f>) => { setF(x => ({ ...x, ...p })); setShown(null); };
  const input = { code: f.code.trim().toUpperCase(), name: f.name.trim(), from: f.from.trim(), to: f.to.trim(), breakMinutes: Number(f.brk), night: f.night, tone: f.tone };
  const problem = shiftTypeProblem(input, codes, true);
  const err = (field: string) => (shown === field ? problem?.message : undefined) ?? create.fieldError(field);
  const go = () => {
    if (problem) { setShown(problem.field ?? 'code'); return; }
    create.mutate({ ...input, tone: isTone(input.tone) ? input.tone : undefined, eligibleAll: f.eligibleAll }, { onSuccess: r => {
      onClose();
      toastInfo(`${paidLine(r.record).replace(`${r.record.name} ·`, `${r.record.name} added ·`)}${r.record.night ? ' · night shift' : ''}`);
    } });
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="New shift type"
      footer={<>
        <Button testId={tid.tshifts.newCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.tshifts.newCreate} kind="primary" pending={create.anyPending} onClick={go}>Add shift type</Button>
      </>}>
      <FieldGrid>
        <Field label="Code" required hint="Short and unique. This is what appears on the rota grid." error={err('code')}>
          <TextInput testId={tid.tshifts.newCode} maxLength={4} placeholder="e.g. TN" className="uppercase" value={f.code} onChange={e => set({ code: e.target.value })} /></Field>
        <Field label="Name" required error={err('name')}>
          <TextInput testId={tid.tshifts.newName} placeholder="e.g. Twilight" value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="Starts" required error={err('from')}>
          <TextInput testId={tid.tshifts.newFrom} placeholder="HH:MM" value={f.from} onChange={e => set({ from: e.target.value })} /></Field>
        <Field label="Finishes" required error={err('to')}>
          <TextInput testId={tid.tshifts.newTo} placeholder="HH:MM" value={f.to} onChange={e => set({ to: e.target.value })} /></Field>
        <Field label="Unpaid break" hint="Deducted from the paid hours." error={err('breakMinutes')}>
          <TextInput testId={tid.tshifts.newBreak} type="number" min="0" max="180" step="5" value={f.brk} onChange={e => set({ brk: e.target.value })} /></Field>
        <Field label="Colour on the rota">
          <SettingSelect testId={tid.tshifts.newTone} className="h-[38px] max-w-none" value={f.tone} onChange={e => set({ tone: e.target.value })}>{TONE_OPTIONS}</SettingSelect></Field>
      </FieldGrid>
      <CheckRow control={<CheckboxField testId={tid.tshifts.newNight} checked={f.night} onCheckedChange={v => set({ night: v === true })} />}
        tip={<Tip testId={tid.tshifts.newNightTip} text="Night shifts are only offered to night-trained, night-eligible workers." />}>Treat it as a night shift</CheckRow>
      <CheckRow control={<CheckboxField testId={tid.tshifts.newEligible} checked={f.eligibleAll} onCheckedChange={v => set({ eligibleAll: v === true })} />}
        tip={<Tip testId={tid.tshifts.newEligibleTip} text="Otherwise nobody can be assigned to it until you tick it on each employee type." />}>Make every employee type eligible for it</CheckRow>
      <div className="mt-[10px]">
        <Banner tone="info" title="Length and midnight crossing are worked out, not typed">
          A finish time at or before the start means the shift runs past midnight, and the paid hours, rest checks and coverage columns all follow from the times you give.</Banner>
      </div>
    </Modal>);
}

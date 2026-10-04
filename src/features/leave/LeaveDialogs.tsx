import { useState } from 'react';
import { tid } from '@/testids';
import { Banner, Button, Fact, Field, FieldGrid, FormWarn, GroupLabel, Modal, SelectBox, Small, TextInput, toastInfo } from '@/ui';
import { useRequestLeave, type MyLeave } from '@/api/leave';
import {
  CHOOSE_TYPE, LEAVE_PARTS, PART_LABEL, SIMULATION_NOTE, isLeavePart, leaveShape, leaveWritesRota, moreThanLeft, proRataSimulation, wouldRemain,
  type LeavePart,
} from '@/domain/leave';
import { addDays } from '@/domain/time';
import { useTenant } from '@/shell/shellData';

/* The dialogs My leave opens: leaveRequestModal with leaveShape and
   leaveRecalc, entitlementModal and proRataModal
   (qnipay-workforce-v15.html:7715-7836). */

const firstName = (name: string) => name.split(/\s/)[0] ?? name;
const READ_ONLY = 'read-only:cursor-default read-only:bg-surface-tint read-only:text-text-secondary';
const daysHours = (days: number, hours: number) => `${days} days · ${hours.toFixed(2)} hours`;

/* leaveRecalc: what "Comes to" reads and what it says under it, worked out
   as the fields change. The server checks the same rules again on send. */
function recalc(m: MyLeave, input: { type: string; from: string; to: string; part: LeavePart }) {
  const t = m.types.find(x => x.code === input.type);
  if (!t) return { qty: '—', msg: CHOOSE_TYPE, bad: true };
  const s = leaveShape(input, t.unit, m.facts.contractedHours);
  if (!s.ok) return { qty: '—', msg: s.message, bad: true };
  const { days, label, note } = s.shape;
  if (t.code === 'AL' && m.rules.entitlement) {
    return days > m.balance.leftD ? { qty: label, msg: moreThanLeft(m.balance.leftD), bad: true } : { qty: label, msg: wouldRemain(m.balance.leftD, days), bad: false };
  }
  return { qty: label, msg: note, bad: false };
}

/* leaveRequestModal (v15:7756-7791): the type and what it draws on, the
   dates, how much of each day, "Comes to", a note, the evidence the type asks
   for (upload is not built), and who decides and by when. */
export function RequestDialog({ m, onClose }: { m: MyLeave; onClose: () => void }) {
  const send = useRequestLeave();
  const tenant = useTenant().data;
  const [type, setType] = useState(m.types.find(t => t.code === 'AL')?.code ?? m.types[0]?.code ?? '');
  const [from, setFrom] = useState(addDays(m.today, 21));
  const [to, setTo] = useState(addDays(m.today, 22));
  const [part, setPart] = useState<LeavePart>('full');
  const [note, setNote] = useState('');
  const t = m.types.find(x => x.code === type);
  const r = recalc(m, { type, from, to, part });
  const edited = () => send.clearFieldErrors();
  const sla = !!tenant?.flags.LV_SLA, rota = tenant ? leaveWritesRota(tenant.modules, tenant.flags) : false;
  const general = send.refusal && !send.refusal.field ? send.refusal : null;
  const submit = () => send.mutate({ type, from, to, part, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: x => {
    onClose(); toastInfo(x.summary, x.hint || undefined);
  } });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Request leave"
      footer={<>
        <Button testId={tid.leave.sendCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.leave.send} kind="primary" disabled={r.bad} pending={send.anyPending} onClick={submit}>Send request</Button>
      </>}>
      <Field label="Type of leave" hint={t?.hint} error={send.fieldError('type')}>
        <SelectBox testId={tid.leave.type} value={type} options={m.types.map(x => ({ value: x.code, label: x.name }))}
          onValueChange={v => { setType(v); edited(); }} />
      </Field>
      <FieldGrid>
        <Field label="First day" error={send.fieldError('from')}>
          <TextInput testId={tid.leave.from} type="date" value={from} onChange={e => {
            const v = e.target.value;
            setFrom(v);
            /* a last day before the new first day moves up to it */
            if (to < v) setTo(v);
            edited();
          }} />
        </Field>
        <Field label="Last day" error={send.fieldError('to')}>
          <TextInput testId={tid.leave.to} type="date" value={to} onChange={e => { setTo(e.target.value); edited(); }} />
        </Field>
        <Field label="How much" error={send.fieldError('part')}>
          <SelectBox testId={tid.leave.part} value={part} options={LEAVE_PARTS.map(p => ({ value: p, label: PART_LABEL[p] }))}
            onValueChange={v => {
              if (!isLeavePart(v)) return;
              setPart(v);
              /* a morning or an afternoon is one day, so it does not silently sit on a range */
              if (v === 'am' || v === 'pm') setTo(from);
              edited();
            }} />
        </Field>
        <Field label="Comes to" {...(r.bad ? { error: r.msg } : r.msg ? { hint: r.msg } : {})}>
          <TextInput testId={tid.leave.qty} value={r.qty} readOnly className={READ_ONLY} />
        </Field>
      </FieldGrid>
      <Field label="Reason or note">
        <TextInput testId={tid.leave.note} value={note} maxLength={200} placeholder="Optional. Your approver sees it." onChange={e => setNote(e.target.value)} />
      </Field>
      {t?.evidence && <Field label="Evidence">
        <TextInput testId={tid.leave.evidence} readOnly className={READ_ONLY}
          value="Required for this leave type. Upload is not built yet, so give it to your approver." />
      </Field>}
      <Banner testId={tid.leave.sla} tone="info"
        title={tenant?.modules.R ? 'Your manager sees the effect on cover' : 'Cover is not checked, as this organisation does not use Rota'}>
        {m.person.manager} has {m.rules.slaDays} days to decide{sla ? `, then it escalates to the ${m.rules.escalateTo}.` : '.'}
        {rota && ' Once approved you are marked unavailable on the rota and coverage is recalculated.'}
      </Banner>
      {general && <FormWarn testId={tid.leave.formWarn}>{general.message} {general.next}</FormWarn>}
    </Modal>);
}

/* entitlementModal (v15:7793-7820): the calculation shown, not just its result. */
export function EntitlementDialog({ m, onClose, onSimulate }: { m: MyLeave; onClose: () => void; onSimulate?: () => void }) {
  const e = m.entitlement, b = m.balance, pol = e.policy;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`How ${firstName(m.person.name)}’s entitlement was worked out`}
      footer={<>
        <Button testId={tid.leave.entClose} kind="ghost" onClick={onClose}>Close</Button>
        {onSimulate && <Button testId={tid.leave.simulate} kind="primary" onClick={onSimulate}>Simulate an hours change</Button>}
      </>}>
      <Banner testId={tid.leave.entPolicy} tone="info" title={pol.name}>{pol.method} · {pol.prorata}</Banner>
      <GroupLabel>Calculation</GroupLabel>
      {e.lines.map((l, i) => <Fact key={l.label} label={l.label} testId={tid.leave.entLine(i)}><span className="font-mono">{l.value}</span></Fact>)}
      <GroupLabel className="mt-[18px]">Balance today</GroupLabel>
      <Fact label="Entitlement" testId={tid.leave.entEntitlement}><span className="font-mono">{daysHours(e.days, e.hours)}</span></Fact>
      <Fact label="Taken" testId={tid.leave.entTaken}><span className="font-mono">{daysHours(b.takenD, b.takenH)}</span></Fact>
      <Fact label="Awaiting a decision" testId={tid.leave.entPending}><span className="font-mono">{b.pending} days</span></Fact>
      <Fact label="Remaining" testId={tid.leave.entRemaining}><span className="font-mono">{daysHours(b.leftD, b.leftH)}</span></Fact>
      <GroupLabel className="mt-[18px]">Policy rules applied</GroupLabel>
      <Fact label="Statutory floor" testId={tid.leave.entStatutory}>{pol.statutory ? `${pol.statutory} days including bank holidays` : 'Not applicable'}</Fact>
      <Fact label="Service rule" testId={tid.leave.entService}>{pol.serviceRule}</Fact>
      <Fact label="Carry-over" testId={tid.leave.entCarry}>{pol.carry} days</Fact>
      <Fact label="Bank holidays" testId={tid.leave.entBh}>{pol.bh}</Fact>
      <Small className="mt-[14px]">Both units are always available: the same entitlement is held in days and in hours, and the display unit follows
        the employee type’s policy. Change the contracted hours on the person record in People and this recalculates on a pro-rata basis.</Small>
    </Modal>);
}

/* proRataModal (v15:7822-7836) as a simulation (D3): Leave never edits the
   person record, so this works the new entitlement out on the screen and
   writes nothing. People owns contracted hours. */
export function SimulateDialog({ m, onClose }: { m: MyLeave; onClose: () => void }) {
  const [hours, setHours] = useState(String(m.facts.contractedHours >= 30 ? 22.5 : 37.5));
  const n = Number(hours), valid = hours.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 48;
  const facts = { contractedHours: m.facts.contractedHours, start: m.facts.start,
    ...(m.facts.accruedHours !== undefined ? { accruedHours: m.facts.accruedHours } : {}) };
  const sim = valid ? proRataSimulation(facts, n, m.entitlement.policy, m.today) : null;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Simulate an hours change for ${firstName(m.person.name)}`}
      description="Changing contracted hours on the shared workforce record recalculates leave entitlement on a pro-rata basis and updates the balance. Rota and Timesheet pick the new contracted hours up at the same moment."
      footer={<Button testId={tid.leave.simClose} kind="ghost" onClick={onClose}>Close</Button>}>
      <FieldGrid>
        <Field label="Contracted hours now">
          <TextInput testId={tid.leave.simNow} value={m.facts.contractedHours} readOnly className={READ_ONLY} />
        </Field>
        <Field label="New contracted hours" {...(valid ? {} : { error: 'Enter hours between 0 and 48.' })}>
          <TextInput testId={tid.leave.simHours} type="number" inputMode="decimal" step="0.5" min="0" max="48" value={hours}
            onChange={e => setHours(e.target.value)} />
        </Field>
      </FieldGrid>
      <GroupLabel className="mt-[14px]">Entitlement</GroupLabel>
      <Fact label={`Today · ${m.entitlement.policy.name}`} testId={tid.leave.simBefore}>
        <span className="font-mono">{daysHours(m.entitlement.days, m.entitlement.hours)}</span></Fact>
      {sim && <>
        <Fact label={`With ${n} hours a week`} testId={tid.leave.simAfter}><span className="font-mono">{daysHours(sim.after.days, sim.after.hours)}</span></Fact>
        <Fact label="Change" testId={tid.leave.simChange}><span className="font-mono">{sim.text}</span></Fact>
      </>}
      <div className="mt-md"><Banner testId={tid.leave.simNote} tone="info" title="Nothing is saved">{SIMULATION_NOTE}</Banner></div>
    </Modal>);
}

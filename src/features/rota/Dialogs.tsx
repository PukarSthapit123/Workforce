import { useState } from 'react';
import { useNavigate } from 'react-router';
import { tid } from '@/testids';
import {
  Banner, Button, Empty, Fact, Field, Modal, Row, RuledOutList, RuledOutRow, SelectBox, Small, SugCard, SwitchField, Tip, toastInfo, toastRefusal,
} from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useCellSuggestions, useClearWeek, useOpenCover, useRepeatWeek, type RotaRow, type RotaWeekView } from '@/api/rota';
import { addDays, addMonths, formatDay, periodStart } from '@/domain/time';
import {
  COVER_REASONS, NOBODY_CAN_TAKE, NO_REASONS_WHY, REPEAT_WEEKS, clearPreview, restAround, shiftBy, shiftHours, shiftName, shiftTime, thinnest,
} from '@/domain/rota';
import type { PlanItem } from '@/contract/rota';
import { DAY_INDEXES, MONTH_NAMES, longDay, shortDay, weekRange } from './week';

/* The dialogs Team rota opens: addShiftBox, gapBox, shiftBox, adhocBox,
   horizonBox and the clear and repeat confirmations (qnipay-workforce-v15.html:
   9814-9914, 10447-10469, 12082-12166). Every assignment in them goes through
   the page's one assignment path. */

const ref = (v: RotaWeekView) => ({ location: v.location.code, weekStart: v.weekStart, version: v.version });
const shiftOptions = (v: RotaWeekView) => v.shifts.map(s => ({ value: s.code, label: `${s.name} · ${s.from}–${s.to}` }));
export const askFirst = (name: string) =>
  toastInfo(`Simulated · ${name.split(' ')[0] ?? name} would be asked first.`, 'No message is sent in this build.');

/* Advertising a shift opens a cover request and takes you to Cover requests. */
function useAdvertise(view: RotaWeekView, onDone: () => void) {
  const open = useOpenCover();
  const navigate = useNavigate();
  return {
    pending: open.anyPending,
    send: (day: number, code: string, reason: string, urgent: boolean, said: string) => {
      open.mutate({ location: view.location.code, date: addDays(view.weekStart, day), shift: code, reason, urgent }, { onSuccess: () => {
        onDone(); toastInfo(said); void navigate('/team/tcover');
      } });
    },
  };
}

/* sugHTML (v15:9819-9833): who could take the shift, best first with the
   reasons, and who is ruled out by which rule. */
function Suggestions({ view, day, code, busy, onAssign }: {
  view: RotaWeekView; day: number; code: string; busy: boolean; onAssign: (personCode: string) => void;
}) {
  const q = useCellSuggestions(view.location.code, view.weekStart, day, code);
  const rowOf = (c: string) => view.rows.find(r => r.personCode === c);
  if (!q.data) return <Small>{q.isError ? 'Suggestions could not be loaded.' : 'Finding who could take it…'}</Small>;
  const { ok, no } = q.data;
  return (
    <>
      <div className="mb-sm flex items-center text-xs font-bold tracking-[.08em] text-text-muted">Suggested
        <Tip testId={tid.trota.sugTip} text="Eligibility is checked first as a hard rule. The ranking only orders whoever already passed it." /></div>
      {ok.length ? ok.slice(0, 3).map((x, i) => {
        const r = rowOf(x.personCode);
        return (
          <SugCard key={x.personCode} testId={tid.trota.sug(x.personCode)} best={i === 0} name={x.name}
            sub={`${x.category}${r && r.contractedHours > 0 ? ` · ${r.hours.rot}h of ${r.contractedHours}h` : ''}`}
            why={x.why.length ? x.why : [NO_REASONS_WHY]}
            actions={<>
              <Button testId={tid.trota.sugAssign(x.personCode)} kind={i === 0 ? 'primary' : 'ghost'} small pending={busy} onClick={() => onAssign(x.personCode)}>Assign</Button>
              <Button testId={tid.trota.sugAsk(x.personCode)} kind="ghost" small onClick={() => askFirst(x.name)}>Ask first</Button>
            </>} />);
      }) : <Empty testId={tid.trota.sugNone}>Nobody can take this shift without breaking a hard rule.</Empty>}
      {ok.length > 3 && <Small testId={tid.trota.sugMore}>{ok.length - 3} more could take it, ranked lower.</Small>}
      {no.length > 0 && <RuledOutList label={<span className="flex items-center">Not eligible, and why
        <Tip testId={tid.trota.ruledTip} text="These people are never offered the shift while the exclusion stands." /></span>}>
        {no.slice(0, 7).map(x => <RuledOutRow key={x.personCode} testId={tid.trota.ruled(x.personCode)} name={x.name} why={`${x.rule}: ${x.reason}`} />)}
      </RuledOutList>}
    </>);
}

function ShiftPicker({ view, value, onChange, label = 'Which shift', hint }: {
  view: RotaWeekView; value: string; onChange: (c: string) => void; label?: string; hint?: string;
}) {
  return <Field label={label} hint={hint}><SelectBox testId={tid.trota.pick} options={shiftOptions(view)} value={value} onValueChange={onChange} /></Field>;
}

/* addShiftBox (v15:9834-9852): an empty cell. Pick the shift, then assign this
   person, or one of the suggestions, or advertise it to the bank. */
export function AddShiftDialog({ view, row, day, busy, onAssign, onClose }: {
  view: RotaWeekView; row: RotaRow; day: number; busy: boolean; onAssign: (personCode: string, code: string) => void; onClose: () => void;
}) {
  const [code, setCode] = useState(view.shifts[0]?.code ?? '');
  const ad = useAdvertise(view, onClose);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Add a shift"
      footer={<>
        <Button testId={tid.trota.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        {view.rules.fulfil && <Button testId={tid.trota.advertise} kind="secondary" pending={ad.pending}
          onClick={() => ad.send(day, code, '', false, `Cover request opened for ${longDay(view.weekStart, day)}`)}>Advertise to the bank instead</Button>}
      </>}>
      <Small className="mb-[14px]">{longDay(view.weekStart, day)} · {view.onShift[day] ?? 0} of {view.min} on shift at {view.location.name}</Small>
      <ShiftPicker view={view} value={code} onChange={setCode} />
      <div className="mb-md rounded-card border bg-surface-sunken p-(--qp-density-pad)">
        <div className="flex flex-wrap items-center gap-md">
          <div><div className="text-sm font-semibold">{row.name}</div>
            <Small>{row.jobProfileName} · {row.typeName} · {row.contractedHours > 0 ? `${row.hours.rot}h of ${row.contractedHours}h this week` : 'bank'}</Small></div>
          <div className="ml-auto"><Button testId={tid.trota.assignThis} kind="primary" small pending={busy}
            onClick={() => onAssign(row.personCode, code)}>Assign {row.name.split(' ')[0]}</Button></div>
        </div>
      </div>
      <div className="mt-[18px]"><Suggestions view={view} day={day} code={code} busy={busy} onAssign={p => onAssign(p, code)} /></div>
    </Modal>);
}

/* gapBox (v15:9853-9866): a day below the minimum. The shift with the fewest
   people that day is picked to start with. */
export function GapDialog({ view, day, busy, onAssign, onClose }: {
  view: RotaWeekView; day: number; busy: boolean; onAssign: (personCode: string, code: string) => void; onClose: () => void;
}) {
  const [code, setCode] = useState(() => thinnest(day, view.rows.map(r => r.line), view.shifts) ?? view.shifts[0]?.code ?? '');
  const ad = useAdvertise(view, onClose);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Fill this shift"
      footer={<>
        <Button testId={tid.trota.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        {view.rules.fulfil && <Button testId={tid.trota.advertise} kind="secondary" pending={ad.pending}
          onClick={() => ad.send(day, code, '', false, `Cover request opened for ${longDay(view.weekStart, day)}`)}>Advertise it instead</Button>}
      </>}>
      <Banner tone="err" title={`${longDay(view.weekStart, day)} has ${view.onShift[day] ?? 0} of ${view.min} people on shift`}>
        {view.location.name} is {view.location.level} support, so it needs {view.min} per shift.</Banner>
      <ShiftPicker view={view} value={code} onChange={setCode} label="Which shift needs filling"
        hint={`Fewest people are on the ${shiftName(view.shifts, code).toLowerCase()} shift that day.`} />
      <Suggestions view={view} day={day} code={code} busy={busy} onAssign={p => onAssign(p, code)} />
    </Modal>);
}

/* shiftBox (v15:9867-9894): one shift, where it sits, and changing or removing it. */
export function ShiftDialog({ view, row, day, busy, onChange, onRemove, onClose }: {
  view: RotaWeekView; row: RotaRow; day: number; busy: boolean; onChange: (code: string) => void; onRemove: () => void; onClose: () => void;
}) {
  const code = row.line[day] ?? '', sh = view.shifts, gap = restAround(row.line, day, code, sh);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`${shiftName(sh, code) || code} shift`}
      footer={<>
        <Button testId={tid.trota.cancel} kind="ghost" onClick={onClose}>Close</Button>
        <Button testId={tid.trota.remove} kind="danger" pending={busy} onClick={onRemove}>Remove this shift</Button>
      </>}>
      <Fact label="Colleague" testId={tid.trota.fact('colleague')}>{row.name} · <span className="font-mono">{row.personCode}</span></Fact>
      <Fact label="Date" testId={tid.trota.fact('date')}>{longDay(view.weekStart, day)} {addDays(view.weekStart, day).slice(0, 4)}</Fact>
      <Fact label="Time" testId={tid.trota.fact('time')}>{shiftTime(sh, code)} · {shiftHours(sh, code)} hours</Fact>
      <Fact label="Job profile">{row.jobProfileName}</Fact>
      <Fact label="Where it came from">{row.contractedHours > 0 ? 'Working pattern' : 'Claimed an open shift'}</Fact>
      <Fact label="Location">{view.location.name}</Fact>
      <Fact label="Cover that day" testId={tid.trota.fact('cover')}>{view.onShift[day] ?? 0} of {view.min}</Fact>
      <Fact label="Rest either side" testId={tid.trota.fact('rest')}>{gap < 0 ? 'Overlaps another shift' : gap >= 99 ? 'No adjacent shift' : `${gap} hours`}</Fact>
      <Fact label="Hours position" testId={tid.trota.fact('hours')}>
        {row.hours.rot}h rota’d of {row.contractedHours > 0 ? `${row.contractedHours}h contracted` : 'bank'} · {row.hours.wk}h worked</Fact>
      <div className="mt-lg">
        <Field label="Change the shift">
          <SelectBox testId={tid.trota.changeShift} options={shiftOptions(view)} value={shiftBy(sh, code) ? code : undefined}
            onValueChange={c => { if (c !== code) onChange(c); }} />
        </Field>
      </div>
    </Modal>);
}

/* clear-week (v15:12082-12129): what clearing removes, shown before anything is
   written. Leave and sickness are kept; each removal is recorded. */
export function ClearDialog({ view, onClose }: { view: RotaWeekView; onClose: () => void }) {
  const clear = useClearWeek();
  const p = clearPreview(Object.fromEntries(view.rows.map(r => [r.personCode, r.line])), view.rows.map(r => r.personCode));
  const go = () => clear.mutate(ref(view), { onSuccess: r => { onClose(); toastInfo(r.summary); } });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Clear week ${view.isoWeek}?`}
      footer={<>
        <Button testId={tid.trota.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.trota.clearConfirm} kind="primary" pending={clear.anyPending} onClick={go}>Clear {p.shifts} shift{p.shifts === 1 ? '' : 's'}</Button>
      </>}>
      <Fact label="Week">{weekRange(view.weekStart)}</Fact>
      <Fact label="Location">{view.location.name}</Fact>
      <Fact label="Shifts to remove" testId={tid.trota.fact('clear-shifts')}>{p.shifts}</Fact>
      <Fact label="Colleagues affected" testId={tid.trota.fact('clear-people')}>{p.colleagues}</Fact>
      <div className="mt-md">
        {p.absence > 0 && <Banner tone="info" title={`${p.absence} leave or sickness day(s) will be kept`}>Approved absence is not a shift and is not removed by clearing.</Banner>}
        <Banner tone="warn" title="This cannot be undone from here">
          Every removal is recorded against the week, so you can see what was cleared. Putting them back means assigning them again.</Banner>
      </div>
    </Modal>);
}

/* repeat-week (v15:12095-12128): the week forward, under the same protections
   as pattern generation. */
export function RepeatDialog({ view, onClose }: { view: RotaWeekView; onClose: () => void }) {
  const [weeks, setWeeks] = useState('4');
  const repeat = useRepeatWeek();
  const filled = view.rows.filter(r => r.line.some(c => !!shiftBy(view.shifts, c))).length;
  const go = () => repeat.mutate({ ...ref(view), weeks: Number(weeks) }, { onSuccess: r => { onClose(); toastInfo(r.summary); } });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Repeat week ${view.isoWeek} forward`}
      footer={<>
        <Button testId={tid.trota.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.trota.repeatConfirm} kind="primary" pending={repeat.anyPending} onClick={go}>Repeat the week</Button>
      </>}>
      <Fact label="Source week">{weekRange(view.weekStart)}</Fact>
      <Fact label="Colleagues with shifts" testId={tid.trota.fact('repeat-people')}>{filled}</Fact>
      <div className="mt-md">
        <Field label="Repeat for" hint="Counted from the week after this one.">
          <SelectBox testId={tid.trota.repeatWeeks} value={weeks} onValueChange={setWeeks}
            options={REPEAT_WEEKS.map(n => ({ value: String(n), label: `${n} weeks` }))} />
        </Field>
      </div>
      <Banner tone="warn" title="Published weeks are skipped">
        Cells that already hold a shift, leave or sickness are left alone, exactly as pattern generation behaves.</Banner>
    </Modal>);
}

/* horizonBox (v15:10447-10469): the months the rota reaches. Horizon
   publishing is declared simulated, as the prototype says: each week is
   published on its own here, so nothing is written. */
export function HorizonDialog({ view, onJump, onClose }: { view: RotaWeekView; onJump: (weekStart: string) => void; onClose: () => void }) {
  const first = `${view.today.slice(0, 8)}01`;
  const months = Array.from({ length: view.rules.horizon }, (_, i) => addMonths(first, i));
  const last = months[months.length - 1] ?? first;
  const label = (iso: string) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`;
  const mondays = (iso: string) => {
    let n = 0;
    for (let d = iso; d.slice(0, 7) === iso.slice(0, 7); d = addDays(d, 1)) if (periodStart(d) === d) n++;
    return n;
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Rota horizon · ${view.rules.horizon} months`} width="wide"
      footer={<>
        <Button testId={tid.trota.cancel} kind="ghost" onClick={onClose}>Close</Button>
        <Button testId={tid.trota.horizonPublish} kind="primary" onClick={() => {
          onClose();
          toastInfo('Simulated · horizon publishing is represented, not performed.', 'This build publishes one rota week at a time.');
        }}>Publish through {label(last)}</Button>
      </>}>
      <Small className="mb-[14px]">Rota entries are generated from working patterns up to the configured horizon. Open a month to see its first week.</Small>
      <Table dense>
        <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Weeks</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>{months.map(m => (
          <Row key={m} testId={tid.trota.horizonRow(m.slice(0, 7))}>
            <TableCell><strong>{label(m)}</strong></TableCell>
            <TableCell className="text-right tabular-nums">{mondays(m)}</TableCell>
            <TableCell className="text-right"><Button testId={tid.trota.horizonView(m.slice(0, 7))} kind="ghost" small
              onClick={() => { onClose(); onJump(periodStart(m)); }}>View</Button></TableCell>
          </Row>))}</TableBody>
      </Table>
    </Modal>);
}

/* adhocBox (v15:9895-9914): a shift on top of the minimum. Suggest someone puts
   the best eligible person in the suggested cover; Advertise opens an urgent
   cover request. */
export function AdhocDialog({ view, onPlan, onClose }: { view: RotaWeekView; onPlan: (items: PlanItem[]) => void; onClose: () => void }) {
  const [day, setDay] = useState('6');
  const [code, setCode] = useState(shiftBy(view.shifts, 'L') ? 'L' : view.shifts[0]?.code ?? '');
  const [why, setWhy] = useState<string>('Double cover');
  const [urgent, setUrgent] = useState(true);
  const d = Number(day);
  const sug = useCellSuggestions(view.location.code, view.weekStart, d, code);
  const ad = useAdvertise(view, onClose);
  const suggest = () => {
    const best = sug.data?.ok[0];
    if (!sug.data) return;
    onClose();
    if (best) onPlan([{ day: d, code, none: false, personCode: best.personCode, name: best.name, why: best.why }]);
    else {
      onPlan([{ day: d, code, none: true, personCode: '', name: '', why: [] }]);
      toastRefusal({ message: NOBODY_CAN_TAKE, next: 'Advertise it instead.' });
    }
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Add an extra shift"
      footer={<>
        <Button testId={tid.trota.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.trota.adhocSuggest} kind="secondary" pending={!sug.data} onClick={suggest}>Suggest someone</Button>
        {view.rules.fulfil && <Button testId={tid.trota.adhocAdvertise} kind="primary" pending={ad.pending}
          onClick={() => ad.send(d, code, why, urgent, `Extra shift added for ${shortDay(view.weekStart, d)}. ${urgent ? 'Treated as urgent and already being filled.' : 'Colleagues are asked in the usual stages.'}`)}>Advertise it</Button>}
      </>}>
      <div className="grid grid-cols-2 gap-md max-md:grid-cols-1">
        <Field label="Day"><SelectBox testId={tid.trota.adhocDay} value={day} onValueChange={setDay}
          options={DAY_INDEXES.map(i => ({ value: String(i), label: formatDay(addDays(view.weekStart, i)) }))} /></Field>
        <Field label="Which shift"><SelectBox testId={tid.trota.adhocCode} value={code} onValueChange={setCode} options={shiftOptions(view)} /></Field>
        <Field label="Why it is needed" tip="For cover above the minimum: one-to-one support, an appointment escort, a new admission.">
          <SelectBox testId={tid.trota.adhocWhy} value={why} onValueChange={setWhy} options={COVER_REASONS.map(r => ({ value: r, label: r }))} /></Field>
      </div>
      <div className="flex items-center gap-md pt-xs">
        <div className="flex-1"><div className="text-sm font-semibold">This is on top of the minimum</div>
          <Small>Treated as urgent, so colleagues and favourites are asked at the same time</Small></div>
        <SwitchField testId={tid.trota.adhocUrgent} aria-label="Treat as urgent" checked={urgent} onCheckedChange={setUrgent} />
      </div>
    </Modal>);
}



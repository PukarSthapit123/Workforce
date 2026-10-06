import { useState, type ReactNode } from 'react';
import { AlarmClock, CalendarDays, Check, Clock, History, Lock, Minus, RotateCw, X } from 'lucide-react';
import { tid } from '@/testids';
import { Banner, Button, CalNav, Card, CardHead, CheckboxField, CheckRow, Field, NavLink, Pill, SelectBox, Small, SwitchField, TextInput, Tip, toastInfo, type Tone } from '@/ui';
import { buttonVariants } from '@/ui/shadcn/button';
import { useMyClock, type ClockRecord, type MyClock } from '@/api/clock';
import type { DaySaved, TimesheetWeek, WeekDay } from '@/contract/timesheets';
import { CLOCK_OUT_FIRST, isOpenState } from '@/domain/clock';
import { addDays, dowMon, formatDay, formatDmy } from '@/domain/timesheet';
import { NON_WORKING_REASONS, formGroups, hm, rotaShift, valuesFromDay, valuesFromRota, varianceText } from './capture';
import { ClockCard, ForgottenClock, clockedStart } from './ClockCard';
import { DayFields, DayStatsCard, hasClosedGroups } from './DayForm';
import { DayChecks, holdFocus, useDayEntry } from './useDayEntry';

/* The day chip: the prototype's stMap in essTimesheet (qnipay-workforce-v15.html:6263-6266),
   with the glyphs from the shared icon set. A resubmission reads as awaiting approval, as dayInfo maps it. */
const CHIP: Record<string, { label: string; tone: Tone; glyph: ReactNode }> = {
  ok: { label: 'Approved', tone: 'ok', glyph: <Check /> },
  pend: { label: 'Awaiting approval', tone: 'info', glyph: <Clock /> },
  resub: { label: 'Awaiting approval', tone: 'info', glyph: <Clock /> },
  draft: { label: 'Draft · not submitted', tone: 'neu', glyph: <Minus /> },
  back: { label: 'Sent back', tone: 'err', glyph: <X /> },
  leave: { label: 'Annual leave', tone: 'neu', glyph: <Lock /> },
  sickness: { label: 'Sickness', tone: 'err', glyph: <Lock /> },
  rest: { label: 'Rest day', tone: 'neu', glyph: <Minus /> },
  future: { label: 'Not yet open', tone: 'neu', glyph: <Minus /> },
  none: { label: 'Nothing logged', tone: 'neu', glyph: <Minus /> },
};
const NONE_CHIP = { label: 'Nothing logged', tone: 'neu' as Tone, glyph: <Minus /> };
/* A day with nothing recorded is a rest day when the published rota says so (dayInfo), whether or not it has come yet. */
export function dayChip(day: WeekDay) {
  const key = day.absence ?? (day.state !== 'none' ? day.state : day.rota?.code === '' ? 'rest' : day.future ? 'future' : 'none');
  return CHIP[key] ?? NONE_CHIP;
}

/* The day view: tsDayView (qnipay-workforce-v15.html:6277-6336). The panel
   is keyed by the day and its version, so after a save the form starts again
   from what the server stored, never from what was typed (no optimistic
   updates); a clock out writes the day, so its times appear the same way.
   A clock-mode type (module 2b) reads its own clock: the card shows on the
   day the clock acts on while the server's gates allow it (D4), and a clock
   left open on an earlier day shows its close banner (D6). */
export interface DayClock { card: MyClock | null; readAt: number; open: ClockRecord | null; openBlocked: MyClock['openBlocked'] }
export function DayView({ week, date, today, onDate, personId }: {
  week: TimesheetWeek; date: string; today: string; onDate: (d: string) => void; personId: string;
}) {
  const q = useMyClock(week.capture.mode === 'clock'), c = q.data;
  const day = week.days.find(d => d.date === date);
  if (!day) return null;
  /* review I3: the card follows the current clock wherever it started: on its own day, and on today's view while it runs */
  const running = Boolean(c?.current && isOpenState(c.current.state));
  const onCard = c ? date === c.date || (running && date === c.now.date) : false;
  const clock: DayClock = { card: c?.gates.show && onCard ? c : null, readAt: q.dataUpdatedAt,
    open: c?.gates.live && c.gates.mode === 'clock' ? c.open : null, openBlocked: c?.openBlocked ?? null };
  return <DayPanel key={`${date}:${day.version}`} week={week} day={day} today={today} onDate={onDate} personId={personId} clock={clock} />;
}

function entryTip(week: TimesheetWeek, clocking: boolean) {
  const c = week.capture;
  const first = c.mode === 'clock' && clocking ? 'Clock in when you start and out when you finish.'
    : c.mode === 'grid' ? 'Enter this day here, or switch to Week to fill the whole week at once.'
      : 'Enter your start and finish times for this day.';
  const mand = formGroups(c).some(g => g.fields.some(f => f.setting.mand));
  return mand ? `${first} Fields marked required are required for ${week.person.typeName}.` : first;
}

function DayPanel({ week, day, today, onDate, personId, clock }: {
  week: TimesheetWeek; day: WeekDay; today: string; onDate: (d: string) => void; personId: string; clock: DayClock;
}) {
  const c = week.capture, rec = day.record, mgr = week.person.manager.trim() || 'your manager';
  const flagged = (r: DaySaved) => (r.warnings.length ? `Flagged: ${r.warnings.join(' ')}` : undefined);
  const entry = useDayEntry({ week, day, personId,
    onSaved: res => toastInfo(`Draft saved · ${hm(c, res.record.minutes)} · not submitted yet`, flagged(res)),
    onSubmitted: res => toastInfo(res.record.state === 'resub'
      ? `Resubmitted · ${formatDmy(day.date)} · back with ${mgr}`
      : `Day submitted · ${hm(c, res.record.minutes)} · routed to ${mgr} for sign-off`, flagged(res)) });
  const savedReason = rec && !rec.entries.length ? rec.nonWorkingReason : '';
  /* a day stored as called in and worked anyway opens that way, so saving or submitting it again keeps the mark */
  const savedAnyway = Boolean(rec?.workedAnyway && rec.entries.length);
  const [nonwork, setNonwork] = useState(Boolean(savedReason) || savedAnyway);
  const [reason, setReason] = useState(() => savedReason.split(' · ')[0] || NON_WORKING_REASONS[0]);
  const [notes, setNotes] = useState(() => savedReason.split(' · ').slice(1).join(' · '));
  const [worked, setWorked] = useState(savedAnyway);
  /* lockShiftTimes: while the shift runs the start is the clock's first clock in, and start and finish are read-only.
     The finish is empty, not the rota line's, so the stats wait for clock out; and the day cannot be saved or
     submitted until then, since the clock writes it when it stops (review I1). */
  /* only the clock's own day is held: a clock from an earlier day shown on today leaves today's form alone */
  const own = clock.card?.current?.date === day.date ? clock.card.current : null;
  const clockStart = clockedStart(own, rec?.entries[0]?.start);
  const [filled, setFilled] = useState<string | null>(null);
  if (clockStart && clockStart !== filled) {
    setFilled(clockStart);
    if (entry.fields.values.start !== clockStart || entry.fields.values.finish) entry.fill({ start: clockStart, finish: '' });
  }
  const locked = clockStart ? ['start', 'finish'] : undefined;
  const { busy, fields, stats } = entry, chip = dayChip(day);
  /* the times below go as "called in and worked anyway", which a leave or sickness day needs while leave blocks capture */
  const anyway = { workedAnyway: nonwork && worked };
  const lockedTitle = day.locked ? day.lockNote : undefined;
  const running = clockStart != null, held = day.locked || running, heldTitle = day.locked ? lockedTitle : running ? CLOCK_OUT_FIRST : undefined;

  /* submit-nonwork: a reason and no times, routed to the approver like any day */
  const submitReason = () => entry.submit.mutate(
    { personId, date: day.date, version: day.version, body: { entries: [], nonWorkingReason: notes.trim() ? `${reason} · ${notes.trim()}` : reason } },
    { onSuccess: () => toastInfo(`Reason submitted · ${reason} · routed to ${mgr}`) });
  /* copy-day: yesterday's rota line when there is one (the prototype's), otherwise yesterday's recorded entry */
  const copyYesterday = () => {
    const y = week.days[dowMon(day.date) - 1];
    if (!y) { toastInfo('No previous day in this week to copy'); return; }
    const line = rotaShift(y);
    if (line) { entry.fill(valuesFromRota(line)); toastInfo(`Filled from yesterday’s rota · ${line.from}`); return; }
    if (!y.record?.entries.length) { toastInfo('Nothing recorded yesterday to copy'); return; }
    const from = valuesFromDay(y, c);
    entry.fill(from);
    toastInfo(`Filled from yesterday · ${typeof from.start === 'string' ? from.start : ''}`);
  };
  const side = hasClosedGroups(c), line = rotaShift(day);
  const recorded = rec?.entries.length ? rec.minutes / 60 : 0;
  return (
    <>
      <Card className="px-lg py-md">
        <div className="flex flex-wrap items-center gap-md">
          <CalNav label={formatDay(day.date)} labelTestId={tid.ts.dayLabel}
            prev={{ testId: tid.ts.dayPrev, label: 'Previous day', onClick: () => onDate(addDays(day.date, -1)) }}
            next={{ testId: tid.ts.dayNext, label: 'Next day', onClick: () => onDate(addDays(day.date, 1)) }}
            back={{ testId: tid.ts.dayToday, label: 'Back to today', current: 'Today', atCurrent: day.date === today, onClick: () => onDate(today) }} />
          <div className="ml-auto flex flex-wrap items-center gap-sm">
            <label className="flex items-center gap-[9px] text-xs">Non-working day
              <SwitchField testId={tid.ts.nonWorking} aria-label="Mark as a non-working day" checked={nonwork}
                onCheckedChange={v => { setNonwork(v); setWorked(false); }} /></label>
            <Button testId={tid.ts.copyDay} kind="ghost" small onClick={copyYesterday}>Copy yesterday</Button>
            {day.clock?.late && <Pill testId={tid.clock.late} tone="warn" glyph={<AlarmClock />}>Late</Pill>}
            {day.clock?.closedLate && <Pill testId={tid.clock.closedLate} tone="neu" glyph={<History />}>Closed later</Pill>}
            <Pill testId={tid.ts.dayState} tone={chip.tone} glyph={chip.glyph}>{chip.label}</Pill>
          </div>
        </div>
      </Card>
      {clock.open && <ForgottenClock key={`${clock.open.date}:${clock.open.version}`} open={clock.open} blocked={clock.openBlocked} manager={mgr} />}
      {line && <Banner testId={tid.ts.banner('rota')} tone="info" icon={<CalendarDays />}
        title={`Scheduled on the rota · ${line.name} ${line.time} · ${line.hours} hours`}
        actions={<NavLink testId={tid.tsRota.seeShift} to="/work/shifts" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>See the shift</NavLink>}>
        This timesheet entry is linked to that rota shift, so scheduled and actual hours reconcile.
        {recorded > 0 && <> Recorded so far: {Number(recorded.toFixed(2))}h ({varianceText(rec?.minutes ?? 0, line.hours)}h against the rota).</>}</Banner>}
      {day.absence && <Banner testId={tid.ts.banner('absence')} tone="warn" icon={<Lock />}
        title={`${day.absence === 'leave' ? 'Annual leave' : 'Sickness'} is recorded for this day`}>
        Approved absence blocks timesheet capture while “Leave blocks timesheet capture” is on under Qnipay setup · Leave. If you did work,
        mark the day non-working and tick “Called in and worked anyway”.</Banner>}
      {nonwork && <Card>
        <CardHead title="Why this day is non-working" />
        <div className="grid grid-cols-2 gap-x-md max-lg:grid-cols-1">
          <Field label="Reason" required>
            <SelectBox testId={tid.ts.reason} options={NON_WORKING_REASONS.map(r => ({ value: r, label: r }))} value={reason} onValueChange={setReason} />
          </Field>
          <Field label="Notes">
            <TextInput testId={tid.ts.reasonNotes} value={notes} placeholder="Anything your approver should know" onChange={e => setNotes(e.target.value)} />
          </Field>
        </div>
        <CheckRow control={<CheckboxField testId={tid.ts.workedAnyway} checked={worked} onCheckedChange={v => setWorked(v === true)} />}>
          Called in and worked anyway</CheckRow>
        <Small>A reason is enough. No times are needed unless you were called in.
          {c.modules.L && <> A non-working day recorded here does not book leave: use <b>Leave</b> for that, so the balance and the rota both update.</>}</Small>
        <div className="mt-lg flex flex-wrap justify-end gap-sm">
          <Button testId={tid.ts.submitReason} kind="primary" disabled={day.locked} title={lockedTitle} pending={busy} onClick={submitReason}>Submit reason</Button>
        </div>
      </Card>}
      {(!nonwork || worked) && <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-lg max-lg:grid-cols-1">
        <div>
          {clock.card && <ClockCard clock={clock.card} readAt={clock.readAt} />}
          <Card>
            <CardHead title={<>Timesheet entry<Tip testId={tid.ts.entryTip} text={entryTip(week, Boolean(clock.card))} /></>} />
            <DayFields {...fields} readOnly={locked} which={side ? 'open' : 'all'} />
            <DayChecks checked={entry.checked} refusal={entry.refusal} />
            <div className="mt-lg flex flex-wrap items-center justify-end gap-sm">
              {running && <span data-testid={tid.clock.outFirst} className="text-xs text-text-muted">{CLOCK_OUT_FIRST}</span>}
              <Button testId={tid.dayForm.save} kind="ghost" disabled={held} title={heldTitle} pending={busy} onMouseDown={holdFocus} onClick={() => entry.attempt('save', anyway)}>Save draft</Button>
              <Button testId={tid.dayForm.submit} kind="primary" disabled={held} title={heldTitle} pending={busy} onMouseDown={holdFocus} onClick={() => entry.attempt('submit', anyway)}>Submit day</Button>
            </div>
          </Card>
        </div>
        <div className="lg:sticky lg:top-[150px]">
          <DayStatsCard capture={c} stats={stats} scheduled={line?.hours} />
          {side && <Card>
            <CardHead title="Shift details" actions={<span className="text-xs text-text-muted">Add only what applies</span>} />
            <DayFields {...fields} readOnly={locked} which="closed" />
          </Card>}
          {day.state === 'back' && <Banner testId={tid.ts.banner('back')} tone="err" icon={<X />} title="Sent back for correction">
            {rec?.returnReason}<br />Correct the entry and submit again. It will go back to {mgr} as a resubmission.</Banner>}
          {day.state === 'resub' && <Banner testId={tid.ts.banner('resub')} tone="info" icon={<RotateCw />} title="Resubmitted">
            Corrected and sent back to {mgr}. Awaiting a decision.</Banner>}
          {day.locked && <Banner testId={tid.ts.banner('locked')} tone="warn" icon={<Lock />} title="Pay period closed">
            {day.lockNote}. This day can no longer be saved or submitted. Ask {mgr} to raise an amendment.</Banner>}
        </div>
      </div>}
    </>);
}

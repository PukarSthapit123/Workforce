import { useState } from 'react';
import { tid } from '@/testids';
import { Banner, Button, CheckboxField, CheckRow, FormWarn, Modal, Seg, toastInfo, useNarrow } from '@/ui';
import { useSubmitWeek, useTimesheetWeek } from '@/api/timesheets';
import type { DaySaved, TimesheetWeek, WeekDay, WeekSubmitted } from '@/contract/timesheets';
import { formatDmy, isoWeek, periodStart, weekLayoutFor, weekModel } from '@/domain/timesheet';
import { todayIso } from '@/lib/format';
import { envOf, flagOn, hm, typeOf } from './capture';
import { DayFields } from './DayForm';
import { DayChecks, holdFocus, useDayEntry } from './useDayEntry';
import { fillFromRota, gridAs, initialGrid, kindFor, refusedDay, weekBody, type GridState } from './week';
import { WeekGrid } from './WeekGrid';

/* Proxy entry: the prototype's proxyBox, proxy-submit and proxy-week-submit
   (qnipay-workforce-v15.html:10245-10263, 11923-11966). The form and the grid
   are the team member's: their week is read with their employee ID, so the
   capture fields, the checks and the seeded grid are theirs, never the
   manager's (D6, IMP-005c). The server records the manager as enteredBy and
   the day as a proxy entry. Day is today by the server's clock. A week with
   days held back keeps the dialog open and lists each held day with its reason. */
type View = 'day' | 'week';
export interface ProxyTarget { code: string; name: string }
const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

export function ProxyEntry({ person, onClose }: { person: ProxyTarget; onClose: () => void }) {
  const [serverToday, setServerToday] = useState<string | null>(null);
  const [view, setView] = useState<View>('day');
  const [held, setHeld] = useState<WeekSubmitted['held']>([]);
  const q = useTimesheetWeek(person.code, periodStart(serverToday ?? todayIso()));
  /* the server's clock, adopted once, as My timesheet does */
  if (q.data && serverToday === null) setServerToday(q.data.now.date);
  const week = serverToday && q.data?.weekStart === periodStart(serverToday) ? q.data : undefined;
  const day = week?.days.find(d => d.date === serverToday);
  const weekly = week ? flagOn(week.capture, 'WEEKLY') : false;
  const shown: View = weekly ? view : 'day';
  const first = firstName(person.name);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Log time · ${person.name}`} width="wide">
      <Banner testId={tid.proxy.banner} tone="info" title={`Entering on behalf of ${person.name}`}>
        Recorded as a proxy entry against {person.code} and attributed to you. {first} is notified.
        {week && <> The form below is the one their employee type renders: {week.person.typeName}.</>}</Banner>
      {q.isError && <p data-testid={tid.proxy.error} role="alert" className="text-err">{person.name}’s timesheet could not be loaded. Close this and try again.</p>}
      {!q.isError && !week && <p className="text-text-secondary">Loading {first}’s timesheet&hellip;</p>}
      {week && day && <>
        <div className="mb-md flex justify-end">
          <Seg label="Enter a day or the week" value={shown} onChange={setView} testId={v => tid.proxy.view(v)}
            options={weekly ? [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }] : [{ value: 'day', label: 'Day' }]} />
        </div>
        {shown === 'day'
          ? <ProxyDay key={`${day.date}:${day.version}`} week={week} day={day} person={person} onDone={onClose} />
          : <ProxyWeek key={`${week.weekStart}:${week.days.map(d => d.version).join('.')}`} week={week} today={day.date} person={person}
              onDone={res => { if (res.held.length) setHeld(res.held); else onClose(); }} />}
        {shown === 'week' && held.length > 0 && <Banner testId={tid.proxy.held} tone="info" title={`${held.length} day${held.length === 1 ? '' : 's'} held back`}>
          {held.map(h => <span key={h.date} className="block">{h.reason}</span>)}</Banner>}
      </>}
    </Modal>);
}

function ProxyDay({ week, day, person, onDone }: { week: TimesheetWeek; day: WeekDay; person: ProxyTarget; onDone: () => void }) {
  const c = week.capture, first = firstName(person.name);
  const flagged = (r: DaySaved) => (r.warnings.length ? `Flagged: ${r.warnings.join(' ')}` : undefined);
  const entry = useDayEntry({ week, day, personId: person.code,
    onSaved: () => undefined,
    onSubmitted: res => {
      toastInfo(`Submitted for ${person.name} on their behalf · ${formatDmy(day.date)} · ${hm(c, res.record.minutes)} · attributed to you · ${first} notified`, flagged(res));
      onDone();
    } });
  /* a day of leave or sickness takes time only as called in and worked anyway, while leave blocks capture (module 4 D8) */
  const [anyway, setAnyway] = useState(false);
  return <>
    <DayFields {...entry.fields} which="all" single />
    {day.absence && <CheckRow control={<CheckboxField testId={tid.leaveLink.proxyAnyway} checked={anyway} onCheckedChange={v => setAnyway(v === true)} />}>
      {first} was called in and worked anyway on this day of {day.absence === 'leave' ? 'annual leave' : 'sickness'}</CheckRow>}
    <DayChecks checked={entry.checked} refusal={entry.refusal} />
    <Button testId={tid.proxy.submitDay} kind="primary" className="mt-[14px] w-full" disabled={day.locked} title={day.locked ? day.lockNote : undefined}
      pending={entry.busy} onMouseDown={holdFocus} onClick={() => entry.attempt('submit', { workedAnyway: anyway })}>Submit day for approval</Button>
  </>;
}

function ProxyWeek({ week, today, person, onDone }: { week: TimesheetWeek; today: string; person: ProxyTarget; onDone: (res: WeekSubmitted) => void }) {
  const c = week.capture, first = firstName(person.name), narrow = useNarrow();
  const m = weekModel(c.fields, typeOf(c), envOf(c), c.weekGrid);
  const layout = weekLayoutFor(c.weekLayout, narrow);
  /* seeded from the team member's published rota on every day with nothing saved (IMP-005c), never from the manager's */
  const [state, setState] = useState<GridState>(() => fillFromRota(initialGrid(week, m, layout), week, m, i => !week.days[i]?.record).state);
  const current = gridAs(state, kindFor(layout), m);
  const submit = useSubmitWeek();
  const send = () => submit.mutate({ personId: person.code, weekStart: week.weekStart, body: weekBody(week, current, m) }, { onSuccess: res => {
    const n = res.submitted.length;
    toastInfo(`Week ${isoWeek(week.weekStart)} submitted for ${person.name} on their behalf · ${n} day${n === 1 ? '' : 's'} · ${hm(c, res.weekMinutes)}`
      + ` · attributed to you · ${first} notified` + (res.held.length ? ` · ${res.held.length} day${res.held.length === 1 ? '' : 's'} held back` : ''),
    res.flagged.length ? `Flagged: ${res.flagged.join('; ')}` : undefined);
    onDone(res);
  } });
  return <>
    <WeekGrid week={week} model={m} layout={layout} state={current} onChange={setState} today={today} who={first} />
    {submit.refusal && <FormWarn testId={tid.proxy.refusal}>{refusedDay(week, submit.refusal.field)}{submit.refusal.message} <span className="opacity-90">{submit.refusal.next}</span></FormWarn>}
    <Button testId={tid.proxy.submitWeek} kind="primary" className="mt-md w-full" pending={submit.isPending(`${person.code}/week/${week.weekStart}`)}
      onClick={send}>Submit week for approval</Button>
  </>;
}

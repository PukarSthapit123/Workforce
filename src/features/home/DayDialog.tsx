import type { ReactNode } from 'react';
import { tid } from '@/testids';
import { Button, Fact, GroupLabel, Modal, NavLink, Pill, Small, type Tone } from '@/ui';
import { buttonVariants } from '@/ui/shadcn/button';
import type { HomeDay, HomeMonth } from '@/api/home';
import { useMyLeave } from '@/api/leave';
import { useCaps } from '@/shell/useCaps';
import { shortDate } from '@/domain/home';
import { LEAVE_STATE, isLeaveState } from '@/domain/leave';
import { formatDmy } from '@/domain/time';
import { statePill } from '@/features/timesheet/team';
import { RequestDialog } from '@/features/leave/LeaveDialogs';

/* What is on a day: the prototype's empDayBox (qnipay-workforce-v15.html:
   5435-5474). The shift and where it comes from, the bank holiday, what the
   timesheet holds, the leave behind an absence, and a way to the page that
   owns each: My timesheet on that day, My shifts, My leave, and "Book time
   off" with the day already filled in while Leave is on. */
function dayPill(d: HomeDay): { label: string; tone: Tone; glyph: ReactNode } | null {
  if (d.absence?.mark === 'V') return { label: 'Leave', tone: 'neu', glyph: '—' };
  if (d.absence?.mark === 'S') return { label: 'Sickness', tone: 'err', glyph: '✕' };
  if (d.ts) return statePill(d.ts.state);
  if (d.future && d.shift) return { label: 'Scheduled', tone: 'neu', glyph: '—' };
  return null;
}
const SOURCE = { rota: 'From the published rota', leave: 'From your approved leave', none: '' } as const;

export function DayDialog({ m, day: d, onClose, onBook }: { m: HomeMonth; day: HomeDay; onClose: () => void; onBook: (date: string) => void }) {
  const caps = useCaps();
  const pill = dayPill(d);
  const recorded = d.ts?.minutes ?? 0;
  const source = d.absence?.mark === 'S' ? 'From your recorded sickness' : SOURCE[d.source];
  const leaveState = d.absence && isLeaveState(d.absence.state) ? LEAVE_STATE[d.absence.state] : null;
  const canRecord = m.can.recordHours && !d.future && !d.locked;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`${shortDate(d.date)} ${d.date.slice(0, 4)}`}
      footer={<>
        <Button testId={tid.home.dayClose} kind="ghost" onClick={onClose}>Close</Button>
        {m.can.bookLeave && d.absence?.mark !== 'V' && <Button testId={tid.home.bookLeave} kind="secondary" onClick={() => onBook(d.date)}>Book time off</Button>}
        {canRecord && <NavLink testId={tid.home.recordHours} to={`/work/ts?date=${d.date}`} className={buttonVariants({ variant: 'default' })}>
          {recorded ? 'Edit the timesheet' : 'Record hours'}</NavLink>}
      </>}>
      {pill && <div className="mb-md"><Pill testId={tid.home.dayState} tone={pill.tone} glyph={pill.glyph}>{pill.label}</Pill></div>}
      <GroupLabel>Your shift</GroupLabel>
      <Fact label={d.shift ? d.shift.name : d.absence ? d.absence.name : 'Rest day'} testId={tid.home.dayShift}>
        {d.shift ? `${d.shift.time} · ${d.shift.hours}h` : '—'}</Fact>
      {d.shift && <Fact label="Location" testId={tid.home.dayLocation}>{m.person.location}</Fact>}
      {source && <Fact label="Where this comes from" testId={tid.home.daySource}><span className="text-xs font-normal text-text-muted">{source}</span></Fact>}
      {d.bankHoliday && <Fact label="Bank holiday" testId={tid.home.dayBank}>{d.bankHoliday}</Fact>}
      {d.shift && caps.has('own_shifts') && <NavLink testId={tid.home.dayShifts} to="/work/shifts" className={buttonVariants({ variant: 'link', size: null })}>
        See the week on My shifts</NavLink>}

      {(m.can.recordHours || d.ts) && <>
        <GroupLabel className="mt-lg">Your timesheet</GroupLabel>
        <Fact label="Hours recorded" testId={tid.home.dayHours}>{d.ts?.text || 'Nothing yet'}</Fact>
        {d.shift && <Fact label="Against the rota" testId={tid.home.dayAgainst}>{(recorded / 60 - d.shift.hours).toFixed(1)}h</Fact>}
        {d.locked && <Small testId={tid.home.dayLocked} className="mt-sm">Approved and locked. Ask your manager to reopen it.</Small>}
      </>}

      {d.absence?.from && <>
        <GroupLabel className="mt-lg">Leave</GroupLabel>
        <Fact label={d.absence.name} testId={tid.home.dayLeave}>
          {leaveState ? <Pill tone={leaveState.tone} glyph={leaveState.glyph}>{leaveState.label}</Pill> : d.absence.state}</Fact>
        <Fact label="Dates" testId={tid.home.dayLeaveDates}>
          {formatDmy(d.absence.from)}{d.absence.to && d.absence.to !== d.absence.from ? ` – ${formatDmy(d.absence.to)}` : ''}</Fact>
        {m.can.bookLeave && <NavLink testId={tid.home.dayLeaveLink} to="/work/leave" className={buttonVariants({ variant: 'link', size: null })}>
          Open My leave</NavLink>}
      </>}
    </Modal>);
}

/* "Book time off": My leave's own request dialog, the day filled in as its
   first and last day. It reads My leave first, for the types and balance. */
export function BookLeave({ day, onClose }: { day: string; onClose: () => void }) {
  const q = useMyLeave();
  if (q.data) return <RequestDialog m={q.data} day={day} onClose={onClose} />;
  if (q.isError) return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Request leave"
      footer={<Button testId={tid.home.dayClose} kind="ghost" onClick={onClose}>Close</Button>}>
      <p role="alert" className="text-sm text-err">Your leave could not be loaded, so a request cannot be started. Reload the page to try again.</p>
    </Modal>);
  return null;
}

import { useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { tid } from '@/testids';
import { Banner, Button, Field, FormWarn, TextInput, toastInfo } from '@/ui';
import { useClockIn, useClockOut, useCloseClock, useEndBreak, useStartBreak, type ClockMoved, type ClockRecord, type MyClock } from '@/api/clock';
import { CLOCK_STATUS, clockTime, forgottenMessage, formatElapsed, isOpenState, noDaySentence } from '@/domain/clock';

/* Module 2b Clocking: the prototype's clock card (.clockcard, renderClock and
   paintClock, qnipay-workforce-v15.html:1227-1253, 6382-6386, 6890-6918). The
   state, the time worked and every sentence come from the server's record;
   the timer only ticks on locally from the read (no optimistic updates). */
const RING_C = 2 * Math.PI * 34;
type Move = 'in' | 'breakStart' | 'breakEnd' | 'out';

/* The seconds the timer shows: the record's elapsed time at the read, plus
   the seconds since that read while the shift is running. */
export function useClockSeconds(current: ClockRecord | null, readAt: number): number {
  const running = current?.state === 'running';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!current) return 0;
  return current.elapsedSeconds + (running ? Math.max(0, Math.floor((now - readAt) / 1000)) : 0);
}

/* The day's start as the clock has it while a shift runs (lockShiftTimes): the
   first clock in, or once the clock has written the day, the start stored on
   it, which the person may have corrected (review I4). */
export function clockedStart(current: ClockRecord | null | undefined, stored?: string): string | null {
  if (!current || !isOpenState(current.state)) return null;
  if (current.written && stored?.trim()) return stored.trim();
  const first = current.events.find(e => e.kind === 'in');
  return first ? clockTime(first.at) : null;
}

const flagged = (r: ClockMoved) => (r.warnings.length ? `Flagged: ${r.warnings.join(' ')}` : undefined);
/* .btn.lime and .btn.glass: the accent with its dark ink, and the translucent
   white on the inverse surface; on a phone each grows to share the row. */
const LIME = 'bg-brand-accent text-text-on-accent hover:bg-brand-accent active:bg-brand-accent max-md:min-w-0 max-md:flex-[1_1_auto]';
const GLASS = 'border-glass-line bg-glass text-text-on-brand hover:bg-glass-hover max-md:min-w-0 max-md:flex-[1_1_auto]';

export function ClockCard({ clock, readAt }: { clock: MyClock; readAt: number }) {
  const clockIn = useClockIn(), startBreak = useStartBreak(), endBreak = useEndBreak(), clockOut = useClockOut();
  const moves = { in: clockIn, breakStart: startBreak, breakEnd: endBreak, out: clockOut };
  const [last, setLast] = useState<Move | null>(null);
  const busy = Object.values(moves).some(m => m.anyPending);
  const current = clock.current, state = current?.state ?? 'idle';
  const seconds = useClockSeconds(current, readAt);
  const pct = Math.min(seconds / (clock.targetHours * 3600), 1), shown = Math.round(pct * 100);
  const go = (move: Move) => {
    setLast(move);
    moves[move].mutate({ version: clock.version }, { onSuccess: (r: ClockMoved) => toastInfo(r.toast, flagged(r)) });
  };
  const refusal = last ? moves[last].refusal : null;
  const open = state === 'running' || state === 'onBreak';
  return (
    <>
      <section data-testid={tid.clock.card} aria-label="Clock"
        className="mb-md flex flex-wrap items-center gap-lg rounded-card bg-surface-inverse px-xl py-lg text-text-on-inverse max-md:flex-col max-md:items-start max-md:gap-md max-md:p-lg">
        <div data-testid={tid.clock.ring} role="img" aria-label={`${shown}% of the ${clock.targetHours}-hour shift`} className="relative size-[76px] flex-none">
          <svg viewBox="0 0 76 76" aria-hidden="true" className="size-[76px] -rotate-90">
            <circle cx="38" cy="38" r="34" className="fill-none stroke-ring-track stroke-[6]" />
            <circle cx="38" cy="38" r="34" style={{ strokeDasharray: RING_C, strokeDashoffset: RING_C * (1 - pct) }}
              className="fill-none stroke-brand-accent stroke-[6] [stroke-linecap:round] transition-[stroke-dashoffset] duration-(--qp-duration-base) ease-qp" />
          </svg>
          <div data-testid={tid.clock.ringPct} aria-hidden="true" className="absolute inset-0 grid place-items-center text-xs font-bold tabular-nums">{shown}%</div>
        </div>
        <div>
          <div data-testid={tid.clock.timer} role="timer"
            className="font-[family-name:var(--qp-font-display)] text-[length:var(--qp-text-30)] leading-[1.1] font-semibold tabular-nums">{formatElapsed(seconds)}</div>
          <div data-testid={tid.clock.status} role="status" className="mt-[2px] text-xs opacity-80">{CLOCK_STATUS[state]}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-sm max-md:ml-0 max-md:w-full">
          {state === 'running' && clock.gates.breaks &&
            <Button testId={tid.clock.breakStart} kind="ghost" className={GLASS} pending={busy} onClick={() => go('breakStart')}>Start break</Button>}
          {/* Resume stays while on a break even if Break tracking was turned off since, so the break can end */}
          {state === 'onBreak' && <Button testId={tid.clock.resume} kind="ghost" className={GLASS} pending={busy} onClick={() => go('breakEnd')}>Resume</Button>}
          {open && <Button testId={tid.clock.clockOut} kind="primary" className={LIME} pending={busy} onClick={() => go('out')}>Clock out</Button>}
          {state === 'clockedOut' && <Button testId={tid.clock.again} kind="ghost" className={GLASS} pending={busy} onClick={() => go('in')}>Clock in again</Button>}
          {state === 'idle' && <Button testId={tid.clock.clockIn} kind="primary" className={LIME} pending={busy} onClick={() => go('in')}>Clock in</Button>}
        </div>
      </section>
      {refusal && <FormWarn testId={tid.clock.refusal}>{refusal.message} <span className="opacity-90">{refusal.next}</span></FormWarn>}
    </>);
}

/* A clock from an earlier day nobody clocked out of (D6): the finish time
   closes it and saves that day as a draft. When that day can no longer be
   written (`blocked`), closing leaves the day as it is and the manager is
   asked to amend it, and the banner says so (review I2). A refusal about the
   time is shown on the field; any other under it. */
export function ForgottenClock({ open, blocked, manager }: { open: ClockRecord; blocked: MyClock['openBlocked']; manager: string }) {
  const close = useCloseClock();
  const [finish, setFinish] = useState('');
  const submit = () => close.mutate({ date: open.date, version: open.version, finish }, { onSuccess: r => toastInfo(r.toast, flagged(r)) });
  const other = close.refusal && close.refusal.field !== 'finish' ? close.refusal : null;
  return (
    <Banner testId={tid.clock.forgotten} tone="warn" icon={<AlarmClock />} title={forgottenMessage(open.date)}>
      {blocked
        ? <>Enter the time you finished that day to close the clock. {blocked.message} <span data-testid={tid.clock.noDay}>{noDaySentence(manager)}</span></>
        : 'Enter the time you finished that day to close the clock. The day is saved as a draft for you to check and submit.'}
      <div className="mt-sm flex flex-wrap items-end gap-sm">
        <Field label="Finish time" required error={close.fieldError('finish')}>
          <TextInput testId={tid.clock.finish} type="time" step="300" value={finish} onChange={e => setFinish(e.target.value)} />
        </Field>
        <div className="mb-md"><Button testId={tid.clock.close} kind="primary" pending={close.anyPending} onClick={submit}>Close the clock</Button></div>
      </div>
      {other && <FormWarn testId={tid.clock.closeRefusal}>{other.message} <span className="opacity-90">{other.next}</span></FormWarn>}
    </Banner>);
}

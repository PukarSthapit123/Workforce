import { useState, type MouseEvent } from 'react';
import { tid } from '@/testids';
import { FormWarn } from '@/ui';
import { useSaveDay, useSubmitDay } from '@/api/timesheets';
import type { Refusal } from '@/contract/common';
import type { DayInput, DaySaved, TimesheetWeek, WeekDay } from '@/contract/timesheets';
import { taskReset } from '@/domain/timesheet';
import { breakIndex, breaksShown, checkDay, checkField, dayInputFrom, dayStats, rotaShift, serverField, valuesFromDay, type FormValues, type LocalCheck } from './capture';
import type { DayFieldsProps } from './DayForm';

/* One day's entry: the form's values, its inline and on-attempt checks, and
   the save and submit writes, for whoever's day it is. My timesheet passes
   the signed-in person; proxy entry passes the team member, so the form, the
   checks and the write are theirs (D6). The caller says what the toast reads. */
export function useDayEntry({ week, day, personId, onSaved, onSubmitted }: {
  week: TimesheetWeek; day: WeekDay; personId: string;
  onSaved: (res: DaySaved) => void; onSubmitted: (res: DaySaved) => void;
}) {
  const c = week.capture;
  const [values, setValues] = useState<FormValues>(() => valuesFromDay(day, c));
  const [breaks, setBreaks] = useState(() => breaksShown(values));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<LocalCheck | null>(null);
  const save = useSaveDay(), submit = useSubmitDay();
  const busy = save.isPending(`${personId}/${day.date}`) || submit.isPending(`${personId}/${day.date}`);

  /* the field's own error: the inline check first, then whatever the server named */
  const errorFor = (code: string) => errors[code] ?? [save, submit].map(m => m.fieldError(serverField(code))
    ?? (breakIndex(code) === 0 ? m.fieldError('entries.0.breaks') : undefined)).find(Boolean);
  /* validateField on blur: the inline check marks or clears just this field */
  const onBlur = (code: string) => {
    const problem = checkField(code, values, c);
    setErrors(e => (problem ? { ...e, [code]: problem } : Object.fromEntries(Object.entries(e).filter(([k]) => k !== code))));
  };
  /* validateEntry before anything is sent: errors block, warnings travel with the save */
  /* workedAnyway: the day is marked "Called in and worked anyway", so time on a leave or sickness day is accepted (module 4 D8) */
  const attempt = (kind: 'save' | 'submit', extra: Pick<DayInput, 'workedAnyway'> = {}) => {
    const r = checkDay(values, c, day.date, week.now, rotaShift(day));
    setErrors(Object.fromEntries(r.errors.map(e => [e.field, e.message])));
    setChecked(r);
    if (r.errors.length) return;
    const vars = { personId, date: day.date, version: day.version, body: { ...dayInputFrom(values, c), ...(extra.workedAnyway ? { workedAnyway: true } : {}) } };
    if (kind === 'save') save.mutate(vars, { onSuccess: onSaved });
    else submit.mutate(vars, { onSuccess: onSubmitted });
  };
  /* Copy in another day's values (copy yesterday, or yesterday's rota line), widening the break rows to fit. */
  const fill = (from: FormValues) => { setValues(x => ({ ...x, ...from })); setBreaks(b => Math.max(b, breaksShown(from))); };
  const fields: Omit<DayFieldsProps, 'which' | 'single'> = {
    capture: c, values, errorFor, breaks, onBlur, onAddBreak: () => setBreaks(b => b + 1),
    onChange: (code, v) => setValues(x => ({ ...x, [code]: v, ...taskReset(code, x[code], v) })),
  };
  return { fields, stats: dayStats(values, c, day.date), attempt, fill, busy, checked, submit, refusal: submit.refusal ?? save.refusal };
}

/* Save and Submit keep the focus where it is on a mouse press. Leaving a
   field runs its inline check, which can clear the message under it; the form
   then moves up while the button is held, the release lands off the button,
   and the click is lost. The attempt checks every field anyway. */
export const holdFocus = (e: MouseEvent) => e.preventDefault();

/* What the last attempt found: the blocking errors, or the warnings that travel with the save, and any refusal from the server with what to do next. */
export function DayChecks({ checked, refusal }: { checked: LocalCheck | null; refusal: Refusal | null }) {
  return <>
    {checked && checked.errors.length > 0 && <FormWarn testId={tid.dayForm.warn}>
      <strong>Submission blocked</strong>{checked.errors.map(e => <span key={e.field + e.message} className="block">{e.message}</span>)}</FormWarn>}
    {checked && !checked.errors.length && checked.warnings.length > 0 && <p data-testid={tid.dayForm.check} role="status"
      className="mt-[10px] rounded-sm bg-warn-surface px-md py-[9px] text-xs text-warn">
      <strong>Check before submitting</strong>{checked.warnings.map(w => <span key={w} className="block">{w}</span>)}</p>}
    {refusal && <FormWarn testId={tid.dayForm.refusal}>{refusal.message} <span className="opacity-90">{refusal.next}</span></FormWarn>}
  </>;
}

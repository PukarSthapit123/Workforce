import { useState, type ReactNode } from 'react';
import { Check, Clock, Minus, X } from 'lucide-react';
import { tid } from '@/testids';
import { Banner, Button, CalNav, Card, FormWarn, Pill, toastInfo, useNarrow, type Tone } from '@/ui';
import { useSubmitWeek } from '@/api/timesheets';
import type { TimesheetWeek, WeekSubmitted } from '@/contract/timesheets';
import { addDays, formatDay, isoWeek, periodStart, weekLayoutFor, weekModel } from '@/domain/timesheet';
import { envOf, flagOn, hm, rotaShift, typeOf } from './capture';
import { fillFromRota, gridAs, gridTotals, initialGrid, kindFor, refusedDay, weekBody, type GridState } from './week';
import { WeekGrid } from './WeekGrid';
import { MultiWeek } from './MultiWeek';

/* The week view: tsWeekView (qnipay-workforce-v15.html:6337-6366) and the
   submit-week and fill-from-rota actions (11370-11419). The submission is one
   request; what the server held back comes back with its reasons and stays on
   screen under the grid. */
const WEEK_CHIP: Record<string, { label: string; tone: Tone; glyph: ReactNode }> = {
  back: { label: 'Sent back', tone: 'err', glyph: <X /> },
  draft: { label: 'Draft · not submitted', tone: 'neu', glyph: <Minus /> },
  pend: { label: 'Awaiting approval', tone: 'info', glyph: <Clock /> },
  ok: { label: 'Approved', tone: 'ok', glyph: <Check /> },
};
/* What the week as a whole is: anything sent back first, then anything still a draft, then waiting, then approved. */
const DRAFT_CHIP = { label: 'Draft · not submitted', tone: 'neu' as Tone, glyph: <Minus /> };
export function weekChip(week: TimesheetWeek) {
  const states = week.days.filter(d => d.record).map(d => d.state);
  const key = states.includes('back') ? 'back' : !states.length || states.includes('draft') ? 'draft'
    : states.some(s => s === 'pend' || s === 'resub') ? 'pend' : 'ok';
  return WEEK_CHIP[key] ?? DRAFT_CHIP;
}

export function WeekView({ week, today, onAnchor, personId }: {
  week: TimesheetWeek; today: string; onAnchor: (date: string) => void; personId: string;
}) {
  const submit = useSubmitWeek();
  const [result, setResult] = useState<{ weekStart: string; res: WeekSubmitted } | null>(null);
  const c = week.capture, mgr = week.person.manager.trim() || 'your manager';
  const pending = submit.isPending(`${personId}/week/${week.weekStart}`);
  const onSubmit = (state: GridState) => {
    const m = weekModel(c.fields, typeOf(c), envOf(c), c.weekGrid);
    submit.mutate({ personId, weekStart: week.weekStart, body: weekBody(week, state, m) }, { onSuccess: res => {
      const n = res.submitted.length;
      toastInfo(`Week ${isoWeek(week.weekStart)} submitted · ${n} day${n === 1 ? '' : 's'} · ${hm(c, res.weekMinutes)} · routed to ${mgr}`
        + (res.held.length ? ` · ${res.held.length} day${res.held.length === 1 ? '' : 's'} held back` : ''),
      res.flagged.length ? `Flagged: ${res.flagged.join('; ')}` : undefined);
      setResult({ weekStart: week.weekStart, res });
    } });
  };
  const signature = `${week.weekStart}:${week.days.map(d => d.version).join('.')}`;
  const shown = result?.weekStart === week.weekStart ? result.res : null;
  return (
    <>
      <WeekPanel key={signature} week={week} today={today} onAnchor={onAnchor} onSubmit={onSubmit} pending={pending} />
      {submit.refusal && <FormWarn testId={tid.ts.banner('week-refusal')}>{refusedDay(week, submit.refusal.field)}{submit.refusal.message} <span className="opacity-90">{submit.refusal.next}</span></FormWarn>}
      {shown && shown.held.length > 0 && <Banner testId={tid.ts.weekResult} tone="info" title={`${shown.held.length} day${shown.held.length === 1 ? '' : 's'} held back`}>
        {shown.held.map(h => <span key={h.date} className="block">{h.reason}</span>)}</Banner>}
      {flagOn(c, 'MULTIWEEK') && <MultiWeek week={week} personId={personId} />}
    </>);
}

function WeekPanel({ week, today, onAnchor, onSubmit, pending }: {
  week: TimesheetWeek; today: string; onAnchor: (date: string) => void; onSubmit: (s: GridState) => void; pending: boolean;
}) {
  const c = week.capture, narrow = useNarrow();
  const m = weekModel(c.fields, typeOf(c), envOf(c), c.weekGrid);
  const layout = weekLayoutFor(c.weekLayout, narrow);
  const [state, setState] = useState<GridState>(() => initialGrid(week, m, layout));
  const current = gridAs(state, kindFor(layout), m);
  const totals = gridTotals(current, m);
  const chip = weekChip(week);
  const end = addDays(week.weekStart, 6), thisWeek = periodStart(today);
  /* fill-from-rota: the published rota's shifts into the grid, with a true count of the days filled */
  const fill = () => {
    const r = fillFromRota(current, week, m);
    if (!r.days) { toastInfo('Nothing to fill. You have no shifts rota’d this week.'); return; }
    setState(r.state);
    toastInfo(`Filled from your rota · ${r.days} day${r.days > 1 ? 's' : ''} · check and adjust before submitting`);
  };
  const contracted = week.person.contractedHours;
  /* rotadHrs: the hours of the shifts on this week's published rota */
  const rotad = Number(week.days.reduce((n, d) => n + (rotaShift(d)?.hours ?? 0), 0).toFixed(2));
  return (
    <Card>
      <div className="mb-md flex flex-wrap items-center gap-md">
        <CalNav label={`Week ${isoWeek(week.weekStart)} · ${formatDay(week.weekStart).slice(4)} – ${formatDay(end).slice(4)}`} labelTestId={tid.ts.weekLabel}
          prev={{ testId: tid.ts.weekPrev, label: 'Previous week', onClick: () => onAnchor(addDays(week.weekStart, -7)) }}
          next={{ testId: tid.ts.weekNext, label: 'Next week', onClick: () => onAnchor(addDays(week.weekStart, 7)) }}
          back={{ testId: tid.ts.weekToday, label: 'Back to this week', current: 'This week', atCurrent: week.weekStart === thisWeek, onClick: () => onAnchor(today) }} />
        <div className="ml-auto flex flex-wrap items-center gap-sm">
          <Pill testId={tid.ts.weekState} tone={chip.tone} glyph={chip.glyph}>{chip.label}</Pill>
          {c.modules.R && <Button testId={tid.ts.fillRota} kind="ghost" small onClick={fill}>Fill from rota</Button>}
          <Button testId={tid.ts.submitWeek} kind="primary" small pending={pending} onClick={() => onSubmit(current)}>Submit week</Button>
        </div>
      </div>
      <WeekGrid week={week} model={m} layout={layout} state={current} onChange={setState} today={today} />
      <div className="mt-md flex flex-wrap items-center gap-md text-xs text-text-muted">
        <span>Total <b data-testid={tid.ts.weekTotal} className="text-text-primary tabular-nums">{hm(c, totals.weekMin)}</b> · {chip.label.toLowerCase()}</span>
        {c.modules.R
          ? <span data-testid={tid.ts.contracted} className="ml-auto">Rota’d <b className="tabular-nums">{rotad}h</b>{contracted > 0 && <> of {contracted}h contracted</>}</span>
          : contracted > 0 && <span data-testid={tid.ts.contracted} className="ml-auto"><b className="tabular-nums">{contracted}h</b> contracted</span>}
      </div>
    </Card>);
}

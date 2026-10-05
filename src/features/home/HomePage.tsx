import { useState, type ReactNode } from 'react';
import { Sun, TriangleAlert } from 'lucide-react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { Banner, Card, CalNav, NavLink, Page, PageHead, Stat, Stats } from '@/ui';
import { buttonVariants } from '@/ui/shadcn/button';
import { ApiError } from '@/api/client';
import { useHome, type HomeDay, type HomeMonth } from '@/api/home';
import { useMyLeave } from '@/api/leave';
import { useTenant } from '@/shell/shellData';
import { DOW_SHORT, MONTH_SHORT, formatDmy, parseIso } from '@/domain/time';
import { GLYPHS, missingTitle, shiftMonth, shortDate } from '@/domain/home';
import { NoticesHomeCard } from '@/features/notices/NoticesHomeCard';
import { BookLeave, DayDialog } from './DayDialog';

/* My home: the prototype's essHome (qnipay-workforce-v15.html:5316-5416).
   The month is the page: what you are doing, what you recorded, and whether
   you can book time off are all reached by opening the day they belong to.
   The server paints every day (GET /api/v1/home); this draws it. A month
   outside the window (the month before this one to the rota horizon) is not
   offered: the arrows stop there. */
export function HomePage() {
  /* '' is the server's current month */
  const [month, setMonth] = useState('');
  const q = useHome(month);
  const m = q.data;
  const refused = q.error instanceof ApiError ? q.error.refusal : null;
  return (
    <Page testId={tid.page('home')}>
      <PageHead title={m ? m.greeting : 'My home'} crumb={m ? `My work · Home · ${m.who}` : 'My work · Home'} />
      {q.isError && !m && <p data-testid={tid.home.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Your month could not be loaded. Reload the page to try again.'}</p>}
      {!m && !q.isError && <p data-testid={tid.home.loading} className="text-text-secondary">Loading your month&hellip;</p>}
      {m && <Home m={m} onMonth={setMonth} />}
    </Page>);
}

function Home({ m, onMonth }: { m: HomeMonth; onMonth: (month: string) => void }) {
  const [open, setOpen] = useState<HomeDay | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  return (
    <>
      {m.can.recordHours && m.missing.length > 0 && <Banner testId={tid.home.missing} tone="warn" title={missingTitle(m.missing)}>
        Open the day below to add them. You can still submit, but those days will be treated as unpaid.</Banner>}
      {m.sentBack && <Banner testId={tid.home.sentBack} tone="err" title={`A timesheet was sent back · ${formatDmy(m.sentBack.date)}`}
        actions={m.can.recordHours && <NavLink testId={tid.home.fixIt} to={`/work/ts?date=${m.sentBack.date}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Fix it</NavLink>}>
        {m.sentBack.reason}</Banner>}
      <NoticesHomeCard />
      <Figures m={m} />
      <Card>
        {/* .cardhead: the month with its arrows, and what the month holds on the right */}
        <div className="mb-md flex flex-wrap items-center gap-sm">
          <CalNav label={m.label} labelTestId={tid.home.month}
            prev={{ testId: tid.home.prev, label: 'Previous month', disabled: m.month <= m.bounds.min, onClick: () => onMonth(shiftMonth(m.month, -1)) }}
            next={{ testId: tid.home.nextMonth, label: 'Next month', disabled: m.month >= m.bounds.max, onClick: () => onMonth(shiftMonth(m.month, 1)) }}
            back={{ testId: tid.home.thisMonth, label: 'This month', current: 'This month', atCurrent: m.month === m.thisMonth, onClick: () => onMonth(m.thisMonth) }} />
          {m.summary && <span data-testid={tid.home.summary} className="ml-auto text-xs text-text-muted">{m.summary}</span>}
        </div>
        {/* .calm: seven columns, Monday first; the day heads are column heads in
            capitals as the prototype's (data-caps: capitals on purpose) */}
        <div data-testid={tid.home.grid} className="grid grid-cols-7 gap-xs">
          {DOW_SHORT.map(d => <div key={d} aria-hidden="true" data-caps className="pb-xs text-center text-xs font-bold tracking-[.04em] text-text-muted uppercase">{d}</div>)}
          {Array.from({ length: m.leadingBlanks }, (_, i) => <div key={`blank-${i}`} aria-hidden="true" />)}
          {m.days.map(d => <DayCell key={d.date} d={d} onOpen={() => setOpen(d)} />)}
        </div>
        <MonthKeyLine m={m} />
      </Card>
      {open && <DayDialog m={m} day={open} onClose={() => setOpen(null)} onBook={date => { setOpen(null); setBooking(date); }} />}
      {booking && <BookLeave day={booking} onClose={() => setBooking(null)} />}
    </>);
}

/* The figures above the month (.stats): the next shift while Rota is on, today's
   timesheet and this week's hours while the timesheet is, the leave balance
   while Leave is. */
function Figures({ m }: { m: HomeMonth }) {
  const rota = useTenant().data?.modules.R === true;
  const t = m.todayDay, w = m.week;
  const hours = Math.round(w.minutes / 6) / 10;
  if (!rota && !m.can.recordHours && !m.can.bookLeave) return null;
  return (
    <Stats>
      {rota && <Stat label="Next shift" testId={tid.home.next}
        foot={m.nextShift ? `${m.nextShift.name} · ${m.nextShift.time}` : 'No further shifts this week'}>
        <span className="text-lg">{m.nextShift ? shortDate(m.nextShift.date) : 'None booked'}</span>
      </Stat>}
      {m.can.recordHours && <Stat label="Today’s timesheet" testId={tid.home.today}
        foot={t.absence ? t.absence.name : t.shift ? `${t.shift.name} scheduled` : 'No shift scheduled'}>
        <span className="text-lg">{t.ts?.text || (t.shift ? 'Not started' : '—')}</span>
      </Stat>}
      {m.can.recordHours && <Stat label="Hours this week" testId={tid.home.week}
        foot={w.contracted > 0 ? `of ${w.contracted}h contracted${rota ? ` · ${w.rotaHours}h rota’d` : ''}` : 'bank · no contracted baseline'}>{hours}h</Stat>}
      {m.can.bookLeave && <LeaveBalance />}
    </Stats>);
}
function LeaveBalance() {
  const q = useMyLeave();
  const b = q.data?.balance;
  return (
    <Stat label="Leave balance" testId={tid.home.balance}
      foot={q.data && b ? `${b.takenD} taken${b.pending ? ` · ${b.pending} pending` : ''} of ${q.data.entitlement.days} days` : q.isError ? 'Your balance could not be loaded.' : undefined}>
      {b ? (b.unit === 'hours' ? `${b.leftH}h` : `${b.leftD}d`) : '—'}
    </Stat>);
}

/* ----------------------------------------------------------------- a day */
/* .calc and .calc.sh-* (v15:1312-1343, 1357-1358): the shift paints the cell
   in the rota's own tones, leave and sickness take a heavier bar, today is
   ringed in the brand, a day still to come is dimmed. The prototype dims the whole cell to .74
   and the recorded time to .75, which takes the shift, leave and muted inks
   below AA; here a day to come has its number in the muted ink and the
   recorded time is in the secondary ink, both at full strength. The state is
   one glyph. */
const PAINT = {
  E: 'bg-(--qp-rota-early-surface) border-l-(color:--qp-rota-early-ink)',
  L: 'bg-(--qp-rota-late-surface) border-l-(color:--qp-rota-late-ink)',
  N: 'bg-(--qp-rota-night-surface) border-l-(color:--qp-rota-night-ink)',
  V: 'border-l-4 bg-(--qp-rota-leave-surface) border-l-(color:--qp-rota-leave-ink)',
  S: 'border-l-4 bg-(--qp-rota-sick-surface) border-l-(color:--qp-rota-sick-ink)',
} as const;
const INK = {
  E: 'text-(--qp-rota-early-ink)', L: 'text-(--qp-rota-late-ink)', N: 'text-(--qp-rota-night-ink)',
  V: 'text-(--qp-rota-leave-ink)', S: 'text-(--qp-rota-sick-ink)',
} as const;
/* .cst.ok/.pend/.draft/.att/.mut (v15:1336-1340), and the key's .cst-i (1350-1355): one set, so a glyph cannot drift from its key */
const GLYPH_INK = { ok: 'text-ok', pend: 'text-info', draft: 'text-warn', att: 'text-err', mut: 'text-text-muted' } as const;
/* Two of the prototype's characters (the sun on a day of leave, the warning
   on a day with nothing recorded) are emoji code points that render in
   colour; they come from the shared icon set instead, at the text's size. */
const AS_ICON: Record<string, ReactNode> = { '☀': <Sun />, '⚠': <TriangleAlert /> };
const glyphOf = (c: string): ReactNode => AS_ICON[c] ?? c;
const ICON_FIT = 'inline-flex items-center [&_svg]:size-[1em]';

/* What a cell says to a screen reader: "13 Aug: Night 22:00–07:00, Approved, 7h 30m recorded". */
function cellLabel(d: HomeDay): string {
  const dt = parseIso(d.date);
  const word = d.absence ? d.absence.name : d.shift ? `${d.shift.name} ${d.shift.time}` : 'Rest day';
  return [`${dt.getUTCDate()} ${MONTH_SHORT[dt.getUTCMonth()] ?? ''}: ${word}`, d.bankHoliday, d.glyph ? GLYPHS[d.glyph].label : '',
    d.ts?.text ? `${d.ts.text} recorded` : ''].filter(Boolean).join(', ');
}

function DayCell({ d, onOpen }: { d: HomeDay; onOpen: () => void }) {
  const paint = d.absence?.mark ?? d.shift?.tone ?? null;
  const g = d.glyph ? GLYPHS[d.glyph] : null;
  return (
    <button type="button" data-testid={tid.home.day(d.date)} data-paint={paint ?? undefined} data-glyph={d.glyph ?? undefined}
      data-future={d.future || undefined} aria-label={cellLabel(d)} title={g?.label} onClick={onOpen}
      className={cn('flex min-h-14 cursor-pointer flex-col items-stretch gap-[2px] rounded-sm border border-l-3 border-l-transparent bg-surface-card px-[6px] py-[5px] text-left text-xs',
        'hover:border-y-brand hover:border-r-brand dark:hover:border-y-brand-accent dark:hover:border-r-brand-accent',
        paint && PAINT[paint], d.today && 'border-2 border-brand dark:border-brand-accent')}>
      <span className={cn('text-xs font-bold', d.future && 'text-text-muted')}>{parseIso(d.date).getUTCDate()}</span>
      {d.absence
        ? <span className={cn('flex items-center gap-[6px] text-xs leading-[1.25] font-semibold', INK[d.absence.mark])}>
            <span aria-hidden="true" className={cn('text-base leading-none', ICON_FIT)}>{glyphOf(d.absence.icon)}</span>{d.absence.short || d.absence.name}</span>
        : d.shift
          ? <span className={cn('text-xs leading-[1.25] font-semibold', INK[d.shift.tone])}>
              <span className="font-[family-name:var(--qp-font-display)] font-bold">{d.shift.code}</span> {d.shift.time}</span>
          : d.bankHoliday && <span className="text-xs leading-[1.25] text-text-muted">Bank holiday</span>}
      {(g || d.ts?.text) && <span className={cn('mt-auto flex items-center gap-xs text-xs font-bold', GLYPH_INK[g?.tone ?? 'mut'])}>
        {g && <span aria-hidden="true" className={ICON_FIT}>{glyphOf(g.glyph)}</span>}
        {d.ts?.text && <span className="font-semibold tabular-nums text-text-secondary">{d.ts.text}</span>}</span>}
    </button>);
}

/* calKey (v15:6244-6256) and .callegend (1344-1371): only what this month
   holds, each with its count, in the calendar's own colours. */
const SWATCH = {
  E: 'bg-(--qp-rota-early-surface) border-l-(color:--qp-rota-early-ink)',
  L: 'bg-(--qp-rota-late-surface) border-l-(color:--qp-rota-late-ink)',
  N: 'bg-(--qp-rota-night-surface) border-l-(color:--qp-rota-night-ink)',
} as const;
function MonthKeyLine({ m }: { m: HomeMonth }) {
  const k = m.key;
  const n = (c: number) => <b className="font-[650] text-text-primary">{c}</b>;
  const item = 'flex items-center gap-[5px]';
  return (
    <div data-testid={tid.home.key} className="mt-md flex flex-wrap gap-md text-xs text-text-muted">
      {!k.tones.length && !k.leave.length && !k.states.length && <span data-testid={tid.home.keyEmpty} className={item}>Nothing recorded this month yet</span>}
      {k.tones.map(t => <span key={t.tone} data-testid={tid.home.keyItem('tone', t.tone)} className={item}>
        <i aria-hidden="true" className={cn('h-[11px] w-[14px] rounded-[3px] border-l-3', SWATCH[t.tone])} />{t.label} {n(t.count)}</span>)}
      {k.leave.map((l, i) => <span key={l.name} data-testid={tid.home.keyItem('leave', i)} className={item}>
        <b aria-hidden="true" className={cn('text-base leading-none', ICON_FIT)}>{glyphOf(l.icon)}</b> {l.name} {n(l.count)}</span>)}
      {k.states.map(s => <span key={s.key} data-testid={tid.home.keyItem('state', s.key)} className={item}>
        <b aria-hidden="true" className={cn('font-bold', ICON_FIT, GLYPH_INK[s.tone])}>{glyphOf(s.glyph)}</b> {s.label} {n(s.count)}</span>)}
    </div>);
}

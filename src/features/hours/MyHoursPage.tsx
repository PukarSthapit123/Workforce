import { TriangleAlert } from 'lucide-react';
import { tid } from '@/testids';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { Card, CardHead, CardNote, Page, PageHead, Pill, Row, Stat, Stats } from '@/ui';
import { cn } from '@/lib/utils';
import { useMyHours, type MyHours } from '@/api/hours';
import type { HoursDay } from '@/contract/hours';
import { checkCount, checksTone, flagWarns, footHours, hasError, hoursText, isBank, varianceTone, cellHours } from '@/domain/hours';
import { VARIANCE_CLASS } from './variance';
import { tsLabel, tsStateInfo } from '@/domain/timesheet';
import { weekdayShort } from '@/domain/time';

/* My hours: the prototype's essHours (qnipay-workforce-v15.html:5702-5738).
   Contracted, rota'd and worked for the reader's own week, the flags those
   raise, and the week day by day: the published rota line against the hours
   on the timesheet. Read only. On a phone the day-by-day table becomes a
   card per day (MOBILE-FOUNDATION#30). */
export function MyHoursPage() {
  const q = useMyHours();
  return (
    <Page testId={tid.page('hours')}>
      <PageHead title="Hours" crumb="My work · Hours" tipTestId={tid.hours.tip}
        tip="Contracted, scheduled and actually worked. These are the same figures your manager sees." />
      {q.isError && <p data-testid={tid.hours.error} role="alert" className="text-err">Your hours could not be loaded. Reload the page to try again.</p>}
      {!q.data && !q.isError && <p data-testid={tid.hours.loading} className="text-text-secondary">Loading your hours&hellip;</p>}
      {q.data && <HoursView h={q.data} />}
    </Page>);
}

function HoursView({ h }: { h: MyHours }) {
  const p = h.position, bank = isBank(h.person.contractedHours);
  return (
    <>
      <Stats>
        <Stat label="Contracted" testId={tid.hours.contracted} foot={bank ? 'no contracted baseline' : 'per week · from your contract'}>
          {bank ? 'Bank' : hoursText(p.con)}</Stat>
        <Stat label="Rota’d" testId={tid.hours.rotad}
          foot={!h.rota ? 'the rota is not in use' : bank ? 'scheduled this week' : `${footHours(p.rotaVar)} against contract`}>
          {h.rota ? hoursText(p.rot) : '—'}</Stat>
        <Stat label="Worked" testId={tid.hours.worked} foot={h.rota ? `${footHours(p.schedVar)} against the rota` : 'this week'}>{hoursText(p.wk)}</Stat>
        <Stat label="Things to check" testId={tid.hours.checks} tone={checksTone(checkCount(p.flags), hasError(p.flags))}>{checkCount(p.flags)}</Stat>
      </Stats>
      {p.flags.length > 0 && (
        <Card testId={tid.hours.flags}>
          <CardHead title="Flags on your week" />
          <div className="flex flex-wrap gap-sm">
            {p.flags.map((f, i) => <Pill key={f.k} testId={tid.hours.flag(i)} tone={f.c} glyph={flagWarns(f) ? <TriangleAlert /> : undefined}>{f.k}</Pill>)}
          </div>
          <CardNote>Warnings are advisory. Where a rule is hard (clearance, maximum hours, minimum rest) it also stops you being offered work you should not take.</CardNote>
        </Card>)}
      <Card>
        <CardHead title="Day by day" actions={<span className="text-xs text-text-muted">Rota’d against worked</span>} />
        <Table variant="records" data-testid={tid.hours.days}>
          <TableHeader><TableRow>
            <TableHead>Day</TableHead><TableHead>Rota line</TableHead><TableHead className="text-right">Scheduled</TableHead>
            <TableHead className="text-right">Worked</TableHead><TableHead className="text-right">Variance</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>{h.days.map(d => <DayRow key={d.date} d={d} rota={h.rota} />)}</TableBody>
          <TableFooter><TableRow data-testid={tid.hours.total}>
            <TableCell colSpan={2}><strong>Week</strong></TableCell>
            <TableCell className="text-right tabular-nums"><strong>{h.rota ? hoursText(p.rot) : '—'}</strong></TableCell>
            <TableCell className="text-right tabular-nums"><strong>{hoursText(p.wk)}</strong></TableCell>
            <TableCell className="text-right tabular-nums"><strong>{h.rota ? footHours(p.schedVar) : '—'}</strong></TableCell>
            <TableCell />
          </TableRow></TableFooter>
        </Table>
      </Card>
    </>);
}

function DayRow({ d, rota }: { d: HoursDay; rota: boolean }) {
  const line = d.line || (d.status.kind === 'leave' ? 'Annual leave' : d.status.kind === 'sickness' ? 'Sickness' : '');
  return (
    <Row testId={tid.hours.day(d.date)}>
      <TableCell kind="title"><strong className="font-semibold">{weekdayShort(d.date)} {Number(d.date.slice(8))}</strong></TableCell>
      <TableCell label="Rota line">{line || <span className="text-xs text-text-muted">—</span>}</TableCell>
      <TableCell label="Scheduled" className="text-right tabular-nums">{rota && d.scheduled ? hoursText(d.scheduled) : '—'}</TableCell>
      <TableCell label="Worked" className="text-right tabular-nums">{d.worked ? hoursText(d.worked) : '—'}</TableCell>
      <TableCell label="Variance" data-testid={tid.hours.variance(d.date)}
        className={cn('text-right tabular-nums', d.variance !== null && d.variance !== 0 && VARIANCE_CLASS[varianceTone(d.variance)])}>
        {d.variance === null ? '—' : cellHours(d.variance)}</TableCell>
      <TableCell label="Status"><span data-testid={tid.hours.status(d.date)}><DayStatusPill d={d} /></span></TableCell>
    </Row>);
}

/* The status column (v15:5726-5727, tsPill 5739-5743). */
function DayStatusPill({ d }: { d: HoursDay }) {
  const s = d.status;
  if (s.kind === 'leave') return <Pill tone="neu" glyph="—">Leave</Pill>;
  if (s.kind === 'sickness') return <Pill tone="err" glyph="✕">Sickness</Pill>;
  if (s.kind === 'recorded' && s.state) {
    const info = tsStateInfo(s.state);
    return <Pill tone={info.tone} glyph={info.glyph}>{tsLabel(s.state, s.waitingOn)}</Pill>;
  }
  if (s.kind === 'missing') return <Pill tone="warn" glyph={<TriangleAlert />}>Nothing recorded</Pill>;
  if (s.kind === 'upcoming') return <span className="text-xs text-text-muted">Still to come</span>;
  return <span className="text-xs text-text-muted">Rest day</span>;
}

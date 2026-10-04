import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { tid } from '@/testids';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  Avatar, Banner, Button, Card, CardHead, ChipButton, Count, Empty, Field, FilterBar, FormWarn, Meter, Page, PageHead, Pill, Row, SearchFilter, SelectBox,
  Small, TextInput, Tip, toastInfo,
} from '@/ui';
import { useArrangeRtw, useRecordSickness, useSicknessBoard, type SicknessBoard, type SicknessRow } from '@/api/leave';
import { SICK_ON_LEAVE_TIP, leaveWritesRota } from '@/domain/leave';
import { formatDay, formatDmy } from '@/domain/time';
import { useTenant } from '@/shell/shellData';
import { GiveBackDialog } from './TeamLeaveDialogs';

/* Sickness: the prototype's mgrSick (qnipay-workforce-v15.html:7914-7953).
   The first colleague over the absence trigger with Arrange it, then each
   colleague's absences as episodes and their Bradford score over 52 weeks
   (D9), recording an absence (a day next to an episode joins it rather than
   starting a new spell), and sickness during booked leave with Give days
   back (D10). No guide is registered for this page, as in the prototype. */
export function SicknessPage() {
  const board = useSicknessBoard();
  const b = board.data;
  return (
    <Page testId={tid.page('tsick')}>
      <PageHead title="Sickness" crumb="My team · Sickness" />
      {board.isError && <p data-testid={tid.tsick.error} role="alert" className="text-err">Sickness could not be loaded. Reload the page to try again.</p>}
      {!b && !board.isError && <p data-testid={tid.tsick.loading} className="text-text-secondary">Loading sickness&hellip;</p>}
      {b && <SicknessView b={b} />}
    </Page>);
}

function SicknessView({ b }: { b: SicknessBoard }) {
  const [q, setQ] = useState('');
  const [triggers, setTriggers] = useState(false);
  const [giving, setGiving] = useState(false);
  const arrange = useArrangeRtw();
  const s = q.trim().toLowerCase();
  const rows = b.rows.filter(r => (!s || r.name.toLowerCase().includes(s) || r.personCode.toLowerCase().includes(s)) && (!triggers || r.triggered));
  const ep = b.banner?.episode;
  return (
    <>
      {b.banner && ep && <Banner testId={tid.tsick.banner} tone="err" title={b.banner.text}
        actions={ep.rtw
          ? <Pill testId={tid.tsick.arranged} tone="ok" glyph="✓">Return-to-work meeting requested</Pill>
          : <Button testId={tid.tsick.arrange} kind="ghost" small pending={arrange.isPending(`leave/sickness/${ep.id}`)}
              onClick={() => arrange.mutate(ep, { onSuccess: x => toastInfo(x.summary) })}>Arrange it</Button>}>
        {b.banner.note}</Banner>}
      <FilterBar>
        <SearchFilter testId={tid.tsick.search} label="Search colleague" placeholder="Search colleague" value={q} onChange={e => setQ(e.target.value)} />
        <ChipButton testId={tid.tsick.triggers} on={triggers} onClick={() => setTriggers(t => !t)}>Triggers only</ChipButton>
        <Count testId={tid.tsick.count}>{b.counts.triggered} trigger{b.counts.triggered === 1 ? '' : 's'} reached · {b.counts.colleagues} colleague{b.counts.colleagues === 1 ? '' : 's'} with recorded absence</Count>
      </FilterBar>
      <Table variant="records" data-testid={tid.tsick.table}>
        <TableHeader><TableRow>
          <TableHead>Colleague</TableHead><TableHead>Latest absence</TableHead><TableHead className="text-right">Spells</TableHead>
          <TableHead className="text-right">Days</TableHead>
          <TableHead><span className="inline-flex items-center">Bradford score<Tip testId={tid.tsick.scoreTip} text={b.tip} /></span></TableHead>
          <TableHead>Next step</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {!rows.length && <Row testId={tid.tsick.empty}><TableCell colSpan={6}><Empty>{s || triggers ? 'Nothing matches that filter' : 'No absence recorded'}</Empty></TableCell></Row>}
          {rows.map(r => <EpisodeRow key={r.personCode} r={r} />)}
        </TableBody>
      </Table>
      <RecordAbsence b={b} />
      <Card testId={tid.tsick.onLeave}>
        <CardHead title={<span className="flex items-center">Sick during booked leave<Tip testId={tid.tsick.onLeaveTip} text={SICK_ON_LEAVE_TIP} /></span>}
          actions={<Button testId={tid.tsick.giveBack} kind="ghost" small disabled={!b.sickOnLeave.length} onClick={() => setGiving(true)}>Give days back</Button>} />
        {b.sickOnLeave.length
          ? b.sickOnLeave.map(d => <Small key={`${d.personCode}-${d.date}`} testId={tid.tsick.onLeaveDay(d.personCode, d.date)}>
              {d.name} · {formatDay(d.date)} · {d.days === 1 ? '1 day' : `${d.days} days`} of annual leave</Small>)
          : <Small>No recorded sickness falls on booked annual leave.</Small>}
      </Card>
      {giving && <GiveBackDialog days={b.sickOnLeave} onClose={() => setGiving(false)} />}
    </>);
}

/* One colleague's row (v15:7932-7939): the score in red over the trigger,
   the bar red over it, amber over 50, green otherwise. */
function EpisodeRow({ r }: { r: SicknessRow }) {
  const tone = r.triggered ? 'err' : r.score > 50 ? 'warn' : 'ok';
  return (
    <Row testId={tid.tsick.row(r.personCode)}>
      <TableCell kind="title">
        <span className="flex items-center gap-[9px]">
          <Avatar name={r.name} />
          <span><strong className="font-semibold">{r.name}</strong><span className="block font-mono text-xs text-text-muted">{r.personCode}</span></span>
        </span>
      </TableCell>
      <TableCell label="Latest absence">{r.latest}</TableCell>
      <TableCell label="Spells" className="text-right tabular-nums">{r.spells}</TableCell>
      <TableCell label="Days" className="text-right tabular-nums">{r.days}</TableCell>
      <TableCell label="Bradford score"><Meter testId={tid.tsick.score(r.personCode)} pct={r.score} tone={tone} strong={r.triggered}>{r.score}</Meter></TableCell>
      <TableCell label="Next step">
        <span data-testid={tid.tsick.next(r.personCode)}>{r.triggered ? <Pill tone="err" glyph={<TriangleAlert aria-hidden="true" />}>{r.next}</Pill> : <span className="text-xs text-text-muted">{r.next}</span>}</span>
      </TableCell>
    </Row>);
}

/* Record an absence (v15:7941-7951). The prototype picked one day of the
   current rota week; here it is a first and a last day (blank while the
   colleague is still off). The server works out whether it joins an episode. */
function RecordAbsence({ b }: { b: SicknessBoard }) {
  const record = useRecordSickness();
  const tenant = useTenant().data;
  const rota = tenant ? leaveWritesRota(tenant.modules, tenant.flags) : false;
  const [who, setWho] = useState(b.colleagues[0]?.code ?? '');
  const [from, setFrom] = useState(b.today);
  const [to, setTo] = useState(b.today);
  const [reason, setReason] = useState(b.reasons[0] ?? '');
  const edited = () => record.clearFieldErrors();
  const general = record.refusal && !['from', 'to', 'reason'].includes(record.refusal.field ?? '') ? record.refusal : null;
  const send = () => record.mutate({ personCode: who, from, to, reason }, { onSuccess: x => {
    toastInfo(x.summary, x.extended
      ? `Joined to the absence that began ${formatDmy(x.record.from)}, so it counts as one spell.` : undefined);
  } });
  return (
    <Card testId={tid.tsick.record}>
      <CardHead title="Record an absence" />
      <div className="grid grid-cols-4 gap-md max-lg:grid-cols-2 max-md:grid-cols-1">
        <Field label="Colleague">
          <SelectBox testId={tid.tsick.who} value={who} options={b.colleagues.map(c => ({ value: c.code, label: c.name }))}
            onValueChange={v => { setWho(v); edited(); }} />
        </Field>
        <Field label="First day off" error={record.fieldError('from')}>
          <TextInput testId={tid.tsick.from} type="date" value={from} onChange={e => {
            const v = e.target.value;
            setFrom(v);
            if (to && to < v) setTo(v);
            edited();
          }} />
        </Field>
        <Field label="Last day off" hint="Leave blank while they are still off." error={record.fieldError('to')}>
          <TextInput testId={tid.tsick.to} type="date" value={to} onChange={e => { setTo(e.target.value); edited(); }} />
        </Field>
        <Field label="Reason given" error={record.fieldError('reason')}>
          <SelectBox testId={tid.tsick.reason} value={reason} options={b.reasons.map(r => ({ value: r, label: r }))}
            onValueChange={v => { setReason(v); edited(); }} />
        </Field>
      </div>
      {general && <FormWarn testId={tid.tsick.warn}>{general.message} <span className="opacity-90">{general.next}</span></FormWarn>}
      <Button testId={tid.tsick.save} kind="primary" className="mt-md" disabled={!who} pending={record.anyPending} onClick={send}>Record sickness</Button>
      <Small className="mt-sm">{rota
        ? 'Recording sickness marks the colleague unavailable on the rota, recalculates coverage, and opens a cover request if the day falls below the minimum.'
        : 'Recording sickness shows the absence on the colleague’s timesheet. This organisation does not put leave on a rota.'}</Small>
    </Card>);
}

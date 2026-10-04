import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { tid } from '@/testids';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  Banner, Button, Card, ChipButton, Count, Empty, FilterBar, FormWarn, GroupLabel, NavLink, Page, PageHead, PersonName, Pill, Row, SearchFilter,
  SectionHead, SelectFilter, Small, Tip, toastInfo,
} from '@/ui';
import { buttonVariants } from '@/ui/shadcn/button';
import { useApproveLeave, useLeavers, useTeamBalances, useTeamLeave, type LeaverRow, type TeamBalanceRow, type TeamRequestView } from '@/api/leave';
import { formatDmy } from '@/domain/time';
import { latest } from '@/lib/latest';
import { cn } from '@/lib/utils';
import { useCaps } from '@/shell/useCaps';
import { useTenant } from '@/shell/shellData';
import { DeclineDialog, PersonEntitlement } from './TeamLeaveDialogs';

/* Team leave: the prototype's mgrLeave (qnipay-workforce-v15.html:7838-7912).
   The requests waiting on this manager at the locations they decide for (the
   server leaves out their own, D5), each with the colleague's balance and how
   it was worked out, the effect on cover, the workflow stage and the SLA, and
   Approve or Decline with a reason (D4). Then the team's balances, and the
   leaver reconciliation in days and hours when LV_LEAVER is on (D13). The
   delegation card ("While you are away") belongs to approvals (1c). */
const ALL = 'all';

export function TeamLeavePage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState(ALL);
  const [short, setShort] = useState(false);
  const list = useTeamLeave({ q, type: type === ALL ? undefined : type, short });
  const flags = useTenant().data?.flags ?? {};
  const [declining, setDeclining] = useState<TeamRequestView | null>(null);
  const [entFor, setEntFor] = useState<string | null>(null);
  const d = list.data;
  const filtered = !!q.trim() || short || type !== ALL;
  const dec = declining && latest(declining, d?.requests);
  return (
    <Page testId={tid.page('tleave')}>
      <PageHead title="Team leave" crumb="My team · Team leave" tipTestId={tid.tleave.tip}
        tip="Entitlement is calculated from the shared workforce record. Approving a request that drops cover below the minimum opens a cover request." />
      {list.isError && <p data-testid={tid.tleave.error} role="alert" className="text-err">Team leave could not be loaded. Reload the page to try again.</p>}
      {!d && !list.isError && <p data-testid={tid.tleave.loading} className="text-text-secondary">Loading team leave&hellip;</p>}
      {d && <>
        {d.breached && <Banner testId={tid.tleave.breached} tone="err" title={d.breached}>
          Escalated to the {d.escalateTo} under the configured leave workflow. The escalation is recorded and reportable.</Banner>}
        <FilterBar>
          <SearchFilter testId={tid.tleave.search} label="Search colleague" placeholder="Search colleague" value={q} onChange={e => setQ(e.target.value)} />
          <SelectFilter testId={tid.tleave.type} label="Type of leave" value={type} onValueChange={setType}
            options={[{ value: ALL, label: 'All types' }, ...d.types.map(t => ({ value: t.code, label: t.name }))]} />
          <ChipButton testId={tid.tleave.short} on={short} onClick={() => setShort(s => !s)}>Affects cover</ChipButton>
          <Count testId={tid.tleave.count}>{d.counts.pending} waiting on you{d.counts.escalated ? ` · ${d.counts.escalated} escalated` : ''}</Count>
        </FilterBar>
        {d.requests.length
          ? d.requests.map(r => <RequestCard key={`${r.id}:${r.version}`} r={r} slaDays={d.slaDays} escalateTo={d.escalateTo}
              onDecline={() => setDeclining(r)} onEntitlement={() => setEntFor(r.personCode)} />)
          : <Card><Empty testId={tid.tleave.empty}>{filtered ? 'Nothing matches that filter' : 'Nothing waiting on you'}</Empty></Card>}
      </>}
      <TeamBalancesTable onEntitlement={setEntFor} />
      {!!flags.LV_LEAVER && <LeaverReconciliation />}
      {dec && <DeclineDialog key={dec.id} r={dec} onClose={() => setDeclining(null)} />}
      {entFor && <PersonEntitlement key={entFor} code={entFor} canSimulate={!!flags.LV_PRORATA} onClose={() => setEntFor(null)} />}
    </Page>);
}

/* One waiting request (v15:7853-7875). */
function RequestCard({ r, slaDays, escalateTo, onDecline, onEntitlement }: {
  r: TeamRequestView; slaDays: number; escalateTo: string; onDecline: () => void; onEntitlement: () => void;
}) {
  const approve = useApproveLeave();
  const tenant = useTenant().data, caps = useCaps();
  const rotaOn = !!tenant?.modules.R;
  const busy = approve.isPending(`leave/request/${r.id}`);
  return (
    <Card testId={tid.tleave.card(r.id)}>
      <div className="flex flex-wrap items-start gap-md">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{r.name} <span className="font-mono text-xs font-normal text-text-muted">{r.personCode}</span></div>
          <Small>{r.typeName} · {r.range} · {r.qtyText} · requested {formatDmy(r.raisedAt.slice(0, 10))}</Small>
        </div>
        <div className="ml-auto flex items-center">
          {r.sla.escalated
            ? <Pill testId={tid.tleave.sla(r.id)} tone="err" glyph={<TriangleAlert aria-hidden="true" />}>{r.sla.text}</Pill>
            : <><Pill testId={tid.tleave.sla(r.id)} tone={r.sla.tone} glyph="◷">{r.sla.text}</Pill>
                <Tip testId={tid.tleave.slaTip(r.id)} text={`Then it escalates to the ${escalateTo}. The approval SLA is ${slaDays} days.`} /></>}
        </div>
      </div>
      <div className="mt-md grid grid-cols-3 gap-md max-md:grid-cols-1">
        <div>
          <GroupLabel className="flex items-center">Balance
            <Tip testId={tid.tleave.balanceTip(r.id)} text="Colleagues cannot book beyond their balance. Calculated from the shared workforce record." /></GroupLabel>
          <div data-testid={tid.tleave.balance(r.id)} className="text-sm">{r.balance}</div>
          <Button testId={tid.tleave.how(r.id)} kind="ghost" small className="mt-[6px]" onClick={onEntitlement}>How it was worked out</Button>
        </div>
        <div>
          <GroupLabel>Effect on cover</GroupLabel>
          <div data-testid={tid.tleave.cover(r.id)} className={cn('text-sm font-semibold', r.short ? 'text-err' : rotaOn ? 'text-ok' : 'text-text-secondary')}>{r.impact}</div>
        </div>
        <div>
          <GroupLabel>Workflow stage</GroupLabel>
          <div data-testid={tid.tleave.stage(r.id)} className="text-sm">{r.stage.text}</div>
          <Small>{r.stage.action}</Small>
        </div>
      </div>
      {r.note && <Small testId={tid.tleave.note(r.id)} className="mt-[10px]">“{r.note}”</Small>}
      {r.advisories.length > 0 && <Small testId={tid.tleave.advisory(r.id)} className="mt-[10px] text-warn">{r.advisories.join(' ')}</Small>}
      {approve.refusal && <FormWarn testId={tid.tleave.warn(r.id)}>{approve.refusal.message} <span className="opacity-90">{approve.refusal.next}</span></FormWarn>}
      <div className="mt-[14px] flex flex-wrap gap-sm">
        <Button testId={tid.tleave.approve(r.id)} kind="primary" small pending={busy}
          onClick={() => approve.mutate(r, { onSuccess: x => toastInfo(x.summary) })}>Approve</Button>
        <Button testId={tid.tleave.decline(r.id)} kind="ghost" small disabled={busy} onClick={onDecline}>Decline with a reason</Button>
        {rotaOn && caps.has('team_rota') && <NavLink testId={tid.tleave.rota(r.id)} to="/team/trota" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Check the rota</NavLink>}
      </div>
    </Card>);
}

/* Team balances (v15:7877-7893). */
function TeamBalancesTable({ onEntitlement }: { onEntitlement: (code: string) => void }) {
  const b = useTeamBalances();
  if (!b.data) return null;
  const toil = b.data.toil;
  return (
    <>
      <SectionHead title="Team balances" />
      <Table variant="records" data-testid={tid.tleave.balances}>
        <TableHeader><TableRow>
          <TableHead>Colleague</TableHead><TableHead>Policy</TableHead><TableHead className="text-right">Entitlement</TableHead>
          <TableHead className="text-right">Taken</TableHead><TableHead className="text-right">Remaining</TableHead>
          {toil && <TableHead>TOIL</TableHead>}<TableHead>Booked next</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {b.data.rows.map(p => <BalanceRow key={p.personCode} p={p} toil={toil} onEntitlement={() => onEntitlement(p.personCode)} />)}
        </TableBody>
      </Table>
    </>);
}
function BalanceRow({ p, toil, onEntitlement }: { p: TeamBalanceRow; toil: boolean; onEntitlement: () => void }) {
  return (
    <Row testId={tid.tleave.balanceRow(p.personCode)}>
      <TableCell kind="title"><PersonName name={p.name} /></TableCell>
      <TableCell label="Policy" className="text-xs">{p.policyName}</TableCell>
      <TableCell label="Entitlement" className="text-right tabular-nums">{p.entDays} d · {p.entHours.toFixed(1)} h</TableCell>
      <TableCell label="Taken" className="text-right tabular-nums">{p.takenD} d</TableCell>
      <TableCell label="Remaining" className="text-right tabular-nums"><strong>{p.leftD} d</strong></TableCell>
      {toil && <TableCell label="TOIL" className="text-xs">{p.toil > 0 ? `${p.toil}h${p.toilBy ? ` · use by ${formatDmy(p.toilBy)}` : ''}` : '—'}</TableCell>}
      <TableCell label="Booked next" className="text-xs">
        <span data-testid={tid.tleave.next(p.personCode)} className="inline-flex items-center gap-[6px]">{p.next
          ? <>{formatDmy(p.next.from)} {p.next.state === 'pending' ? <Pill tone="warn" glyph="◷">waiting</Pill> : <Pill tone="ok" glyph="✓">approved</Pill>}</>
          : '—'}</span>
      </TableCell>
      <TableCell kind="foot" className="text-right">
        <Button testId={tid.tleave.ent(p.personCode)} kind="ghost" small onClick={onEntitlement}>Entitlement</Button>
      </TableCell>
    </Row>);
}

/* Leaver reconciliation (v15:7894-7911): days and hours and the direction
   only. Payroll settles the money (D13). */
function LeaverReconciliation() {
  const l = useLeavers();
  if (!l.data?.rows.length) return null;
  const settled = l.data.settled;
  return (
    <>
      <SectionHead title="Leaver reconciliation" tipTestId={tid.tleave.leaversTip}
        tip="Calculated at the leaving date against pro-rata entitlement for the period worked in the financial year." />
      {l.data.rows.map(x => <LeaverCard key={x.personCode} x={x} settled={settled} />)}
    </>);
}
function LeaverCard({ x, settled }: { x: LeaverRow; settled: string }) {
  const lines: [string, string, string][] = [
    ['full', 'Full-year entitlement', `${x.full} days`],
    ['prorata', 'Entitlement to the leaving date (pro-rata)', `${x.prorata} days`],
    ['taken', 'Leave taken', `${x.taken} days`],
  ];
  return (
    <Card testId={tid.tleave.leaver(x.personCode)}>
      <div className="flex flex-wrap items-start gap-md">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{x.name} <span className="font-mono text-xs font-normal text-text-muted">{x.personCode}</span></div>
          <Small>Leaving {formatDmy(x.leaveDate)} · {x.months} months of the financial year worked{x.note ? ` · ${x.note}` : ''}</Small>
        </div>
        <div className="ml-auto"><Pill testId={tid.tleave.leaverVerdict(x.personCode)} tone={x.tone} glyph={x.diff === 0 ? '✓' : <TriangleAlert aria-hidden="true" />}>{x.verdict}</Pill></div>
      </div>
      <div className="mt-md">
        <Table>
          <TableBody>
            {lines.map(([k, label, value]) => (
              <Row key={k} testId={tid.tleave.leaverRow(x.personCode, k)}>
                <TableCell>{label}</TableCell><TableCell className="text-right font-mono tabular-nums">{value}</TableCell>
              </Row>))}
            <Row testId={tid.tleave.leaverRow(x.personCode, 'diff')}>
              <TableCell><strong>{x.diff < 0 ? 'Over-taken' : 'Remaining balance'}</strong></TableCell>
              <TableCell className="text-right font-mono tabular-nums"><strong>{Math.abs(x.diff)} days · {x.hours} hours</strong></TableCell>
            </Row>
          </TableBody>
        </Table>
      </div>
      <div className="mt-md [&>div]:mb-0">
        <Banner testId={tid.tleave.leaverAction(x.personCode)} tone={x.diff < 0 ? 'warn' : 'info'} title={x.action}>{settled}</Banner>
      </div>
    </Card>);
}

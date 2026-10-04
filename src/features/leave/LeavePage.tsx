import { useState } from 'react';
import { tid } from '@/testids';
import { Button, Card, EssCard, EssCols, EssRow, GuideButton, Page, PageHead, Pill, Small, Tip, toastInfo, toastRefusal } from '@/ui';
import { ApiError } from '@/api/client';
import { useCancelLeave, useMyLeave, type LeaveRequestView, type MyLeave } from '@/api/leave';
import { tellManagerToast } from '@/domain/leave';
import { formatDmy } from '@/domain/time';
import { useCaps } from '@/shell/useCaps';
import { useTenant } from '@/shell/shellData';
import { EntitlementDialog, RequestDialog, SimulateDialog } from './LeaveDialogs';

/* My leave: the prototype's essLeave (qnipay-workforce-v15.html:7672-7713),
   for an employee and for a manager's own record. Balances in days and hours,
   TOIL and carry-over, the days still to take, my requests (each waiting one
   with its own Cancel, D1), the adjustment ledger, "How this was worked out",
   and Request leave. Every figure is the server's (D3); the request form
   works out "Comes to" on the client only to answer as the dates change. */
type Open = 'request' | 'entitlement' | 'simulate' | null;

export function LeavePage() {
  const q = useMyLeave();
  const refused = q.error instanceof ApiError ? q.error.refusal : null;
  const m = q.data;
  return (
    <Page testId={tid.page('leave')}>
      <PageHead title="My leave" crumb={`My work · Leave${m ? ` · ${m.year.label}` : ''}`} actions={<GuideButton view="leave" />} />
      {q.isError && <p data-testid={tid.leave.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Your leave could not be loaded. Reload the page to try again.'}</p>}
      {!m && !q.isError && <p data-testid={tid.leave.loading} className="text-text-secondary">Loading your leave&hellip;</p>}
      {m && <MyLeaveView m={m} />}
    </Page>);
}

function MyLeaveView({ m }: { m: MyLeave }) {
  const caps = useCaps(), flags = useTenant().data?.flags ?? {};
  const [open, setOpen] = useState<Open>(null);
  const cancel = useCancelLeave();
  const b = m.balance, e = m.entitlement, hours = b.unit === 'hours';
  const annual = m.types.find(t => t.code === 'AL')?.name ?? 'Annual leave';
  const toil = m.rules.toil && b.toil > 0;
  const anyPending = m.requests.some(r => r.state === 'pending');
  const [toTake, ...toTakeRest] = m.daysToTake.split(' · ');
  /* the prototype's isMgr() with LV_PRORATA */
  const canSimulate = caps.has('team_leave') && !!flags.LV_PRORATA;
  return (
    <>
      {/* the web-only strip (.card.wide-only): sick during booked leave */}
      <Card className="max-md:hidden">
        <div data-testid={tid.leave.offSick} className="flex flex-wrap items-center gap-sm">
          <div className="text-sm font-semibold">Off sick during booked leave?
            <Tip testId={tid.leave.offSickTip} text="HR can return those days to your balance once your manager records the sickness." /></div>
          <div className="ml-auto">
            <Button testId={tid.leave.tellMgr} kind="ghost" small
              onClick={() => toastRefusal({ message: tellManagerToast(m.person.manager), next: 'Tell your manager directly for now.' })}>Tell my manager</Button>
          </div>
        </div>
      </Card>

      <EssCols testId={tid.leave.cards}>
        <EssCard testId={tid.leave.balances} label={<>Balances<Tip testId={tid.leave.balancesTip}
          text={`Entitlement is calculated from your contracted hours, working pattern and length of service under the ${e.policy.name} policy.`} /></>}>
          <EssRow><span>{annual}</span>
            <strong data-testid={tid.leave.annual}>{hours ? `${b.leftH} of ${e.hours.toFixed(1)} hours` : `${b.leftD} of ${e.days} days`}</strong></EssRow>
          <EssRow><span>Same balance in {hours ? 'days' : 'hours'}</span>
            <span data-testid={tid.leave.other}>{hours ? `${(b.leftH / (m.facts.contractedHours > 0 ? m.facts.contractedHours / 5 : 7.5)).toFixed(1)} days` : `${b.leftH.toFixed(2)} hours`}</span></EssRow>
          <EssRow><span>Taken so far</span><span data-testid={tid.leave.taken}>{b.takenD} days · {b.takenH.toFixed(2)} hours</span></EssRow>
          {b.pending > 0 && <EssRow><span>Awaiting a decision</span><span data-testid={tid.leave.pending}>{b.pending} days</span></EssRow>}
          {toil && <EssRow>
            <span>Time off in lieu<Tip testId={tid.leave.toilTip}
              text={`Up to ${m.rules.toilMax} hours can build up, and must be used within ${m.rules.toilWindow} months.`} /></span>
            <strong data-testid={tid.leave.toil}>{b.toil} hours{b.toilBy ? ` · use by ${formatDmy(b.toilBy)}` : ''}</strong></EssRow>}
          <EssRow><span>Can carry over</span><span data-testid={tid.leave.carry}>{e.policy.carry} days</span></EssRow>
          <Button testId={tid.leave.entShow} kind="ghost" className="mt-[10px] w-full" onClick={() => setOpen('entitlement')}>How this was worked out</Button>
        </EssCard>

        {m.daysToTake && (
          <div data-testid={tid.leave.toTake} className="mb-md rounded-card border border-warn bg-warn-surface p-lg text-sm text-warn">
            <strong>{toTake}</strong>{toTakeRest.length > 0 && ` · ${toTakeRest.join(' · ')}`}
          </div>)}

        <EssCard testId={tid.leave.requests}
          label={<>My requests{anyPending && <Tip testId={tid.leave.requestsTip} text={m.cancelTip} />}</>}>
          {m.requests.length
            ? m.requests.map(r => <RequestRow key={r.id} r={r} pending={cancel.isPending(`leave/request/${r.id}`)}
                onCancel={() => cancel.mutate({ id: r.id, version: r.version }, { onSuccess: x => toastInfo(x.summary) })} />)
            : <Small testId={tid.leave.noRequests}>No requests this financial year</Small>}
        </EssCard>

        <EssCard testId={tid.leave.history}
          label={<>History<Tip testId={tid.leave.historyTip} text="Every entitlement change is traceable. Each one is listed here as it was made." /></>}>
          {m.ledger.length
            ? m.ledger.map(l => (
                <EssRow key={l.id} testId={tid.leave.ledger(l.id)}>
                  <span><strong>{l.type}</strong><Small>{formatDmy(l.date)} · {l.why}</Small></span>
                  <span className="font-mono tabular-nums">{l.qtyText}</span>
                </EssRow>))
            : <Small testId={tid.leave.noHistory}>No adjustments recorded</Small>}
        </EssCard>

        <Button testId={tid.leave.requestOpen} kind="primary" className="w-full" onClick={() => setOpen('request')}>Request leave</Button>
      </EssCols>

      {open === 'request' && <RequestDialog m={m} onClose={() => setOpen(null)} />}
      {open === 'entitlement' && <EntitlementDialog m={m} onClose={() => setOpen(null)}
        onSimulate={canSimulate ? () => setOpen('simulate') : undefined} />}
      {open === 'simulate' && <SimulateDialog m={m} onClose={() => setOpen(null)} />}
    </>);
}

/* One of my requests: the dates, type and amount, its state, and Cancel while it waits (D1). */
function RequestRow({ r, pending, onCancel }: { r: LeaveRequestView; pending: boolean; onCancel: () => void }) {
  return (
    <EssRow testId={tid.leave.request(r.id)}>
      <span className="min-w-0">
        <strong>{r.range}</strong> · {r.typeName} · {r.qtyText}
        {r.state === 'declined' && r.reason && <Small testId={tid.leave.reason(r.id)}>Reason: {r.reason}</Small>}
      </span>
      <span className="flex shrink-0 items-center gap-[6px]">
        <Pill testId={tid.leave.state(r.id)} tone={r.tone} glyph={r.glyph}>{r.stateLabel}</Pill>
        {r.state === 'pending' && <Button testId={tid.leave.cancel(r.id)} kind="ghost" small pending={pending} onClick={onCancel}>Cancel</Button>}
      </span>
    </EssRow>);
}

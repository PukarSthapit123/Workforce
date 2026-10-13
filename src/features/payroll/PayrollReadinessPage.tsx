import { useState, type ReactNode } from 'react';
import { CircleCheck, Clock, Lock, OctagonAlert, TriangleAlert } from 'lucide-react';
import { tid } from '@/testids';
import { buttonVariants } from '@/ui/shadcn/button';
import {
  Banner, Button, Card, CardHead, Field, GuideButton, Modal, NavLink, Page, PageHead, Pill, Small, Stat, Stats, TextArea, toastInfo, toastRefusal,
} from '@/ui';
import { useShellData } from '@/shell/shellData';
import { useExportPayroll, usePayrollReadiness, useReconcilePayroll, useReopenPayroll, type PayrollReadiness } from '@/api/payroll';
import { PAY_STATES, bannerText, periodLabel } from '@/domain/payroll';
import { DOWNLOAD_BLOCKED } from '@/domain/hours';
import { formatDmy, formatTime } from '@/domain/time';
import { formatDateTime } from '@/lib/format';
import { downloadText, toCsv } from '@/lib/download';

const TIP = 'Whether this period can be handed to payroll, and what is standing in the way';
const HANDOVER = 'Export produces a real CSV of the period’s approved hours, with hours and pay codes only. It does not post to Business Central. Approval already queues each record individually.';
/* The banner's tone, as P's .banner a, b, c and d */
const TONE = { notready: 'err', warnings: 'warn', ready: 'ok', exported: 'info', reconciled: 'ok' } as const;

/* Payroll readiness: the prototype's admPayroll (qnipay-workforce-v15.html:
   9855-9910). One answer for the pay period, which Organisation's pay
   frequency, week ending day and first pay date give: the state, P's four
   figures, the period beside the previous period's lock and the Timesheet
   cut-off, what blocks the handover and what is worth reviewing, each with
   Open where the reader can reach the page it is put right on, and the
   handover: export, reconcile and reopen. The state is every location's, not
   P's one location, as the run is the period's. Nothing changes on screen
   until the server has answered. */
export function PayrollReadinessPage() {
  const q = usePayrollReadiness();
  return (
    <Page testId={tid.page('ipay')}>
      <PageHead title="Payroll readiness" crumb="Qnipay setup · Payroll readiness" tip={TIP} tipTestId={tid.head.tip('ipay')} actions={<GuideButton view="ipay" />} />
      {q.data
        ? <ReadinessView r={q.data} />
        : q.isError
          ? <p data-testid={tid.ipay.error} role="alert" className="text-err">Payroll readiness could not be loaded, so nothing here is current. Reload the page.</p>
          : <p data-testid={tid.ipay.loading} className="text-text-secondary">Loading payroll readiness&hellip;</p>}
    </Page>);
}

const at = (w: { date: string; time: string }) => `${formatDmy(w.date)} ${formatTime(w.time)}`;
function ReadinessView({ r }: { r: PayrollReadiness }) {
  const S = PAY_STATES[r.state], run = r.run;
  const exported = run.exported ? { at: formatDateTime(run.exported.at), by: run.exported.by.name } : undefined;
  const shell = useShellData();
  /* Open goes to the page the item is put right on, where this reader can reach it */
  const pathOf = (view: string) => (shell.kind === 'ready' ? shell.nav.flatMap(g => g.tabs).find(t => t.view === view)?.path : undefined);
  const [reopening, setReopening] = useState(false);
  const exp = useExportPayroll(), rec = useReconcilePayroll();
  const v = { id: run.id, ifMatch: run.version };
  const doExport = () => exp.mutate(v, { onSuccess: x => {
    if (downloadText(x.fileName, toCsv(x.rows))) toastInfo(x.message);
    else toastRefusal({ message: DOWNLOAD_BLOCKED.message, next: 'The period is marked exported. Reopen it, allow downloads, then export again.' });
  } });
  const busy = exp.anyPending || rec.anyPending;
  return (
    <>
      <Banner testId={tid.ipay.banner} tone={TONE[r.state]} title={`${S.label} · ${periodLabel(r.period)}`}>
        {bannerText(r.state, r.blockers.length, r.warnings.length, exported)}
      </Banner>
      <Stats>
        <Stat testId={tid.ipay.figure('missing')} label="Missing timesheets" tone={r.figures.missing ? 'bad' : 'good'} foot="past rota’d days with no hours">{r.figures.missing}</Stat>
        <Stat testId={tid.ipay.figure('awaiting')} label="Awaiting approval" tone={r.figures.awaiting ? 'bad' : 'good'} foot="not finally approved, resubmissions included">{r.figures.awaiting}</Stat>
        <Stat testId={tid.ipay.figure('failed')} label="Posting failures" tone={r.figures.failed ? 'bad' : 'good'} foot="hours that never arrived">{r.figures.failed}</Stat>
        <Stat testId={tid.ipay.figure('exceptions')} label="Open exceptions" tone={r.figures.exceptions ? 'bad' : 'good'} foot="unresolved across all types">{r.figures.exceptions}</Stat>
      </Stats>
      <Card testId={tid.ipay.period}>
        <CardHead title="Pay-period state" />
        <PeriodRow label="Current period" value={<span data-testid={tid.ipay.current}>{periodLabel(r.period)}</span>}>
          <Pill testId={tid.ipay.currentState} tone="ok" glyph={<CircleCheck />}>Open</Pill>
          <span data-testid={tid.ipay.closes} className="text-xs text-text-muted">closes {at(r.period.closesAt)}</span>
        </PeriodRow>
        <PeriodRow label="Pay frequency" value={<span data-testid={tid.ipay.frequency}>{r.period.frequency}</span>}>
          <NavLink testId={tid.ipay.frequencyLink} to="/setup/aorg" className="text-xs font-semibold text-brand underline dark:text-brand-accent">Set on Organisation</NavLink>
        </PeriodRow>
        <PeriodRow label="Previous period" value={<span data-testid={tid.ipay.previous}>{periodLabel(r.previous)}</span>}>
          {r.previous.locked
            ? <Pill testId={tid.ipay.previousState} tone="info" glyph={<Lock />}>Closed at {r.cutoff}</Pill>
            : <Pill testId={tid.ipay.previousState} tone="warn" glyph={<Clock />}>Still open</Pill>}
        </PeriodRow>
        <PeriodRow label="Cut-off" value={<span data-testid={tid.ipay.cutoff}>{r.cutoff}</span>}>
          <span data-testid={tid.ipay.enforced} className="text-xs text-text-muted">{r.enforced ? 'enforced' : 'advisory only, not applied'}</span>
        </PeriodRow>
      </Card>
      {r.blockers.length > 0 && <Items testId={tid.ipay.blockers} title="Blocking the handover" tone="err" glyph={<OctagonAlert />} items={r.blockers} pathOf={pathOf} />}
      {r.warnings.length > 0 && <Items testId={tid.ipay.warnings} title="Worth reviewing first" tone="warn" glyph={<TriangleAlert />} items={r.warnings} pathOf={pathOf} />}
      <Card>
        <CardHead title="Handover" />
        <Small>{HANDOVER}</Small>
        <div className="mt-md flex flex-wrap justify-end gap-sm">
          {run.state !== 'open' && <Button testId={tid.ipay.reopen} kind="ghost" disabled={busy} onClick={() => setReopening(true)}>Reopen the period</Button>}
          <Button testId={tid.ipay.reconcile} kind="ghost" disabled={run.state !== 'exported'} title={run.state === 'open' ? 'Export first' : undefined}
            pending={rec.isPending(`payroll/${run.id}`)} onClick={() => rec.mutate(v, { onSuccess: x => toastInfo(x.message) })}>Mark reconciled</Button>
          <Button testId={tid.ipay.export} kind="primary" disabled={r.state === 'notready' || run.state !== 'open'}
            title={run.state !== 'open' ? 'Reopen the period to export it again' : r.state === 'notready' ? 'Clear the blockers first' : undefined}
            pending={exp.isPending(`payroll/${run.id}`)} onClick={doExport}>Export approved hours</Button>
        </div>
        {run.history.length > 0 && (
          <ul data-testid={tid.ipay.history} className="mt-md border-t pt-sm text-xs leading-[1.45] text-text-muted">
            {run.history.map(h => (
              <li key={`${h.at}-${h.to}`}>{historyLine(h)}</li>))}
          </ul>)}
      </Card>
      {reopening && <ReopenDialog r={r} onClose={() => setReopening(false)} />}
    </>);
}

type Step = PayrollReadiness['run']['history'][number];
function historyLine(h: Step): string {
  const when = `${formatDateTime(h.at)} by ${h.by.name}`;
  if (h.to === 'exported') return `Exported ${when} · ${h.rows ?? 0} row${h.rows === 1 ? '' : 's'}`;
  if (h.to === 'reconciled') return `Reconciled ${when}`;
  return `Reopened ${when} · ${h.reason}`;
}

/* .mr (v15:727-729): the label, the value, and its state */
function PeriodRow({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-md border-b py-sm text-sm last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="ml-auto flex flex-wrap items-center justify-end gap-sm"><strong className="font-semibold tabular-nums">{value}</strong>{children}</span>
    </div>);
}

/* The blockers or the warnings: .att rows (v15:1210-1212), the label pill, what it is, and Open */
function Items({ testId, title, tone, glyph, items, pathOf }: {
  testId: string; title: string; tone: 'err' | 'warn'; glyph: ReactNode; items: PayrollReadiness['blockers']; pathOf: (view: string) => string | undefined;
}) {
  return (
    <Card testId={testId}>
      <CardHead title={title} actions={<Pill tone={tone} glyph={glyph}>{items.length}</Pill>} />
      {items.map(b => {
        const path = pathOf(b.go);
        return (
          <div key={b.key} data-testid={tid.ipay.item(b.key)} className="flex flex-wrap items-center gap-md border-b py-[10px] text-sm last:border-b-0">
            <Pill tone={tone}>{b.label}</Pill>
            <span>{b.text}</span>
            {path && <NavLink testId={tid.ipay.open(b.key)} to={path} className={`ml-auto ${buttonVariants({ variant: 'ghost', size: 'sm' })}`}>Open</NavLink>}
          </div>);
      })}
    </Card>);
}

/* Reopening asks why: the reason is kept on the run and in the audit log. A refusal lands on the reason. */
function ReopenDialog({ r, onClose }: { r: PayrollReadiness; onClose: () => void }) {
  const m = useReopenPayroll();
  const [reason, setReason] = useState('');
  const send = () => m.mutate({ id: r.run.id, ifMatch: r.run.version, reason }, { onSuccess: x => { toastInfo(x.message); onClose(); } });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Reopen the period"
      description={`${periodLabel(r.period)} goes back to open, and readiness is worked out again. The export stays on the audit log.`}
      footer={<>
        <Button testId={tid.ipay.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.ipay.confirm} kind="primary" pending={m.isPending(`payroll/${r.run.id}`)} onClick={send}>Reopen</Button>
      </>}>
      <Field label="Why the period is being reopened" required error={m.fieldError('reason')}>
        <TextArea testId={tid.ipay.reason} rows={3} value={reason} onChange={e => { setReason(e.target.value); m.clearFieldErrors(); }}
          placeholder="e.g. A late correction to Willow House's hours" />
      </Field>
    </Modal>);
}

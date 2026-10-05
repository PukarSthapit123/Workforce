import { Fragment, useState } from 'react';
import { Compass, Link2, Lock, Shield } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Button, Empty, NavLink, Page, PageHead, Pill, Row, SettingRow, Tip, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useApprovalSetup, useDelegations, useRemoveDelegation, type ApprovalChain, type Delegations, type SignOff } from '@/api/approvals';
import { CHAIN_TIP, FIXED_TIP } from '@/domain/approvals';
import { formatDmy } from '@/domain/time';
import { ChainDialog, DelegationDialog } from './ApprovalDialogs';

/* Approvals: the prototype's admApprovals (qnipay-workforce-v15.html:
   8405-8473). The approval chain per module, layer by layer, with the
   Business Central posting step locked at the end of the Timesheet chain;
   each module's chain is edited whole in a dialog and saved with If-Match
   (D8), where the prototype changed each cell in place. The sign-off
   settings are read here and changed where they live (one home per
   setting): the approval method is the Email approval feature, the cut-off,
   its enforcement and the return reason are on Timesheet setup. Then the
   delegations, which the prototype could only add as one fixed row, with a
   real editor. Per-person approver assignments are not here: a person's
   approver is their manager on their record (1b). */
export function ApprovalsPage() {
  const setup = useApprovalSetup();
  return (
    <Page testId={tid.page('aappr')}>
      <PageHead title="Approval framework" crumb="Qnipay setup · Approvals" tipTestId={tid.aappr.tip}
        tip="One framework: layer, approver, scope, condition, SLA, escalation, delegation and return reason. Workflows stay module-specific." />
      {setup.data
        ? <><ChainCard chains={setup.data.chains} /><SignOffCard s={setup.data.signOff} /></>
        : setup.isError
          ? <p data-testid={tid.aappr.error} role="alert" className="text-err">The approval chains could not be loaded. Reload the page.</p>
          : <p data-testid={tid.aappr.loading} className="text-text-secondary">Loading the approval chains&hellip;</p>}
      <DelegationCard />
    </Page>);
}

const GROUP_CELL = 'pt-lg pb-xs text-xs font-[650] text-text-secondary';
function ChainCard({ chains }: { chains: ApprovalChain[] }) {
  const [editing, setEditing] = useState<ApprovalChain['module'] | null>(null);
  const open = chains.find(c => c.module === editing);
  return (
    <AdminCard testId={tid.aappr.chain} icon={<Link2 />} title="Approval chain" tip={CHAIN_TIP} tipTestId={tid.aappr.chainTip}
      desc="Who signs off, in what order, and when each layer is required">
      {/* a record list (table.rec): on a phone each layer is a card of labelled
          lines under its module, never a table scrolled sideways (MOBILE FOUNDATION) */}
      <Table data-testid={tid.aappr.chainTable} variant="records">
        <TableHeader><TableRow>
          <TableHead className="w-[52px]">Layer</TableHead><TableHead>Module</TableHead><TableHead>Approver role</TableHead>
          <TableHead>Scope</TableHead><TableHead>When it applies</TableHead><TableHead>SLA</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {chains.map(c => (
            <Fragment key={c.module}>
              <Row testId={tid.aappr.group(c.module)}>
                <TableCell colSpan={6} kind="title" className={GROUP_CELL}>{c.module}</TableCell>
                <TableCell kind="foot" className="pt-lg pb-xs text-right">
                  <Button testId={tid.aappr.edit(c.module)} kind="ghost" small aria-label={`Edit the ${c.module} chain`} onClick={() => setEditing(c.module)}>Edit</Button>
                </TableCell>
              </Row>
              {c.steps.map((s, i) => (
                <Row key={i} testId={tid.aappr.row(c.module, i)}>
                  <TableCell label="Layer"><Pill tone={s.fixed ? 'neu' : 'ok'}>{i + 1}</Pill></TableCell>
                  <TableCell label="Module" className="text-xs text-text-muted">{c.module}</TableCell>
                  <TableCell label="Approver role">{s.fixed
                    ? <span className="inline-flex items-center gap-xs">{s.role}<Lock aria-hidden="true" className="size-[13px] text-text-muted" /><Tip testId={tid.aappr.fixedTip} text={FIXED_TIP} /></span>
                    : s.role}</TableCell>
                  <TableCell label="Scope" className={s.fixed ? 'text-xs text-text-muted' : undefined}>{s.scope}</TableCell>
                  <TableCell label="When it applies" className={s.fixed ? 'text-xs text-text-muted' : undefined}>{s.when}</TableCell>
                  <TableCell label="SLA" className={s.fixed ? 'text-xs text-text-muted' : 'tabular-nums'}>{s.sla}</TableCell>
                  <TableCell empty />
                </Row>))}
            </Fragment>))}
        </TableBody>
      </Table>
      {open && <ChainDialog key={`${open.module}:${open.version}`} chain={open} onClose={() => setEditing(null)} />}
    </AdminCard>);
}

const LINK = 'text-xs font-semibold text-brand underline dark:text-brand-accent';
function SignOffCard({ s }: { s: SignOff }) {
  const range = (p: { from: string; to: string }) => `${formatDmy(p.from)} – ${formatDmy(p.to)}`;
  return (
    <AdminCard testId={tid.aappr.signOff} icon={<Shield />} title="Sign-off settings" tipTestId={tid.aappr.signOffTip}
      tip="Applies to every employee type. Each person's approver is the manager on their record." desc="How a period gets approved">
      <SettingRow title={<>Approval method<Tip testId={tid.aappr.methodTip} text="An email link lets a manager approve without signing in." /></>} desc="How managers approve">
        <span data-testid={tid.aappr.method} className="text-sm">{s.emailApproval ? 'Email link (one-click)' : 'In-app only'}</span>
        <NavLink testId={tid.aappr.methodLink} to="/setup/amods?m=TS" className={LINK}>Change it in Modules and features</NavLink>
      </SettingRow>
      <SettingRow title="Pay-period cut-off" desc="Deadline to submit before the period closes">
        <span data-testid={tid.aappr.cutoff} className="text-sm">{s.cutoff}</span>
        <NavLink testId={tid.aappr.cutoffLink} to="/setup/mts" className={LINK}>Change it on Timesheet setup</NavLink>
      </SettingRow>
      <SettingRow title={<>Enforce the cut-off<Tip testId={tid.aappr.enforceTip} text="When on, a closed period refuses new submissions and amendments. When off, the deadline is advisory only." /></>}
        desc={s.enforceLock ? `On. Periods before ${formatDmy(s.current.from)} are closed.` : 'Off. The deadline is displayed but not applied.'}>
        <span data-testid={tid.aappr.enforce} className="text-sm">{s.enforceLock ? 'On' : 'Off'}</span>
        <NavLink testId={tid.aappr.enforceLink} to="/setup/mts" className={LINK}>Change it on Timesheet setup</NavLink>
      </SettingRow>
      <SettingRow title="Current period state" desc="Computed from the cut-off and today’s date">
        <Pill testId={tid.aappr.current} tone="ok">Open · {range(s.current)}</Pill>
        <Pill testId={tid.aappr.previous} tone={s.previous.closed ? 'err' : 'warn'} glyph={s.previous.closed ? <Lock /> : undefined}>
          {s.previous.closed ? 'Closed' : 'Open'} · {range(s.previous)}</Pill>
      </SettingRow>
      <SettingRow title={<>Return-with-reason required<Tip testId={tid.aappr.reasonTip} text="The reason is sent to the employee with the returned timesheet and stored on the entry." /></>}
        desc="Manager must give a reason when sending back">
        <span data-testid={tid.aappr.reason} className="text-sm">{s.returnReasonRequired ? 'Required' : 'Not required'}</span>
        <NavLink testId={tid.aappr.reasonLink} to="/setup/mts" className={LINK}>Change it on Timesheet setup</NavLink>
      </SettingRow>
    </AdminCard>);
}

function DelegationCard() {
  const q = useDelegations();
  const [adding, setAdding] = useState(false);
  return (
    <AdminCard testId={tid.aappr.deleg} icon={<Compass />} title="Approval delegation" tipTestId={tid.aappr.delegTip}
      tip="Cover for leave: another approver receives the queue for a date range, and every decision records who acted."
      desc="Reassign an approver’s queue for a date range">
      {q.data
        ? <DelegationTable d={q.data} />
        : q.isError
          ? <p data-testid={tid.aappr.delegError} role="alert" className="text-err">The delegations could not be loaded. Reload the page.</p>
          : <p data-testid={tid.aappr.delegLoading} className="text-text-secondary">Loading the delegations&hellip;</p>}
      <div className="mt-lg flex flex-wrap justify-end gap-sm">
        <Button testId={tid.aappr.delegAdd} kind="ghost" small disabled={!q.data} onClick={() => setAdding(true)}>Set up delegation</Button>
      </div>
      {adding && q.data && <DelegationDialog approvers={q.data.approvers} onClose={() => setAdding(false)} />}
    </AdminCard>);
}

function DelegationTable({ d }: { d: Delegations }) {
  const remove = useRemoveDelegation();
  return (
    <Table data-testid={tid.aappr.delegTable} variant="records">
      <TableHeader><TableRow>
        <TableHead>Approver</TableHead><TableHead>Delegated to</TableHead><TableHead>From</TableHead><TableHead>Until</TableHead>
        <TableHead>Modules</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {d.items.length ? d.items.map(x => (
          <Row key={x.id} testId={tid.aappr.delegRow(x.id)}>
            <TableCell kind="title">{x.whoName}</TableCell>
            <TableCell label="Delegated to">{x.toName}</TableCell>
            <TableCell label="From" className="tabular-nums">{formatDmy(x.from)}</TableCell>
            <TableCell label="Until" className="tabular-nums">{formatDmy(x.until)}</TableCell>
            <TableCell label="Modules" className="text-xs text-text-muted">{x.modules.join(', ')}</TableCell>
            <TableCell kind="foot" className="text-right">
              <Button testId={tid.aappr.delegRemove(x.id)} kind="ghost" small pending={remove.isPending(`delegation/${x.id}`)}
                aria-label={`Remove the delegation from ${x.whoName} to ${x.toName}`}
                onClick={() => remove.mutate({ id: x.id, ifMatch: x.version }, { onSuccess: r => toastInfo(r.message) })}>Remove</Button>
            </TableCell>
          </Row>))
          : <Row testId={tid.aappr.delegEmpty}><TableCell colSpan={6}><Empty>No delegations in force</Empty></TableCell></Row>}
      </TableBody>
    </Table>);
}

import { useState, type ReactNode } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Button, Empty, Page, PageHead, Pill, Row, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useInviteStarter, useStartStarter, useTeamOnboarding, type OnbQueueRow, type TeamOnboarding, type TrackerRow } from '@/api/onboarding';
import { formatDmy } from '@/domain/time';
import { useCaps } from '@/shell/useCaps';
import { PersonForm } from '@/features/people/PersonForm';
import { StatePill } from '@/features/people/StatePill';
import { FileCell } from './OnbDocuments';
import { CheckDialog, NotReadyDialog } from './TeamOnbDialogs';

/* My team → Onboarding: the prototype's mgrOnboarding (qnipay-workforce-v15.html:
   4729-4765) with the onb-invite, onb-review, onb-verify, onb-reject,
   onb-activate and onb-chase handlers (11632-11723). The new starters at the
   manager's own location (every location with Configure onboarding, D5),
   the documents waiting on a check, and each starter's progress, state and
   what is holding them up. Each action shows only to the holder of its
   capability (Invite, Start them and Chase need Track onboarding; Check it,
   Verify and Reject need Verify onboarding documents) and the server checks
   it again. As in the prototype, Start them on somebody with anything
   outstanding opens the not-ready dialog without asking the server; with
   nothing outstanding it asks, and a NOT_READY refusal opens the same dialog.
   Add a new starter opens the 1b person form with the starting state set to
   candidate. There is no guide: the prototype has none for this page. */
export function TeamOnboardingPage() {
  const q = useTeamOnboarding();
  const caps = useCaps(), crud = caps.has('emp_crud');
  const [adding, setAdding] = useState(false);
  const d = q.data;
  const refused = q.error instanceof ApiError ? q.error.refusal : null;
  const add = (testId: string, link?: boolean) => <Button testId={testId} kind={link ? 'link' : 'primary'} small={!link} onClick={() => setAdding(true)}>Add a new starter</Button>;
  return (
    <Page testId={tid.page('tonb')}>
      <PageHead title="Onboarding" crumb="My team · Onboarding" tipTestId={tid.tonb.tip}
        tip="New starters, what they have completed, and what is holding them up."
        actions={d && <>
          {crud && add(tid.tonb.add)}
          <Pill testId={tid.tonb.toVerify} tone={d.toVerify ? 'warn' : 'neu'}>{d.toVerify} to verify</Pill>
        </>} />
      {q.isError && <p data-testid={tid.tonb.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Onboarding could not be loaded. Reload the page to try again.'}</p>}
      {!d && !q.isError && <p data-testid={tid.tonb.loading} className="text-text-secondary">Loading onboarding&hellip;</p>}
      {d && <>
        {d.verify && d.queue.length > 0 && <Queue d={d} canCheck={caps.has('onb_verify')} />}
        <InProgress d={d} canTrack={caps.has('onb_track')} addLink={crud ? add(tid.tonb.addEmpty, true) : null} refresh={() => void q.refetch()} />
      </>}
      {adding && <PersonForm startState="candidate" defaultLocation={d?.location || undefined} onClose={() => setAdding(false)} />}
    </Page>);
}

/* "Waiting on a check" (v15:4741-4749): documents sent and not yet checked. */
function Queue({ d, canCheck }: { d: TeamOnboarding; canCheck: boolean }) {
  const [checking, setChecking] = useState<{ code: string; doc: string } | null>(null);
  const held = checking && d.queue.find(x => x.person.code === checking.code && x.document.id === checking.doc);
  const [last, setLast] = useState<OnbQueueRow | null>(null);
  const row = held ?? (checking ? last : null);
  return (
    <AdminCard testId={tid.tonb.queue} icon={<ShieldCheck />} title="Waiting on a check" tipTestId={tid.tonb.queueTip}
      tip="A document counts only once somebody has checked it. Who may check each type is set under Onboarding setup.">
      <Table variant="records" dense>
        <TableHeader><TableRow>
          <TableHead>Person</TableHead><TableHead>Document</TableHead><TableHead>Starts</TableHead><TableHead>What they sent</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {d.queue.map(x => {
            const code = x.person.code, doc = x.document.id;
            return (
              <Row key={`${code}/${doc}`} testId={tid.tonb.queueRow(code, doc)}>
                <TableCell kind="title"><b className="font-bold">{x.person.name}</b></TableCell>
                <TableCell label="Document">{x.document.label}</TableCell>
                <TableCell label="Starts">{x.person.start ? formatDmy(x.person.start) : '—'}</TableCell>
                <TableCell label="What they sent"><FileCell f={x.file} testId={tid.tonb.queueFile(code, doc)} /></TableCell>
                <TableCell kind="foot" className="text-right whitespace-nowrap">
                  {canCheck && <Button testId={tid.tonb.check(code, doc)} kind="primary" small
                    onClick={() => { setLast(x); setChecking({ code, doc }); }}>Check it</Button>}
                </TableCell>
              </Row>);
          })}
        </TableBody>
      </Table>
      {row && <CheckDialog key={`${row.person.code}/${row.document.id}`} x={row} onClose={() => setChecking(null)} />}
    </AdminCard>);
}

/* "In progress" (v15:4750-4764): everyone in candidate or preboarding. */
function InProgress({ d, canTrack, addLink, refresh }: { d: TeamOnboarding; canTrack: boolean; addLink: ReactNode; refresh(): void }) {
  const invite = useInviteStarter(), start = useStartStarter();
  /* whose not-ready dialog is open: Start them on somebody with anything outstanding, or a start the server refused as not ready */
  const [notReady, setNotReady] = useState<TrackerRow | null>(null);
  const [started, setStarted] = useState<TrackerRow | null>(null);
  const key = (r: TrackerRow) => `onboarding/case/${r.caseRef.id}`;
  const startThem = (r: TrackerRow) => {
    start.clearFieldErrors();
    if (r.blockers.length) { setNotReady(r); return; }
    setStarted(r);
    start.mutate({ case: r.caseRef, personCode: r.person.code }, { onSuccess: x => toastInfo(x.summary) });
  };
  const held = notReady ?? (start.refusal?.code === 'NOT_READY' ? started : null);
  const dialogRow = held && (d.rows.find(r => r.person.code === held.person.code) ?? held);
  const closeNotReady = () => {
    const fromServer = !notReady;
    setNotReady(null); start.clearFieldErrors();
    /* the list said nothing was outstanding and the server disagreed: read it again */
    if (fromServer) refresh();
  };
  const n = d.rows.length;
  return (
    <AdminCard testId={tid.tonb.list} icon={<Users />} title="In progress" tipTestId={tid.tonb.listTip}
      tip="Everyone in candidate or preboarding. They leave this list when they become active.">
      {n
        ? <Table data-testid={tid.tonb.table} variant="records" dense>
            <TableHeader><TableRow>
              <TableHead>Person</TableHead><TableHead>Starts</TableHead><TableHead>Employee type</TableHead><TableHead>Progress</TableHead>
              <TableHead>State</TableHead><TableHead>Blocking</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {d.rows.map(r => {
                const code = r.person.code, bl = r.blockers, busy = invite.isPending(key(r)) || start.isPending(key(r));
                return (
                  <Row key={code} testId={tid.tonb.row(code)}>
                    <TableCell kind="title"><b className="font-bold">{r.person.name}</b>
                      <span className="block text-xs font-normal text-text-muted">{r.person.email || r.person.id}</span></TableCell>
                    <TableCell label="Starts">{r.person.start ? formatDmy(r.person.start) : '—'}</TableCell>
                    <TableCell label="Employee type">{r.person.employeeTypeName}</TableCell>
                    <TableCell label="Progress">
                      <span data-testid={tid.tonb.progress(code)} className="whitespace-nowrap tabular-nums">
                        <span aria-hidden="true" className="mr-[6px] inline-block h-[6px] w-[56px] overflow-hidden rounded-pill bg-surface-tint align-middle">
                          <span className="block h-full bg-brand dark:bg-brand-accent" style={{ width: `${r.progress.pc}%` }} /></span>
                        {r.progress.done}/{r.progress.total}<span className="sr-only">, {r.progress.text}</span></span>
                    </TableCell>
                    <TableCell label="State"><StatePill testId={tid.tonb.state(code)} state={r.person.state} /></TableCell>
                    <TableCell label="Blocking" className="text-xs">
                      <span data-testid={tid.tonb.blocking(code)}>{bl.length
                        ? `${bl.slice(0, 2).map(x => x.why).join(' · ')}${bl.length > 2 ? ` +${bl.length - 2}` : ''}`
                        : 'Nothing'}</span>
                    </TableCell>
                    <TableCell kind="foot" className="text-right whitespace-nowrap">
                      {canTrack && <span className="inline-flex gap-sm">
                        {r.canInvite && <Button testId={tid.tonb.invite(code)} kind="ghost" small pending={busy}
                          onClick={() => invite.mutate({ case: r.caseRef, personCode: code }, { onSuccess: x => toastInfo(x.summary) })}>Invite</Button>}
                        <Button testId={tid.tonb.start(code)} kind={bl.length ? 'ghost' : 'primary'} small pending={busy}
                          onClick={() => startThem(r)}>Start them</Button>
                      </span>}
                    </TableCell>
                  </Row>);
              })}
            </TableBody>
          </Table>
        : <Empty testId={tid.tonb.empty}>{d.all ? 'Nobody is onboarding at any location.' : `Nobody is onboarding at ${d.locationName}.`}{addLink && <> {addLink}</>}</Empty>}
      {dialogRow && <NotReadyDialog key={dialogRow.person.code} r={dialogRow} canChase={canTrack} onClose={closeNotReady} />}
    </AdminCard>);
}

import { useState } from 'react';
import { CircleCheck, Clock, Info } from 'lucide-react';
import { tid } from '@/testids';
import { Banner, Button, GuideButton, Page, PageHead, Seg, toastRefusal } from '@/ui';
import { useApprovalQueue, type BulkApproved, type QueueRow } from '@/api/timesheets';
import { useCurrentSession } from '@/shell/SessionProvider';
import { useTenant } from '@/shell/shellData';
import { formatDmy, periodStart } from '@/domain/timesheet';
import { TeamQueue } from './TeamQueue';
import { TeamMatrix } from './TeamMatrix';
import { BulkApproveDialog } from './TeamDialogs';

/* Team timesheets: the prototype's mgrTeamTime (qnipay-workforce-v15.html:6990-7034).
   The banner and approve-all read the pending queue, which the server scopes
   to the approver's location and which leaves out the approver's own days.
   Rows a bulk approval could not decide come back as held and stay listed
   under the banner with the reason for each (D7). */
type View = 'day' | 'week';
interface HeldRow { id: string; who: string; reason: string }
/* The approval SLA for the timesheet layer (APPROVAL_CHAIN); the approvals setup page is plan 1c. */
const SLA = '24 hours';

export function TeamTimesheetsPage() {
  const session = useCurrentSession();
  const tenant = useTenant();
  const where = session?.account.locationName || 'your location';
  const [view, setView] = useState<View>('day');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [held, setHeld] = useState<HeldRow[]>([]);
  const pend = useApprovalQueue({ status: 'pend' });
  const q = pend.data;
  const n = q?.counts.pend ?? 0;
  const today = q?.now.date;

  const listBack = (res: BulkApproved, rows: readonly QueueRow[]) => setHeld(res.held.map(h => {
    const r = rows.find(x => x.id === h.id);
    return { id: h.id, who: r ? `${r.personName} · ${formatDmy(r.date)}` : h.id, reason: h.reason };
  }));
  const openBulk = () => {
    if (!q) return;
    if (!q.bulk.ids.length) {
      toastRefusal({ message: `Nothing pending at ${where}.`, next: q.bulk.outside
        ? `${q.bulk.outside} record(s) are pending at other locations and are not yours to approve.` : 'Nothing needs a decision from you.' });
      return;
    }
    setHeld([]);
    setBulkOpen(true);
  };
  return (
    <Page testId={tid.page('tteam')}>
      <PageHead title="Team timesheets" crumb={`My team · Team timesheets${today ? ` · week commencing ${formatDmy(periodStart(today))}` : ''}`}
        tip={tenant.data ? `Timesheets awaiting a decision at ${where}, ${tenant.data.name}.` : undefined} tipTestId={tid.head.tip('tteam')}
        actions={<>
          <GuideButton view="tteam" />
          <Seg label="Show the day queue or the week" value={view} onChange={setView} testId={v => tid.tteam.view(v)}
            options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
        </>} />
      {pend.isError && <p data-testid={tid.tteam.error} role="alert" className="text-err">The queue could not be loaded. Reload the page to try again.</p>}
      {q && (n > 0
        ? <Banner testId={tid.tteam.pending} tone="warn" icon={<Clock />} title={`${n} timesheet${n > 1 ? 's' : ''} awaiting your decision`}
            actions={<Button testId={tid.tteam.approveAll} kind="primary" small onClick={openBulk}>Review and approve {q.bulk.ids.length} pending</Button>}>
            {q.oldestPending && <>The oldest was submitted on {formatDmy(q.oldestPending)}. </>}The approval SLA for this layer is {SLA}.</Banner>
        : <Banner testId={tid.tteam.clear} tone="ok" icon={<CircleCheck />} title="Nothing waiting on you">
            Every submitted timesheet for this period has been decided.</Banner>)}
      {held.length > 0 && <Banner testId={tid.tteam.held} tone="info" icon={<Info />} title={`${held.length} timesheet${held.length > 1 ? 's' : ''} held back`}>
        {held.map(h => <span key={h.id} className="block">{h.who}: {h.reason}</span>)}</Banner>}
      {view === 'day'
        ? <TeamQueue returnReasonRequired={q?.returnReasonRequired ?? true} />
        : today && <TeamMatrix today={today} self={session?.account.personCode ?? ''} rota={Boolean(tenant.data?.modules.R)} onDone={listBack} />}
      {bulkOpen && q && <BulkApproveDialog queue={q} where={where} onClose={() => setBulkOpen(false)}
        onDone={res => { listBack(res, pend.data?.rows ?? []); setBulkOpen(false); }} />}
    </Page>);
}

import { Fragment, useState } from 'react';
import { Receipt } from 'lucide-react';
import { tid } from '@/testids';
import { ActionBar, AdminCard, Banner, Button, Page, PageHead, SettingSelect, Tip, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useNotificationMatrix, useUpdateMatrix, type NotificationMatrix, type UpdateMatrix } from '@/api/notifications';
import { NOTIF_CHANNELS, NOTIF_PERSONAS, channelLabel, isNotifChannel, type NotifChannel, type NotifPersona } from '@/domain/notifications';
import { clockFromIso, formatDmy } from '@/domain/time';

/* Notifications: the prototype's admNotifications (qnipay-workforce-v15.html:
   8370-8403). One row per event this tenant can raise, grouped "<Module>
   events", one channel select per column (Employee, Manager, Admin: the
   recipient's part in the event, not their account type); a dash where the event never
   applies. Changes are held on the page and saved together with Save
   (If-Match, one audit row), where the prototype applied each select at once.
   Only In-app is delivered: an email or SMS channel is marked not connected
   (D9). While flexible-worker monitoring is on, the evidence retained for
   milestones and IT access requests follows. */
const PERSONA_LABEL: Record<NotifPersona, string> = { employee: 'Employee', manager: 'Manager', admin: 'Admin' };
type Draft = Record<string, Partial<Record<NotifPersona, NotifChannel>>>;

export function NotificationsPage() {
  const m = useNotificationMatrix();
  return (
    <Page testId={tid.page('anotif')}>
      <PageHead title="Notifications" crumb="Qnipay setup · Notifications" tipTestId={tid.anotif.tip}
        tip="One platform notification model. Every module raises events into the same framework." />
      {m.data
        ? <Matrix matrix={m.data} />
        : m.isError
          ? <p data-testid={tid.anotif.error} role="alert" className="text-err">The notification settings could not be loaded. Reload the page.</p>
          : <p data-testid={tid.anotif.loading} className="text-text-secondary">Loading the notification settings&hellip;</p>}
    </Page>);
}

function Matrix({ matrix }: { matrix: NotificationMatrix }) {
  const save = useUpdateMatrix();
  const [draft, setDraft] = useState<Draft>({});
  const changed = Object.values(draft).reduce((n, cells) => n + Object.keys(cells).length, 0);
  const choose = (code: string, p: NotifPersona, server: NotifChannel | null, v: string) => {
    if (!isNotifChannel(v)) return;
    setDraft(d => {
      const cells = Object.fromEntries(Object.entries({ ...d[code], [p]: v }).filter(([k, c]) => k !== p || c !== server));
      return Object.fromEntries(Object.entries({ ...d, [code]: cells }).filter(([, cs]) => Object.keys(cs).length > 0));
    });
  };
  const submit = () => {
    const body: UpdateMatrix = { events: draft };
    save.mutate({ body, ifMatch: matrix.version }, { onSuccess: r => { setDraft({}); toastInfo(r.message, 'It applies to every notification raised from now on.'); } });
  };
  const modules = [...new Set(matrix.events.map(e => e.module))];
  return (
    <>
      <Banner tone="info" testId={tid.anotif.notConnected} title="Only in-app notifications are delivered">
        Email and SMS are not connected yet. A channel that includes them is recorded as not connected, and nothing is sent.
      </Banner>
      <Table variant="matrix" data-testid={tid.anotif.table}>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-[1] bg-surface-card">Event</TableHead>
            {NOTIF_PERSONAS.map(p => <TableHead key={p} className="w-[170px]">{PERSONA_LABEL[p]}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {modules.map(mod => (
            <Fragment key={mod}>
              <TableRow data-testid={tid.anotif.group(mod)}>
                <TableCell colSpan={4} className="pt-lg pb-xs text-xs font-[650] text-text-secondary">{mod} events</TableCell>
              </TableRow>
              {matrix.events.filter(e => e.module === mod).map(e => (
                <TableRow key={e.code} data-testid={tid.anotif.row(e.code)}>
                  <TableCell className="sticky left-0 z-[1] bg-inherit"><b className="font-semibold">{e.label}</b><span className="block text-xs text-text-muted">{e.description}</span></TableCell>
                  {NOTIF_PERSONAS.map(p => {
                    const server = e.channels[p];
                    if (server === null) return (
                      <TableCell key={p}><span className="inline-flex items-center gap-xs text-xs text-text-muted"><span aria-hidden="true">—</span>
                        <Tip testId={tid.anotif.never(e.code, p)} text="This event never applies to that role." /></span></TableCell>);
                    const value = draft[e.code]?.[p] ?? server;
                    return (
                      <TableCell key={p}>
                        <SettingSelect small testId={tid.anotif.cell(e.code, p)} aria-label={`${e.label} for ${PERSONA_LABEL[p]}`} value={value}
                          disabled={save.anyPending} onChange={ev => choose(e.code, p, server, ev.target.value)}
                          className={draft[e.code]?.[p] !== undefined ? 'border-brand dark:border-brand-accent' : undefined}>
                          {NOTIF_CHANNELS.map(c => <option key={c} value={c}>{channelLabel(c)}</option>)}
                        </SettingSelect>
                      </TableCell>);
                  })}
                </TableRow>))}
            </Fragment>))}
        </TableBody>
      </Table>
      {matrix.evidence && <Evidence rows={matrix.evidence} />}
      <ActionBar stuck={changed > 0}>
        {changed > 0 && <span className="mr-auto text-xs text-text-muted">{changed === 1 ? '1 change' : `${changed} changes`} not saved yet</span>}
        <Button testId={tid.anotif.cancel} kind="ghost" disabled={!changed || save.anyPending} onClick={() => setDraft({})}>Cancel</Button>
        <Button testId={tid.anotif.save} kind="primary" disabled={!changed || save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>
    </>);
}

function Evidence({ rows }: { rows: NonNullable<NotificationMatrix['evidence']> }) {
  const when = (at: string) => { const c = clockFromIso(at); return `${formatDmy(c.date)} ${c.time}`; };
  return (
    <AdminCard testId={tid.anotif.evidence} icon={<Receipt />} title="Notification evidence" tipTestId={tid.anotif.evidenceTip}
      tip="Retained for audit: employee, milestone, timestamp, recipient, channel and reference."
      desc="Evidence retained for flexible-worker milestones and IT access requests">
      <Table variant="records">
        <TableHeader><TableRow>
          {['Employee', 'Employee ID', 'Event', 'Timestamp', 'Recipient', 'Channel', 'Reference'].map(h => <TableHead key={h}>{h}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.ref} data-testid={tid.anotif.evidenceRow(r.ref)}>
              <TableCell kind="title">{r.employee}</TableCell><TableCell label="Employee ID" className="tabular-nums">{r.employeeId}</TableCell>
              <TableCell label="Event">{r.event}</TableCell><TableCell label="Timestamp" className="text-xs tabular-nums">{when(r.at)}</TableCell>
              <TableCell label="Recipient" className="text-xs">{r.recipient}</TableCell><TableCell label="Channel" className="text-xs">{r.channel}</TableCell>
              <TableCell label="Reference" className="text-xs tabular-nums">{r.ref}</TableCell>
            </TableRow>))}
        </TableBody>
      </Table>
    </AdminCard>);
}

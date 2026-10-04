import { useState } from 'react';
import { tid } from '@/testids';
import { Card, FilterBar, Page, PageHead, Row, SearchFilter, SelectFilter } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useAudit, type AuditEntry } from '@/api/audit';
import { formatDateTime, describeChange } from '@/lib/format';

/* The entities the session, view-as, access and plan 1b handlers write (see
   mocks/session.ts, access.ts, people.ts and the rest). A future handler adding a new kind of
   audited change should add its label here too. */
const ENTITY_OPTIONS = [
  { value: 'all', label: 'All records' },
  { value: 'userType', label: 'Permission templates' },
  { value: 'account', label: 'User accounts' },
  { value: 'session', label: 'Sessions and view-as' },
  { value: 'person', label: 'People' },
  { value: 'profileChange', label: 'Profile changes' },
  { value: 'employeeType', label: 'Employee types' },
  { value: 'location', label: 'Locations' },
  { value: 'department', label: 'Departments' },
  { value: 'costCentre', label: 'Cost centres' },
  { value: 'jobProfile', label: 'Job profiles' },
  { value: 'project', label: 'Projects' },
  { value: 'timesheetDay', label: 'Timesheets' },
  { value: 'timesheetConfig', label: 'Timesheet setup' },
  { value: 'integrationAttempt', label: 'Business Central postings' },
  { value: 'tenant', label: 'Modules, features and tenant settings' },
  { value: 'savedData', label: 'Saved data' },
  { value: 'template', label: 'Templates' },
  { value: 'notice', label: 'Notices' },
];
const ENTITY_LABEL: Record<string, string> = { userType: 'Permission template', account: 'User account', session: 'Session',
  person: 'Person', profileChange: 'Profile change', employeeType: 'Employee type', location: 'Location', department: 'Department',
  costCentre: 'Cost centre', jobProfile: 'Job profile', project: 'Project', timesheetDay: 'Timesheet',
  timesheetConfig: 'Timesheet setup', integrationAttempt: 'Business Central posting', tenant: 'Tenant', savedData: 'Saved data', template: 'Template', notice: 'Notice' };

const whoLabel = (who: AuditEntry['who']) => (who.viewingAs ? `${who.name} (as ${who.viewingAs})` : who.name);
const recordLabel = (e: AuditEntry) => `${ENTITY_LABEL[e.entity] ?? e.entity}: ${e.entityId}`;
/* The prototype's Detail column: everything about the change beyond who and
   what, in one muted line. Here that is the record, the change and the reason. */
const detail = (e: AuditEntry) => [recordLabel(e), describeChange(e.before, e.after), e.reason].filter(Boolean).join(' · ');

/* Ported from the prototype's admAudit (qnipay-workforce-v15.html:9682-9688):
   When (12px muted), Who, Action, Detail (12px muted). The filters the spec
   asks for sit above it as the prototype's filter bar of 32px pills. On a
   phone the log is a record list (table.rec): each entry a card titled with
   its date and time, Who and Action labelled, the detail at its foot. One
   row, one data-testid, at every width. */
export function AuditPage() {
  const [entity, setEntity] = useState('all');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const audit = useAudit({ entity: entity === 'all' ? undefined : entity, who: who.trim() || undefined, q: q.trim() || undefined });

  return (
    <Page testId={tid.page('iaudit')}>
      <PageHead title="Audit log" crumb="Qnipay setup · Audit log" tip="Every state change anyone makes, newest first, with who acted and when."
        tipTestId={tid.head.tip('iaudit')} />

      <FilterBar>
        <SelectFilter testId={tid.audit.filterEntity} label="Record type" value={entity} onValueChange={setEntity} options={ENTITY_OPTIONS} />
        <SearchFilter testId={tid.audit.filterWho} label="Who" value={who} onChange={e => setWho(e.target.value)} placeholder="Who" />
        <SearchFilter testId={tid.audit.filterText} label="Search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search the log" />
      </FilterBar>

      {audit.isPending && <p className="text-text-secondary">Loading the audit log&hellip;</p>}

      {audit.isError && (
        <p data-testid={tid.audit.error} className="text-err">
          The audit log could not be loaded. Nothing on screen has changed. Reload the page to try again.
        </p>
      )}

      {audit.isSuccess && audit.data.items.length === 0 && (
        <Card><p className="px-lg py-2xl text-center text-text-muted">Nothing recorded yet. Every change anyone makes appears here.</p></Card>
      )}

      {audit.isSuccess && audit.data.items.length > 0 && (
        <Table data-testid={tid.audit.table} variant="records">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.data.items.map(entry => (
              <Row key={entry.id} testId={tid.audit.row(entry.id)}>
                <TableCell kind="title" className="text-xs whitespace-nowrap text-text-muted tabular-nums max-md:text-sm max-md:text-text-primary">{formatDateTime(entry.at)}</TableCell>
                <TableCell label="Who">{whoLabel(entry.who)}</TableCell>
                <TableCell label="Action">{entry.act}</TableCell>
                <TableCell kind="foot" empty={!detail(entry)} className="text-xs text-text-muted">{detail(entry)}</TableCell>
              </Row>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>);
}

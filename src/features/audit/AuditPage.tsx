import { useState } from 'react';
import { tid } from '@/testids';
import { Field, TextInput, SelectBox } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useAudit, type AuditEntry } from '@/api/audit';
import { formatDateTime, describeChange } from '@/lib/format';

/* The entities the session, view-as and access handlers write today (see
   mocks/session.ts and mocks/access.ts). A future handler adding a new kind of
   audited change should add its label here too. */
const ENTITY_OPTIONS = [
  { value: 'all', label: 'All records' },
  { value: 'userType', label: 'Permission templates' },
  { value: 'account', label: 'User accounts' },
  { value: 'session', label: 'Sessions and view-as' },
];
const ENTITY_LABEL: Record<string, string> = { userType: 'Permission template', account: 'User account', session: 'Session' };

const whoLabel = (who: AuditEntry['who']) => (who.viewingAs ? `${who.name} (as ${who.viewingAs})` : who.name);
const recordLabel = (e: AuditEntry) => `${ENTITY_LABEL[e.entity] ?? e.entity}: ${e.entityId}`;

/* Ported from the prototype's table.rec: below the md breakpoint the whole
   table switches to `block` display, so its thead/tbody/tr/td can become a
   stacked card per row (a labelled key next to each value) without the CSS
   table layout algorithm fighting that. At md and up it reverts to a normal
   table. One row, one data-testid, at every width. */
export function AuditPage() {
  const [entity, setEntity] = useState('all');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const audit = useAudit({ entity: entity === 'all' ? undefined : entity, who: who.trim() || undefined, q: q.trim() || undefined });

  return (
    <section data-testid={tid.page('iaudit')} className="mx-auto flex max-w-5xl flex-col gap-lg p-xl">
      <div>
        <h1 className="text-[length:var(--qp-text-20)] font-semibold">Audit log</h1>
        <p className="text-text-secondary">Every state change anyone makes, newest first.</p>
      </div>

      <div className="grid grid-cols-1 gap-sm md:grid-cols-3">
        <Field testId="audit-filter-entity-field" label="Record type">
          <SelectBox testId={tid.audit.filterEntity} value={entity} onValueChange={setEntity} options={ENTITY_OPTIONS} />
        </Field>
        <Field testId="audit-filter-who-field" label="Who">
          <TextInput testId={tid.audit.filterWho} value={who} onChange={e => setWho(e.target.value)} placeholder="Name" />
        </Field>
        <Field testId="audit-filter-text-field" label="Search">
          <TextInput testId={tid.audit.filterText} value={q} onChange={e => setQ(e.target.value)} placeholder="Action, record or reason" />
        </Field>
      </div>

      {audit.isPending && <p className="text-text-secondary">Loading the audit log&hellip;</p>}

      {audit.isError && (
        <p data-testid={tid.audit.error} className="text-err">
          The audit log could not be loaded. Nothing on screen has changed. Reload the page to try again.
        </p>
      )}

      {audit.isSuccess && audit.data.items.length === 0 && (
        <p className="text-text-secondary">Nothing recorded yet. Every change anyone makes appears here.</p>
      )}

      {audit.isSuccess && audit.data.items.length > 0 && (
        <div className="rounded-card border border-border md:overflow-x-auto">
          <Table data-testid={tid.audit.table} className="block md:table">
            <TableHeader className="hidden md:table-header-group">
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group">
              {audit.data.items.map(entry => (
                <TableRow key={entry.id} data-testid={tid.audit.row(entry.id)}
                  className="mb-sm block rounded-card border border-border p-sm md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:p-0">
                  <TableCell className="flex items-baseline justify-between gap-sm md:table-cell">
                    <span className="text-xs font-semibold text-text-secondary md:hidden">When</span>
                    <span>{formatDateTime(entry.at)}</span>
                  </TableCell>
                  <TableCell className="flex items-baseline justify-between gap-sm md:table-cell">
                    <span className="text-xs font-semibold text-text-secondary md:hidden">Who</span>
                    <span>{whoLabel(entry.who)}</span>
                  </TableCell>
                  <TableCell className="flex items-baseline justify-between gap-sm md:table-cell">
                    <span className="text-xs font-semibold text-text-secondary md:hidden">What</span>
                    <span>{entry.act}</span>
                  </TableCell>
                  <TableCell className="flex items-baseline justify-between gap-sm md:table-cell">
                    <span className="text-xs font-semibold text-text-secondary md:hidden">Record</span>
                    <span>{recordLabel(entry)}</span>
                  </TableCell>
                  <TableCell className="flex items-baseline justify-between gap-sm md:table-cell">
                    <span className="text-xs font-semibold text-text-secondary md:hidden">Change</span>
                    <span>{describeChange(entry.before, entry.after)}</span>
                  </TableCell>
                  <TableCell className="flex items-baseline justify-between gap-sm md:table-cell">
                    <span className="text-xs font-semibold text-text-secondary md:hidden">Reason</span>
                    <span>{entry.reason ?? '—'}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>);
}

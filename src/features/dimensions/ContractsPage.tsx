import { useState } from 'react';
import { tid } from '@/testids';
import type { Employee } from '@/contract/employees';
import { Button, Field, FormWarn, GuideButton, Modal, NavLink, Page, PageHead, Row, UnitInput, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useEmployees, useUpdateEmployee } from '@/api/employees';
import { formatDate } from '@/lib/format';
import { latest, versionKey } from '@/lib/latest';
import { StatePill } from '@/features/employees/StatePill';
import { useTenant } from '@/api/tenant';
import { DEFAULT_FULL_TIME_WEEKLY_HOURS } from '@/domain/leave';

const basis = (h: number, fullTime: number) => (h >= fullTime ? 'Full time' : h > 0 ? 'Part time' : 'No contracted hours');

/* Ported from the prototype's admContracts (qnipay-workforce-v15.html:8284-
   8297): contracted hours, the one baseline Rota, Timesheet and Leave compare
   against. The prototype's inline input wrote on every keystroke without an
   audit; here Edit opens the contract and saves it through the employee
   record, with If-Match and field history (plan 1b decision D2). Working
   patterns belong to Rota, which is not built. */
export function ContractsPage() {
  const employees = useEmployees('all', '');
  const tenant = useTenant();
  const fullTimeHours = tenant.data?.fullTimeWeeklyHours ?? DEFAULT_FULL_TIME_WEEKLY_HOURS;
  const [held, setEditing] = useState<Employee | null>(null);
  /* the form works on the record as last read, and starts again when it changes */
  const editing = held && latest(held, employees.data);
  return (
    <Page testId={tid.page('acon')}>
      <PageHead title="Contracts" crumb="Qnipay setup · Contracts" tipTestId={tid.head.tip('acon')}
        tip="Contracted hours: the common baseline for every comparison Timesheet and Rota make." actions={<GuideButton view="acon" />} />
      {/* D3: full time is the tenant's one full-time week, set on Calendar */}
      {tenant.data && <p className="mb-md text-xs text-text-muted"><span data-testid={tid.contracts.fullTime}>Full time is {fullTimeHours} hours a week or more.</span>{' '}
        <NavLink testId={tid.contracts.fullTimeLink} to="/setup/acal" className="font-semibold text-brand underline dark:text-brand-accent">Change it on Calendar</NavLink></p>}
      {employees.isPending && <p className="text-text-secondary">Loading&hellip;</p>}
      {employees.isError && <p data-testid={tid.contracts.error} role="alert" className="text-err">The contracts could not be loaded, so nothing here is current. Reload the page.</p>}
      {employees.data && (
        <Table data-testid={tid.contracts.table} variant="records" dense>
          <TableHeader><TableRow>
            <TableHead>Employee</TableHead><TableHead>Employee ID</TableHead><TableHead>Category</TableHead>
            <TableHead className="text-right">Contracted</TableHead><TableHead className="text-right">Maximum</TableHead>
            <TableHead>Full or part time</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>State</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{employees.data.map(p => (
            <Row key={p.id} testId={tid.contracts.row(p.code)}>
              <TableCell kind="title"><strong className="font-semibold">{p.name}</strong></TableCell>
              <TableCell label="Employee ID" className="tabular-nums">{p.code}</TableCell>
              <TableCell label="Category">{p.category}</TableCell>
              <TableCell label="Contracted" className="text-right tabular-nums max-md:text-left">{p.contractedHours} h</TableCell>
              <TableCell label="Maximum" className="text-right tabular-nums max-md:text-left">{p.maxHours} h</TableCell>
              <TableCell label="Full or part time" className="text-xs text-text-muted">{basis(p.contractedHours, fullTimeHours)}</TableCell>
              <TableCell label="Start" className="text-xs tabular-nums">{formatDate(p.start)}</TableCell>
              <TableCell label="End" empty={!p.end} className="text-xs tabular-nums">{formatDate(p.end)}</TableCell>
              <TableCell label="State"><StatePill testId={tid.contracts.state(p.code)} state={p.state} /></TableCell>
              <TableCell kind="foot" className="text-right"><Button testId={tid.contracts.edit(p.code)} kind="ghost" small onClick={() => setEditing(p)}>Edit</Button></TableCell>
            </Row>))}</TableBody>
        </Table>)}
      {editing && <ContractForm key={versionKey(editing)} employee={editing} onClose={() => setEditing(null)} />}
    </Page>);
}

function ContractForm({ employee, onClose }: { employee: Employee; onClose(): void }) {
  const [hours, setHours] = useState(String(employee.contractedHours));
  const [max, setMax] = useState(String(employee.maxHours));
  const save = useUpdateEmployee();
  const submit = () => save.mutate({ employee, body: { contractedHours: Number(hours || 0), maxHours: Number(max || 0) } }, {
    onSuccess: d => { toastInfo(d.changed.length ? `${d.record.name} updated · ${d.changed.length} field(s) changed` : `${d.record.name} · nothing changed`); onClose(); },
  });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`${employee.name} · contract`}
      description="Rota compares scheduled hours against these, Timesheet compares actual hours, and Leave pro-rates entitlement from them."
      footer={<>
        <Button testId={tid.contracts.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.contracts.save} kind="primary" pending={save.anyPending} onClick={submit}>Save changes</Button></>}>
      <div className="grid grid-cols-2 gap-md max-md:grid-cols-1">
        <Field label="Contracted hours" error={save.fieldError('contractedHours')}>
          <UnitInput testId={tid.contracts.hours} unit="h / week" type="number" inputMode="decimal" step="0.5" min="0" max="80" value={hours} onChange={e => setHours(e.target.value)} /></Field>
        <Field label="Maximum hours" error={save.fieldError('maxHours')}>
          <UnitInput testId={tid.contracts.max} unit="h / week" type="number" inputMode="decimal" step="0.5" min="0" max="80" value={max} onChange={e => setMax(e.target.value)} /></Field>
      </div>
      {save.refusal && <FormWarn testId={tid.contracts.warn}>{save.refusal.message}</FormWarn>}
    </Modal>);
}

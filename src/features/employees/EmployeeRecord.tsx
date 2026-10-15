import type { ReactNode } from 'react';
import { tid } from '@/testids';
import type { HistoryEntry, Employee } from '@/contract/employees';
import { Avatar, Button, Fact, GroupLabel, Modal, Small } from '@/ui';
import { useHistory, useEmployee } from '@/api/employees';
import { useNames } from '@/api/reference';
import { fieldLabel } from '@/domain/history';
import { LIFECYCLE, isEmployeeState } from '@/domain/lifecycle';
import { formatDate, formatDateTime } from '@/lib/format';
import { StatePill } from './StatePill';

export const perWeek = (h: number, none: string) => (h > 0 ? `${h} h per week` : none);
const shown = (field: string, v: string) => (!v ? '—' : field === 'state' && isEmployeeState(v) ? LIFECYCLE[v].label : v);
/* one text node, so it reads (and is found) as one line: "Contracted hours: 37.5 → 30" */
export const historyLine = (h: HistoryEntry) => `${fieldLabel(h.field)}: ${shown(h.field, h.from)} → ${shown(h.field, h.to)}`;

/* Ported from the prototype's employeeBox (qnipay-workforce-v15.html:10204-
   10244): the employee's name, role and site under an avatar with their state
   beside it, then the shared workforce record, one fact to a line. The rota,
   timesheet and leave figures the prototype showed belong to modules not
   built yet, so this build shows the contract and the record's own field
   history instead. */
export function EmployeeRecord({ employeeId, onClose, actions }: { employeeId: string; onClose(): void; actions?: (p: Employee) => ReactNode }) {
  const employee = useEmployee(employeeId), history = useHistory(employeeId), names = useNames();
  const p = employee.data;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={p?.name ?? 'Employee'}
      footer={<>
        <Button testId={tid.employee.close} kind="ghost" onClick={onClose}>Close</Button>
        {p && actions?.(p)}</>}>
      {employee.isPending && <p className="text-text-secondary">Loading the record&hellip;</p>}
      {employee.isError && <p data-testid={tid.employee.error} role="alert" className="text-err">This record could not be loaded. Close it and try again.</p>}
      {p && <div data-testid={tid.employee.record}>
        <div className="mb-lg flex flex-wrap items-center gap-md">
          <Avatar name={p.name} large />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{p.name}</div>
            <Small>{names.job(p.jobProfile)} · {names.type(p.employeeType)} · {names.location(p.location)} · <span className="tabular-nums">{p.code}</span></Small>
          </div>
          <div className="ml-auto"><StatePill testId={tid.employee.state} state={p.state} /></div>
        </div>
        <GroupLabel>Shared workforce record</GroupLabel>
        <Fact label="Work email" testId={tid.employee.fact('email')}>{p.email || '—'}</Fact>
        <Fact label="Employee type" testId={tid.employee.fact('employeeType')}>{names.type(p.employeeType)}</Fact>
        <Fact label="Job profile" testId={tid.employee.fact('jobProfile')}>{names.job(p.jobProfile)}</Fact>
        <Fact label="Department" testId={tid.employee.fact('department')}>{names.department(p.department)}</Fact>
        <Fact label="Location" testId={tid.employee.fact('location')}>{names.location(p.location)}</Fact>
        <Fact label="Line manager" testId={tid.employee.fact('manager')}>{p.manager || '—'}</Fact>
        <Fact label="Business Central resource no." testId={tid.employee.fact('resource')}>{p.resource || '—'}</Fact>

        <GroupLabel className="mt-lg">Contract</GroupLabel>
        <Fact label="Worker category" testId={tid.employee.fact('category')}>{p.category}</Fact>
        <Fact label="Contracted hours" testId={tid.employee.fact('contractedHours')}>{perWeek(p.contractedHours, `${p.category} · no contracted hours`)}</Fact>
        <Fact label="Maximum hours" testId={tid.employee.fact('maxHours')}>{perWeek(p.maxHours, 'No maximum set')}</Fact>
        <Fact label="Employment" testId={tid.employee.fact('employment')}>{formatDate(p.start)}{p.end ? ` to ${formatDate(p.end)}` : ''}</Fact>

        <div data-testid={tid.employee.history}>
          <GroupLabel className="mt-lg">History</GroupLabel>
          {history.data?.length
            ? <ul className="flex flex-col">{history.data.map(h => (
              <li key={h.id} data-testid={tid.employee.historyRow(h.id)} className="border-b py-sm text-sm last:border-b-0">
                <div>{historyLine(h)}</div>
                <Small>{formatDateTime(h.at)} · {h.by.name}{h.reason ? ` · ${h.reason}` : ''}</Small>
              </li>))}</ul>
            : <Small>No changes recorded yet.</Small>}
        </div>
      </div>}
    </Modal>);
}

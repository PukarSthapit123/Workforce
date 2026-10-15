import { useState, type ReactNode } from 'react';
import { tid } from '@/testids';
import type { Employee } from '@/contract/employees';
import { LIFECYCLE, EMPLOYEE_STATES } from '@/domain/lifecycle';
import { Button, Card, Count, Empty, FilterBar, EmployeeName, Row, SearchFilter, SelectFilter } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useEmployees, type StateFilter } from '@/api/employees';
import { useDimension, useEmployeeTypes, useNames } from '@/api/reference';
import { StatePill } from './StatePill';

/* The prototype's state filter (mgrEmployees, v15:7640-7644): the default is
   the employees who are actually here; leavers and archived records are
   reachable, not in the way. */
const STATE_OPTIONS = [{ value: 'here', label: 'Currently here' },
  ...EMPLOYEE_STATES.map(s => ({ value: s, label: LIFECYCLE[s].label })), { value: 'all', label: 'Every state' }];
const ALL = 'all';
const isStateFilter = (v: string): v is StateFilter => v === 'here' || v === ALL || (EMPLOYEE_STATES as readonly string[]).includes(v);

/* Ported from admEmployees (v15:8041-8084) and mgrEmployees (7613-7665). Admin:
   Employee ID, Name, Employee type, Department, Location, Manager, State.
   Team: Name, Employee ID, Employee type, State. Who somebody is, never what
   they are contracted to: hours live on the record and on Contracts. The
   prototype's inline type and location selects wrote on every change without
   an audit, so here they are read-only and changed through Edit. */
export function EmployeesList({ variant, total, onOpen, actions }: {
  variant: 'admin' | 'team'; total?: number; onOpen(p: Employee): void; actions?: (p: Employee) => ReactNode;
}) {
  const [state, setState] = useState<StateFilter>('here');
  const [q, setQ] = useState('');
  const [loc, setLoc] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const list = useEmployees(state, q.trim()), names = useNames();
  const locations = useDimension('locations'), types = useEmployeeTypes();
  const rows = (list.data ?? []).filter(p => (loc === ALL || p.location === loc) && (type === ALL || p.employeeType === type)
    && (category === ALL || p.category === category));
  const team = variant === 'team';
  return (
    <>
      <FilterBar>
        <SearchFilter testId={tid.employees.search} label="Search employees" value={q} onChange={e => setQ(e.target.value)}
          placeholder={team ? 'Search name or ID' : 'Search name, ID or job profile'} />
        {team
          ? <SelectFilter testId={tid.employees.categoryFilter} label="Worker category" value={category} onValueChange={setCategory}
              options={[{ value: ALL, label: 'Everyone' }, { value: 'Contracted', label: 'Contracted' }, { value: 'Bank', label: 'Bank' }]} />
          : <>
            <SelectFilter testId={tid.employees.locationFilter} label="Location" value={loc} onValueChange={setLoc}
              options={[{ value: ALL, label: 'All locations' }, ...(locations.data ?? []).map(l => ({ value: l.code, label: l.name }))]} />
            <SelectFilter testId={tid.employees.typeFilter} label="Employee type" value={type} onValueChange={setType}
              options={[{ value: ALL, label: 'All employee types' }, ...(types.data ?? []).map(t => ({ value: t.code, label: t.name }))]} />
          </>}
        <SelectFilter testId={tid.employees.stateFilter} label="State" value={state} options={STATE_OPTIONS}
          onValueChange={v => { if (isStateFilter(v)) setState(v); }} />
        {list.data && <Count testId={tid.employees.count}>{rows.length} of {total ?? list.data.length}</Count>}
      </FilterBar>

      {list.isPending && <p className="text-text-secondary">Loading employees&hellip;</p>}
      {list.isError && <p data-testid={tid.employees.error} role="alert" className="text-err">
        The employees list could not be loaded, so nothing here is current. Reload the page to try again.</p>}
      {list.isSuccess && rows.length === 0 && <Card><Empty testId={tid.employees.empty}>Nobody matches that filter.</Empty></Card>}
      {list.isSuccess && rows.length > 0 && (
        <Table data-testid={tid.employees.table} variant="records" dense>
          <TableHeader>
            <TableRow>
              {team ? <><TableHead>Name</TableHead><TableHead>Employee ID</TableHead></>
                : <><TableHead>Employee ID</TableHead><TableHead>Name</TableHead></>}
              <TableHead>Employee type</TableHead>
              {!team && <><TableHead>Department</TableHead><TableHead>Location</TableHead><TableHead>Manager</TableHead></>}
              <TableHead>State</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(p => {
              const code = <TableCell label="Employee ID" className="tabular-nums">{p.code}</TableCell>;
              return (
                <Row key={p.id} testId={tid.employees.row(p.code)}>
                  {team ? null : code}
                  <TableCell kind="title"><EmployeeName name={p.name} /></TableCell>
                  {team ? code : null}
                  <TableCell label="Employee type">{names.type(p.employeeType)}</TableCell>
                  {!team && <>
                    <TableCell label="Department" className="text-text-muted">{names.department(p.department)}</TableCell>
                    <TableCell label="Location">{names.location(p.location)}</TableCell>
                    <TableCell label="Manager" empty={!p.manager} className="text-text-muted">{p.manager || '—'}</TableCell>
                  </>}
                  <TableCell label="State"><StatePill testId={tid.employees.state(p.code)} state={p.state} withNote /></TableCell>
                  <TableCell kind="foot" className="text-right whitespace-nowrap">
                    <span className="inline-flex gap-xs">{actions?.(p)}
                      <Button testId={tid.employees.open(p.code)} kind="ghost" small onClick={() => onOpen(p)}>Open</Button></span>
                  </TableCell>
                </Row>);
            })}
          </TableBody>
        </Table>)}
    </>);
}

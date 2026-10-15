import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { tid } from '@/testids';
import type { Employee } from '@/contract/employees';
import { Button, GuideButton, Page, PageHead } from '@/ui';
import { useEmployees } from '@/api/employees';
import { useCaps } from '@/shell/useCaps';
import { useCurrentSession } from '@/shell/SessionProvider';
import { useTenant } from '@/shell/shellData';
import { ProxyEntry, type ProxyTarget } from '@/features/timesheet/ProxyEntry';
import { latest, versionKey } from '@/lib/latest';
import { EmployeesList } from './EmployeesList';
import { EmployeeRecord } from './EmployeeRecord';
import { EmployeeForm } from './EmployeeForm';
import { LifecycleDialog } from './LifecycleDialog';

/* The list, the record, the form and the lifecycle dialog together, shared
   by Qnipay setup · Employees and My team · Employees. Add and Edit show only to a
   holder of emp_crud; the server refuses anything shown by mistake. */
export function EmployeesWorkspace({ variant, view, crumb, tip, above }: {
  variant: 'admin' | 'team'; view: string; crumb: string; tip: string; above?: ReactNode;
}) {
  const caps = useCaps(), crud = caps.has('emp_crud');
  const self = useCurrentSession()?.account.employeeCode, modules = useTenant().data?.modules;
  /* proxy entry (proxyBox): a manager entering time for someone they look after, while a timesheet module is on */
  const proxyOk = variant === 'team' && caps.has('proxy') && caps.has('team_ts') && Boolean(modules?.A || modules?.B);
  const [proxy, setProxy] = useState<ProxyTarget | null>(null);
  const everyone = useEmployees(variant === 'admin' ? 'all' : 'here', '');
  const [open, setOpen] = useState<string | null>(null);
  /* An employee deep link (?employee=<employee ID>, the prototype's #/employees/<id>)
     opens that record, when the employee is on this list; closing it drops the link. */
  const [params, setParams] = useSearchParams();
  const linked = params.get('employee');
  const linkedId = linked ? everyone.data?.find(p => p.code === linked)?.id ?? null : null;
  const shown = open ?? linkedId;
  const close = () => {
    setOpen(null);
    if (linked) setParams(prev => { const next = new URLSearchParams(prev); next.delete('employee'); return next; }, { replace: true });
  };
  const [form, setForm] = useState<{ employee?: Employee } | null>(null);
  const [moving, setMoving] = useState<Employee | null>(null);
  /* a manager adds employees at their own location, so the form starts there */
  const defaultLocation = variant === 'team' ? everyone.data?.[0]?.location : undefined;
  /* the dialogs work on the record as last read, and start again when it changes */
  const editing = form?.employee && latest(form.employee, everyone.data);
  const move = moving && latest(moving, everyone.data);
  const add = crud && (variant === 'admin'
    ? <Button testId={tid.employees.add} kind="ghost" small onClick={() => setForm({})}>Add employee</Button>
    : <Button testId={tid.employees.add} kind="primary" small onClick={() => setForm({})}>Add someone</Button>);
  return (
    <Page testId={tid.page(view)}>
      {above}
      <PageHead title="Employees" crumb={crumb} tip={tip} tipTestId={tid.head.tip(view)} actions={<>{add}<GuideButton view={view} /></>} />
      <EmployeesList variant={variant} total={everyone.data?.length} onOpen={p => setOpen(p.id)}
        actions={crud ? p => <Button testId={tid.employees.edit(p.code)} kind="ghost" small onClick={() => setForm({ employee: p })}>Edit</Button> : undefined} />
      {shown && <EmployeeRecord employeeId={shown} onClose={close} actions={crud || proxyOk ? p => <>
        {crud && <Button testId={tid.employee.changeState} kind="ghost" onClick={() => { close(); setMoving(p); }}>Change state</Button>}
        {proxyOk && p.code !== self && <Button testId={tid.proxy.open} kind={crud ? 'secondary' : 'primary'}
          onClick={() => { close(); setProxy({ code: p.code, name: p.name }); }}>Enter time on their behalf</Button>}
        {crud && <Button testId={tid.employee.edit} kind="primary" onClick={() => { close(); setForm({ employee: p }); }}>Edit</Button>}</> : undefined} />}
      {proxy && <ProxyEntry employee={proxy} onClose={() => setProxy(null)} />}
      {form && <EmployeeForm key={editing ? versionKey(editing) : 'new'} employee={editing} defaultLocation={defaultLocation} onClose={() => setForm(null)}
        onChangeState={p => { setForm(null); setMoving(p); }} />}
      {move && <LifecycleDialog key={versionKey(move)} employee={move} onClose={() => setMoving(null)} />}
    </Page>);
}

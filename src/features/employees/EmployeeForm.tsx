import { useState } from 'react';
import { tid } from '@/testids';
import type { Employee } from '@/contract/employees';
import { Button, Combobox, Field, FormSection, FormWarn, Modal, SelectBox, Small, SwitchField, TextInput, UnitInput, toastInfo } from '@/ui';
import { useCreateEmployee, useEmployees, useNextCode, useUpdateEmployee } from '@/api/employees';
import { useDimension, useEmployeeTypes } from '@/api/reference';
import { useCaps } from '@/shell/useCaps';
import { LIFECYCLE, STARTING_STATES } from '@/domain/lifecycle';
import { todayIso } from '@/lib/format';

type UserType = 'employee' | 'manager' | 'admin';
type Start = (typeof STARTING_STATES)[number];
interface Draft {
  code: string; name: string; email: string; phone: string; resource: string; cis: boolean;
  employeeType: string; jobProfile: string; location: string; department: string; manager: string; start: string;
  category: string; contractedHours: string; maxHours: string; night: boolean; userType: UserType; state: Start;
}
const NONE = 'none';
const CATEGORIES = ['Contracted', 'Bank', 'Agency', 'Salaried'].map(c => ({ value: c, label: c }));
const USER_TYPES = [{ value: 'employee', label: 'Employee' }, { value: 'manager', label: 'Manager' }, { value: 'admin', label: 'Admin' }];
const isUserType = (v: string): v is UserType => USER_TYPES.some(u => u.value === v);
const isStart = (v: string): v is Start => (STARTING_STATES as readonly string[]).includes(v);
const fromEmployee = (p: Employee): Draft => ({ code: p.code, name: p.name, email: p.email, phone: p.phone, resource: p.resource, cis: p.cis,
  employeeType: p.employeeType, jobProfile: p.jobProfile, location: p.location, department: p.department, manager: p.manager, start: p.start,
  category: p.category, contractedHours: String(p.contractedHours), maxHours: String(p.maxHours), night: p.night,
  userType: p.userType ?? 'employee', state: 'candidate' });
const hours = (s: string) => (s.trim() === '' ? 0 : Number(s));
const close = (onClose: () => void) => (o: boolean) => { if (!o) onClose(); };

/* Loads what the form needs, then renders it with its first values, so no
   effect has to patch state in later. */
export function EmployeeForm({ employee, defaultLocation, startState = 'candidate', onClose, onChangeState }: {
  employee?: Employee; defaultLocation?: string;
  /* the starting state a new record opens with: the onboarding tracker's "Add a new starter" presets candidate, as the prototype's employeeBox(null, state) does */
  startState?: Start; onClose(): void; onChangeState?(p: Employee): void;
}) {
  const next = useNextCode(!employee), types = useEmployeeTypes(), locs = useDimension('locations');
  const ready = (employee || next.data) && types.data && locs.data;
  if (!ready) return <Modal open onOpenChange={close(onClose)} title={employee ? employee.name : 'Add someone'} width="wide"><p className="text-text-secondary">Loading&hellip;</p></Modal>;
  const firstType = types.data?.[0];
  const initial: Draft = employee ? fromEmployee(employee) : {
    code: next.data?.code ?? '', name: '', email: '', phone: '', resource: '', cis: false,
    employeeType: firstType?.code ?? '', jobProfile: '', location: defaultLocation ?? locs.data?.[0]?.code ?? '', department: '', manager: '', start: todayIso(),
    category: firstType?.category ?? 'Contracted', contractedHours: '0', maxHours: '48', night: false, userType: 'employee', state: startState };
  return <EmployeeFormBody employee={employee} initial={initial} onClose={onClose} onChangeState={onChangeState} />;
}

/* Ported from the prototype's employeeBox (qnipay-workforce-v15.html:10133-
   10203): Identity, Employment, Contract and Access, two columns of fields.
   Validation is the server's (plan 1b decision D10): a refusal is shown
   against its field and under the form, and nothing is written. */
function EmployeeFormBody({ employee, initial, onClose, onChangeState }: { employee?: Employee; initial: Draft; onClose(): void; onChangeState?(p: Employee): void }) {
  const editing = !!employee, canSetType = useCaps().has('perm_cfg');
  const types = useEmployeeTypes(), locs = useDimension('locations'), deps = useDimension('departments'), jobs = useDimension('job-profiles');
  const [v, setV] = useState<Draft>(initial);
  const create = useCreateEmployee(), update = useUpdateEmployee();
  const write = editing ? update : create;
  const set = <K extends keyof Draft>(k: K, value: Draft[K]) => setV(d => ({ ...d, [k]: value }));
  const opts = (rows: readonly { code: string; name: string }[] | undefined, optional: boolean) =>
    [...(optional ? [{ value: NONE, label: 'None' }] : []), ...(rows ?? []).map(r => ({ value: r.code, label: r.name }))];
  const err = (k: string) => write.fieldError(k);
  /* the manager's name is what is saved, so the list offers names; the employee being edited cannot manage themselves */
  const everyone = useEmployees('here', '').data;
  const names = [...new Set((everyone ?? []).filter(p => p.id !== employee?.id).map(p => p.name))].sort((a, b) => a.localeCompare(b));
  const managers = [{ value: NONE, label: 'None' }, ...names.map(n => ({ value: n, label: n }))];

  const text = (k: 'name' | 'code' | 'email' | 'phone' | 'resource' | 'start', label: string,
    extra: { type?: string; disabled?: boolean; tip?: string; required?: boolean; placeholder?: string } = {}) => (
    <Field label={label} error={err(k)} tip={extra.tip} required={extra.required}>
      <TextInput testId={tid.employeeForm.field(k)} type={extra.type ?? 'text'} disabled={extra.disabled} value={v[k]}
        placeholder={extra.placeholder} onChange={e => set(k, e.target.value)} /></Field>);
  const hoursField = (k: 'contractedHours' | 'maxHours', label: string, tip?: string) => (
    <Field label={label} error={err(k)} tip={tip}>
      <UnitInput testId={tid.employeeForm.field(k)} unit="h / week" type="number" inputMode="decimal" step="0.5" min="0" max="80"
        value={v[k]} onChange={e => set(k, e.target.value)} /></Field>);
  const select = (k: 'employeeType' | 'jobProfile' | 'location' | 'department' | 'category', label: string,
    options: { value: string; label: string }[], extra: { required?: boolean; tip?: string; search?: string } = {}) => {
    const props = {
      testId: tid.employeeForm.field(k), options, value: v[k] || (options.some(o => o.value === NONE) ? NONE : ''),
      onValueChange: (x: string) => {
        const value = x === NONE ? '' : x;
        /* a new employee takes their type's usual basis, as the prototype's form did */
        if (k === 'employeeType' && !editing) { const t = types.data?.find(y => y.code === value); setV(d => ({ ...d, employeeType: value, category: t?.category ?? d.category })); }
        else set(k, value);
      },
    };
    return (
      <Field label={label} error={err(k)} required={extra.required} tip={extra.tip}>
        {extra.search ? <Combobox {...props} searchLabel={extra.search} /> : <SelectBox {...props} />}</Field>);
  };

  function submit() {
    const fields = { name: v.name, email: v.email, phone: v.phone, jobProfile: v.jobProfile, employeeType: v.employeeType, category: v.category,
      location: v.location, department: v.department, manager: v.manager, contractedHours: hours(v.contractedHours), maxHours: hours(v.maxHours),
      night: v.night, resource: v.resource, cis: v.cis, start: v.start };
    if (employee) {
      update.mutate({ employee, body: { ...fields, ...(canSetType && employee.userType ? { userType: v.userType } : {}) } }, {
        onSuccess: d => { toastInfo(d.changed.length ? `${d.record.name} updated · ${d.changed.length} field(s) changed` : `${d.record.name} · nothing changed`); onClose(); },
      });
    } else {
      create.mutate({ ...fields, code: v.code, state: v.state, userType: canSetType ? v.userType : 'employee' }, {
        onSuccess: d => {
          toastInfo(`${d.record.name} created · ${d.record.code} · ${LIFECYCLE[d.record.state].label}`,
            d.record.state === 'active' ? 'They count as working from today.' : 'They are not working yet. Change their state when they start.');
          onClose();
        },
      });
    }
  }
  const busy = write.anyPending;
  return (
    <Modal open onOpenChange={close(onClose)} title={editing ? employee.name : 'Add someone'} width="wide"
      footer={<>
        <Button testId={tid.employeeForm.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        {employee && onChangeState && <Button testId={tid.employeeForm.changeState} kind="ghost" onClick={() => onChangeState(employee)}>Change state</Button>}
        <Button testId={tid.employeeForm.save} kind="primary" pending={busy} onClick={submit}>{editing ? 'Save changes' : 'Create record'}</Button></>}>
      <div data-testid={tid.employeeForm.root}>
        <FormSection title="Identity">
          {text('name', 'Full name', { required: true, placeholder: 'For example, Amara Okafor' })}
          {text('code', 'Employee ID', { disabled: editing, tip: 'The key payroll and Business Central use for this employee. It cannot change once the record exists, because postings reference it.' })}
          {text('email', 'Work email', { type: 'email' })}
          {text('phone', 'Phone', { type: 'tel' })}
          {text('resource', 'Business Central resource no.', { placeholder: 'R-0142', tip: 'What a job journal line posts against. Leave it blank until the resource exists in Business Central.' })}
          <Field label="Paid under CIS" tip="Construction Industry Scheme. Workforce records the marker; payroll makes the deduction.">
            <SwitchField testId={tid.employeeForm.field('cis')} checked={v.cis} onCheckedChange={c => set('cis', c)} /></Field>
        </FormSection>
        <FormSection title="Employment">
          {select('employeeType', 'Employee type', opts(types.data, false), { search: 'Search employee types', required: true, tip: 'Decides which fields this employee captures, how they enter time, and what they may claim.' })}
          {select('jobProfile', 'Job profile', opts(jobs.data, true), { search: 'Search job profiles' })}
          {select('location', 'Location', opts(locs.data, false), { search: 'Search locations', required: true })}
          {select('department', 'Department', opts(deps.data, true), { search: 'Search departments' })}
          <Field label="Line manager" error={err('manager')}>
            <Combobox testId={tid.employeeForm.field('manager')} options={managers} value={v.manager || NONE} searchLabel="Search employees"
              onValueChange={x => set('manager', x === NONE ? '' : x)} /></Field>
          {text('start', 'Start date', { type: 'date' })}
        </FormSection>
        <FormSection title="Contract">
          {select('category', 'Basis', CATEGORIES)}
          {hoursField('contractedHours', 'Contracted hours', 'Rota, Timesheet and Leave all compare against this. Zero for bank and agency.')}
          {hoursField('maxHours', 'Maximum hours')}
          <Field label="Night work permitted">
            <SwitchField testId={tid.employeeForm.field('night')} checked={v.night} onCheckedChange={c => set('night', c)} /></Field>
        </FormSection>
        <FormSection title="Access">
          {canSetType && (!editing || employee.userType)
            ? <Field label="User type" error={err('userType')} tip="What this employee may do. The capabilities come from the permission matrix; this chooses which set applies.">
                <SelectBox testId={tid.employeeForm.field('userType')} options={USER_TYPES} value={v.userType}
                  onValueChange={x => { if (isUserType(x)) set('userType', x); }} /></Field>
            : <Small className="mb-md">{!canSetType
              ? (editing ? 'The user type is changed on Qnipay setup · Permissions.' : 'New employees get an Employee account. An administrator can change it.')
              : employee?.email
                ? `This employee has no account of their own: ${employee.email} already signs in to another account. Give them an address of their own to create one.`
                : 'This employee has no account yet. Give them a work email to create one.'}</Small>}
          {!editing && <Field label="Starting state" error={err('state')} hint={LIFECYCLE[v.state].note}>
            <SelectBox testId={tid.employeeForm.field('state')} options={STARTING_STATES.map(s => ({ value: s, label: LIFECYCLE[s].label }))}
              value={v.state} onValueChange={x => { if (isStart(x)) set('state', x); }} /></Field>}
        </FormSection>
        {write.refusal && <FormWarn testId={tid.employeeForm.warn}>{write.refusal.message}</FormWarn>}
      </div>
    </Modal>);
}

import { useState } from 'react';
import { Puzzle } from 'lucide-react';
import { tid } from '@/testids';
import type { EmployeeType, EmployeeTypeRow } from '@/contract/employee-types';
import { AdminCard, Button, Card, CardHead, Chip, ChipPicker, FormWarn, NavLink, Page, PageHead, SelectBox, SettingRow, Small, SwitchField, TextInput, toastInfo } from '@/ui';
import { buttonVariants } from '@/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { useDimension, useEmployeeTypes } from '@/api/reference';
import { useRemoveType, useTypeLibrary, useUpdateType } from '@/api/employee-types';
import { useShellData } from '@/shell/shellData';
import { CATEGORIES, MODES, NewTypeModal, UOMS, pick } from './NewTypeModal';

const SUB = 'mt-lg mb-sm border-b pb-xs text-xs font-[650] tracking-normal text-text-secondary first:mt-0';

/* Ported from the prototype's admTypesJobs and admTypes (qnipay-workforce-
   v15.html:9099-9107, 8105-8180): pick a type, then how it captures time and
   what its forms offer, one setting to a row. The prototype wrote each
   setting as it changed; here the type is saved once, with If-Match and one
   audit row. Capture fields are set in Timesheet setup and rota eligibility
   in Rota setup; leave policy belongs to the Leave module. Job profiles live under Dimensions. */
export function EmployeeTypesPage() {
  const types = useEmployeeTypes(), jobs = useDimension('job-profiles');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const current = types.data?.find(t => t.code === selected) ?? types.data?.[0];
  return (
    <Page testId={tid.page('atypes')}>
      <PageHead title="Employee types" crumb="Qnipay setup · Employee types" tipTestId={tid.head.tip('atypes')}
        tip="What somebody is: how they capture time, which fields they see, and what they may claim." />
      {types.isError && <p data-testid={tid.types.error} role="alert" className="text-err">The employee types could not be loaded. Reload the page.</p>}
      {types.data && (
        <AdminCard icon={<Puzzle />} title="Employee types" tipTestId={tid.types.tip}
          tip="A type is a configuration template, not a permission level. Roles stay Employee, Manager and Admin.">
          <Small className="-mt-sm mb-md">Roles are identity. Employee types are yours to shape: each one owns how its people capture time and what they are paid per.</Small>
          <ChipPicker testId={tid.types.list}>
            {types.data.map(t => (
              <Chip key={t.code} testId={tid.types.chip(t.code)} on={t.code === current?.code} onClick={() => setSelected(t.code)}>
                {t.name} <span className="text-xs font-bold tracking-[.05em] opacity-70">{t.uom === 'day' ? 'DAY' : 'HR'}</span></Chip>))}
            <Chip testId={tid.types.add} add onClick={() => setAdding(true)}>+ New employee type</Chip>
          </ChipPicker>
          {current && <TypeDetail key={`${current.code}-${current.version}`} type={current} onRemoved={() => setSelected(null)} />}
        </AdminCard>)}
      <Card testId={tid.types.jobs}>
        <CardHead title="Job profiles" actions={
          <NavLink testId={tid.types.jobsLink} to="/setup/aloc?d=job-profiles" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>Open Dimensions</NavLink>} />
        <Small>{jobs.data?.length ?? 0} profiles, held once under Dimensions and referenced here. {(jobs.data ?? []).map(j => j.name).join(' · ')}</Small>
      </Card>
      {adding && <NewTypeModal onClose={() => setAdding(false)} onCreated={t => setSelected(t.code)} />}
    </Page>);
}

function TypeDetail({ type, onRemoved }: { type: EmployeeTypeRow; onRemoved(): void }) {
  const lib = useTypeLibrary();
  const [v, setV] = useState<Pick<EmployeeType, 'name' | 'category' | 'mode' | 'uom' | 'capabilities'>>(
    { name: type.name, category: type.category, mode: type.mode, uom: type.uom, capabilities: type.capabilities });
  const update = useUpdateType(), remove = useRemoveType();
  const [last, setLast] = useState<'update' | 'remove'>('update');
  const refusal = (last === 'update' ? update : remove).refusal;
  const busy = update.anyPending || remove.anyPending;
  const toggle = (c: EmployeeType['capabilities'][number]) =>
    setV(x => ({ ...x, capabilities: x.capabilities.includes(c) ? x.capabilities.filter(y => y !== c) : [...x.capabilities, c] }));
  const save = () => { setLast('update'); update.mutate({ type, body: v }, { onSuccess: d =>
    toastInfo(d.changed.length ? `${d.record.name} updated · ${d.changed.length} field(s) changed` : `${d.record.name} · nothing changed`) }); };
  const drop = () => { setLast('remove'); remove.mutate(type, { onSuccess: () => { toastInfo(`${type.name} removed`); onRemoved(); } }); };
  const select = <T extends string>(key: 'category' | 'mode' | 'uom', label: string, options: { value: T; label: string }[]) => (
    <div className="w-[250px] max-md:w-full">
      <SelectBox testId={tid.types.field(key)} aria-label={label} options={options} value={v[key]}
        onValueChange={x => { const p = pick(options, x); if (p) setV(y => ({ ...y, [key]: p })); }} /></div>);
  return (
    <div data-testid={tid.types.detail}>
      <h3 className={SUB}>How this type captures time</h3>
      <SettingRow title="Type name" desc="What employees and managers see">
        <TextInput testId={tid.types.field('name')} aria-label="Type name" className="w-[270px] max-md:w-full" value={v.name}
          onChange={e => setV(x => ({ ...x, name: e.target.value }))} /></SettingRow>
      <SettingRow title="Usual basis" desc="What a new person of this type is employed on">{select('category', 'Usual basis', CATEGORIES)}</SettingRow>
      <SettingRow title="Entry mode" desc="Day form, weekly grid, or a live clock">{select('mode', 'Entry mode', MODES)}</SettingRow>
      <SettingRow title="Pay basis" desc="Hourly types accrue hours and overtime; day-rate types are paid per worked day">{select('uom', 'Pay basis', UOMS)}</SettingRow>
      <h3 className={SUB}>Capabilities <span className="font-normal text-text-muted">· what the field catalogue offers this type</span></h3>
      {(lib.data?.capabilities ?? []).map(c => (
        <SettingRow key={c.code} title={c.label} desc={c.desc}>
          <SwitchField testId={tid.types.cap(c.code)} aria-label={c.label} checked={v.capabilities.includes(c.code)} onCheckedChange={() => toggle(c.code)} />
        </SettingRow>))}
      <h3 className={SUB}>Capture fields, rota eligibility and leave policy</h3>
      <SetupPointers />
      {refusal && <FormWarn testId={tid.types.warn}>{refusal.usedBy ? `${refusal.message} ${refusal.next}` : refusal.message}</FormWarn>}
      <div className="mt-lg flex flex-wrap items-center justify-end gap-sm">
        <span data-testid={tid.types.heldBy} className="mr-auto text-xs text-text-muted">Held by {type.inUse} {type.inUse === 1 ? 'person' : 'people'} · code <span className="tabular-nums">{type.code}</span></span>
        <Button testId={tid.types.remove} kind="ghost" small pending={busy} onClick={drop}>Remove this type</Button>
        <Button testId={tid.types.save} kind="primary" small pending={busy} onClick={save}>Save changes</Button>
      </div>
    </div>);
}

/* Suite ADMIN LAYOUT: "it says where the fields went". Each module's setup
   page is named, and is a link while this person can reach it. */
function SetupPointers() {
  const data = useShellData();
  const at = (view: string, label: string) => data.kind === 'ready' && data.nav.some(g => g.tabs.some(t => t.view === view))
    ? <NavLink testId={tid.types.setupLink(view)} to={`/setup/${view}`} className={buttonVariants({ variant: 'link', size: null })}>{label}</NavLink>
    : label;
  return (
    <Small>Which fields this type fills in is set in {at('mts', 'Timesheet setup')}. What it may be rota’d to, with its hours, rest and night limits,
      is set in {at('mrota', 'Rota setup')} under Rota eligibility by employee type. Its leave policy is set in {at('mleave', 'Leave setup')}.</Small>);
}

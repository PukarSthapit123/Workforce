import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Building2, CalendarDays, Factory, ShieldCheck, Workflow } from 'lucide-react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import {
  AdminCard, Banner, Button, CardNote, ChoiceList, ChoiceRow, ConfirmModal, Field, FieldGrid, FormWarn, Modal, NavLink, Page, PageHead,
  Row, SettingRow, SettingSelect, SettingText, Small, SubHead, SwitchField, TextInput, toastInfo, toastRefusal,
} from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useTenant, useUpdateTenantSettings, type Tenant, type UpdateTenantSettings } from '@/api/tenant';
import { useTimesheetConfig } from '@/api/timesheets';
import { useEmployeeTypes } from '@/api/reference';
import {
  useApplyTemplate, useExportTemplate, useImportTemplate, useRemoveTemplate, useSaveTemplate, useTemplatePlan, useTemplates,
  type TemplatePlan, type TemplateRow,
} from '@/api/templates';
import { useCaps } from '@/shell/useCaps';
import { downloadText } from '@/lib/download';
import { formatDmy } from '@/domain/time';
import { MODULES, moduleLive } from '@/domain/modules';
import { TEMPLATE_SCOPES, scopeLabel, templateFileName, type TemplateScope } from '@/domain/templates';

/* Organisation: the prototype's admOrgAll and admOrg (qnipay-workforce-v15.html:
   9088-9091, 7989-8039) with templateCards and templateActions (8480-8520)
   above the company profile. Brand & appearance is left out (no theme or
   brand editing in 1c) and so is the currency (no money). Compliance keeps
   its switches; the minimum rest lives on Rota and Timesheet setup. The pay
   period cut-off is Timesheet setup's, shown here and linked to it. Every
   setting saves when it is chosen or left, with the tenant's version and one
   audit row. Applying a template asks first, showing what it would change,
   add and leave alone (D1). */
export function OrganisationPage() {
  const tenant = useTenant();
  return (
    <Page testId={tid.page('aorg')}>
      <PageHead title="Organisation" crumb="Qnipay setup · Organisation" tipTestId={tid.head.tip('aorg')}
        tip="Who this organisation is, the template it runs on, and how pay periods are set" />
      {tenant.data
        ? <>
            <SpineCard />
            <TemplatesCard tenant={tenant.data} />
            <TemplateActions />
            <CompanyCard tenant={tenant.data} />
            <ComplianceCard tenant={tenant.data} />
            <PayPeriodsCard tenant={tenant.data} />
          </>
        : tenant.isError
          ? <p data-testid={tid.aorg.error} role="alert" className="text-err">The organisation could not be loaded. Reload the page.</p>
          : <p data-testid={tid.aorg.loading} className="text-text-secondary">Loading the organisation&hellip;</p>}
    </Page>);
}

/* ------------------------------------------------------------ the spine */
const SPINE = ['Organisation & template', 'Modules', 'Features', 'Fields', 'Employee types', 'People'];
function SpineCard() {
  return (
    <AdminCard testId={tid.aorg.card('spine')} icon={<Workflow />} title="Configuration spine" tipTestId={tid.aorg.tip('spine')}
      tip="Read it left to right: each link narrows what the one after it can offer.">
      {/* .spine (v15:1464-1468) */}
      <div data-testid={tid.aorg.spine} className="flex flex-wrap items-center gap-sm rounded-card bg-surface-tint px-lg py-md">
        {SPINE.map((s, i) => <span key={s} className="contents">
          {i > 0 && <span aria-hidden="true" className="text-text-muted">→</span>}
          <b className="rounded-pill border bg-surface-card px-[11px] py-[5px] font-[family-name:var(--qp-font-display)] text-sm font-semibold">{s}</b>
        </span>)}
      </div>
      <Small className="mt-md">Changes apply immediately. There is no draft stage. People survive a template change: nobody is moved, and
        employee types a template does not have stay with the people who hold them.</Small>
    </AdminCard>);
}

/* -------------------------------------------------------- the templates */
function TemplatesCard({ tenant }: { tenant: Tenant }) {
  const list = useTemplates(), types = useEmployeeTypes();
  const [applying, setApplying] = useState<TemplateRow | null>(null);
  const rows = list.data?.templates ?? [];
  const live = rows.find(t => t.inUse);
  const modulesOn = MODULES.filter(m => moduleLive(tenant.modules, m)).length;
  return (
    <AdminCard testId={tid.aorg.card('templates')} icon={<Factory />} title="Industry template" tipTestId={tid.aorg.tip('templates')}
      tip="A template is data, not code: it seeds this tenant and stays editable afterwards.">
      {/* .tplgrid of .tpl (v15:1469-1476) */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,238px),1fr))] gap-md">
        {rows.map(t => (
          <button key={t.key} type="button" data-testid={tid.aorg.template(t.key)} aria-pressed={t.inUse}
            onClick={() => { if (!t.inUse) setApplying(t); }}
            className={cn('rounded-card border bg-surface-card px-lg py-md text-left transition-[border-color] duration-(--qp-duration-fast) ease-qp hover:border-brand dark:hover:border-brand-accent',
              t.inUse && 'border-[1.5px] border-brand bg-brand-subtle dark:border-brand-accent')}>
            <span className="block font-[family-name:var(--qp-font-display)] text-sm font-semibold">{t.name}</span>
            <span className="mt-[3px] block text-xs leading-[1.45] text-text-muted">{t.description}</span>
            <span className="mt-[6px] block text-xs leading-[1.45] text-text-muted opacity-85">{t.types.join(' · ')}</span>
            <span className="mt-xs block text-xs leading-[1.45] text-text-muted opacity-70">{t.modules.join(' · ')}</span>
          </button>))}
      </div>
      {list.isError && <p role="alert" className="mt-md text-xs text-err">Templates could not be loaded. Reload the page.</p>}
      <Small testId={tid.aorg.live} className="mt-md">
        {live ? <><b>{live.name}</b> is applied to <b>{tenant.name}</b>, activating {types.data ? `${types.data.length} employee types and ` : ''}{modulesOn} modules. </>
          : list.data ? <>The template this tenant started from is no longer here. </> : null}
        A client is a template plus its own edits, never a separate build.
      </Small>
      {applying && <ApplyDialog row={applying} tenant={tenant} onClose={() => setApplying(null)} />}
    </AdminCard>);
}

const PLAN_PARTS: readonly [keyof Pick<TemplatePlan, 'changes' | 'added' | 'leftAlone'>, string, string][] = [
  ['changes', 'What changes', 'Nothing changes.'], ['added', 'What is added', 'Nothing is added.'], ['leftAlone', 'What is left alone', ''],
];
/* data-tpl (v15:11220-11224), asking first: the plan the server would carry out. */
function ApplyDialog({ row, tenant, onClose }: { row: TemplateRow; tenant: Tenant; onClose(): void }) {
  const plan = useTemplatePlan(row.key), apply = useApplyTemplate();
  const go = () => apply.mutate({ key: row.key, ifMatch: tenant.version }, {
    onSuccess: out => { onClose(); toastInfo(out.message, `It is live for everyone at ${tenant.name} now.`); },
  });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Apply ${row.name}?`} width="wide"
      description="It applies to everyone immediately. There is no draft stage. People and the records already here are never deleted or overwritten."
      footer={<>
        <Button testId={tid.aorg.applyCancel} kind="ghost" onClick={onClose}>Keep it as it is</Button>
        <Button testId={tid.aorg.apply} kind="primary" disabled={!plan.data} pending={apply.anyPending} onClick={go}>Apply template</Button>
      </>}>
      {plan.data
        ? PLAN_PARTS.map(([part, title, none]) => (plan.data[part].length || none) && (
          <section key={part} data-testid={tid.aorg.plan(part)}>
            <SubHead>{title}</SubHead>
            {plan.data[part].length
              ? <ul className="mb-md list-disc space-y-[3px] pl-xl text-sm">{plan.data[part].map(l => <li key={l.text}>{l.text}</li>)}</ul>
              : <Small className="mb-md">{none}</Small>}
          </section>))
        : plan.isError
          ? <p data-testid={tid.aorg.planError} role="alert" className="text-sm text-err">What this template would change could not be read. Close this and try again.</p>
          : <p data-testid={tid.aorg.planLoading} className="text-sm text-text-secondary">Reading what it would change&hellip;</p>}
    </Modal>);
}

/* templateActions (v15:8480-8500): save, import, and the templates saved here. */
function TemplateActions() {
  const list = useTemplates(), imp = useImportTemplate(), remove = useRemoveTemplate(), exp = useExportTemplate();
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<TemplateRow | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const mine = (list.data?.templates ?? []).filter(t => t.source !== 'shipped');

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    let text: string;
    try { text = await readText(f); } catch {
      toastRefusal({ message: 'That file could not be read.', next: 'Check it is the JSON file Qnipay exported, then try again.' });
      return;
    }
    imp.mutate({ text }, { onSuccess: out => toastInfo(`${out.record.name} imported. Choose it to apply it.`,
      out.ignored.length ? `Left out, because a template does not hold them: ${out.ignored.join(', ')}.` : undefined) });
  };
  const download = async (t: TemplateRow) => {
    try {
      const f = await exp.run(t.key);
      if (downloadText(templateFileName(t.key), JSON.stringify(f, null, 1), 'application/json')) toastInfo(`${t.name} exported.`, 'Import it elsewhere to reuse this setup.');
      else toastRefusal({ message: 'This browser could not produce the file, so nothing was saved.', next: 'Try another browser.' });
    } catch (err) {
      if (err instanceof ApiError) toastRefusal(err.refusal);
    }
  };
  return (
    <div className="mb-md">
      {/* .formacts, start-aligned */}
      <div className="mb-md flex flex-wrap gap-sm">
        <Button testId={tid.aorg.saveOpen} kind="primary" small onClick={() => setSaving(true)}>Save this setup as a template</Button>
        <Button testId={tid.aorg.importOpen} kind="ghost" small pending={imp.anyPending} onClick={() => file.current?.click()}>Import a template</Button>
        <input ref={file} type="file" accept=".json,application/json" data-testid={tid.aorg.importFile} aria-label="Template file" className="hidden"
          onChange={e => void onFile(e)} />
      </div>
      {mine.length
        ? <>
            <SubHead>Templates saved here</SubHead>
            <Table data-testid={tid.aorg.saved} variant="records" dense>
              <TableHeader><TableRow><TableHead>Template</TableHead><TableHead>Keeps</TableHead><TableHead>Saved</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {mine.map(t => (
                  <Row key={t.key} testId={tid.aorg.savedRow(t.key)}>
                    <TableCell kind="title"><b>{t.name}</b><span className="block text-xs text-text-muted">{t.description}</span></TableCell>
                    <TableCell label="Keeps" className="text-xs text-text-muted">{scopeLabel(t.scope)}</TableCell>
                    <TableCell label="Saved" className="text-xs text-text-muted">
                      {t.savedAt ? `${formatDmy(t.savedAt.slice(0, 10))} · ${t.savedAt.slice(11, 16)}` : ''}
                      <span className="block">{t.source === 'imported' ? `Imported by ${t.savedBy ?? ''}` : t.savedBy}</span></TableCell>
                    <TableCell kind="foot" className="text-right whitespace-nowrap">
                      <span className="inline-flex gap-sm">
                        <Button testId={tid.aorg.export(t.key)} kind="ghost" small pending={exp.pending === t.key} onClick={() => void download(t)}>Export</Button>
                        <Button testId={tid.aorg.remove(t.key)} kind="ghost" small pending={remove.isPending(t.key)} onClick={() => setRemoving(t)}>Remove</Button>
                      </span>
                    </TableCell>
                  </Row>))}
              </TableBody>
            </Table>
          </>
        : list.data && <Small testId={tid.aorg.noSaved}>No templates saved on this device yet. Configure this tenant the way you want it, then save it.</Small>}
      {saving && <SaveDialog onClose={() => setSaving(false)} />}
      {removing && <ConfirmModal open onOpenChange={o => { if (!o) setRemoving(null); }} title={`Remove ${removing.name}?`} danger busy={remove.anyPending}
        body="It is removed from this browser. Export it first to keep a copy. This tenant keeps everything the template set."
        confirmLabel="Remove" onConfirm={() => {
          const t = removing;
          setRemoving(null);
          remove.mutate({ key: t.key, ifMatch: t.version ?? 0 }, { onSuccess: () => toastInfo(`${t.name} removed.`) });
        }} />}
    </div>);
}

/* A file's text, through FileReader, which every browser and the test DOM have. */
function readText(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === 'string' ? resolve(r.result) : reject(new Error('not text')));
    r.onerror = () => reject(r.error ?? new Error('unreadable'));
    r.readAsText(f);
  });
}

/* saveTemplateBox and tpl-save (v15:4624-4648, 11979-11995). */
function SaveDialog({ onClose }: { onClose(): void }) {
  const save = useSaveTemplate();
  const caps = useCaps();
  const [name, setName] = useState(''), [desc, setDesc] = useState('');
  const [scope, setScope] = useState<TemplateScope>('config');
  const [warn, setWarn] = useState<string | null>(null);
  const go = () => {
    if (!name.trim()) { setWarn('A template needs a name.'); return; }
    setWarn(null);
    save.mutate({ name, description: desc, scope }, {
      onSuccess: out => { onClose(); toastInfo(`${out.record.name} saved. ${scopeLabel(scope)}.`, 'It is available when choosing a template.'); },
    });
  };
  const nameError = save.fieldError('name');
  const shown = warn ?? (save.refusal && !save.refusal.field ? `${save.refusal.message} ${save.refusal.next}` : null);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Save this setup as a template" width="wide"
      description="A template starts a new tenant already configured. You are keeping what this one looks like now. Configure it first, then save."
      footer={<>
        <Button testId={tid.aorg.saveCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.aorg.save} kind="primary" pending={save.anyPending} onClick={go}>Save template</Button>
      </>}>
      <FieldGrid single>
        <Field label="Template name" required error={nameError}>
          <TextInput testId={tid.aorg.saveName} value={name} maxLength={80} placeholder="For example: Care, residential, two-stage approval"
            onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="What it is for">
          <TextInput testId={tid.aorg.saveDesc} value={desc} maxLength={300} placeholder="Shown on the card when somebody chooses a template"
            onChange={e => setDesc(e.target.value)} />
        </Field>
      </FieldGrid>
      <SubHead>What to keep</SubHead>
      <ChoiceList label="What to keep">
        {TEMPLATE_SCOPES.map(s => (
          <ChoiceRow key={s.key} testId={tid.aorg.scope(s.key)} name="tpl-scope" value={s.key} checked={scope === s.key} onChange={() => setScope(s.key)}
            title={s.label} note={s.key === 'structure' && !caps.has('master_data') ? `${s.note} It needs Workforce master data, which your access does not include.` : s.note} />))}
      </ChoiceList>
      <Banner tone="info" title="Saved in this browser">
        A template you save is kept alongside everything else, on this device. Export it to use it elsewhere or to hand it to somebody.
      </Banner>
      {shown && <FormWarn testId={tid.aorg.saveWarn}>{shown}</FormWarn>}
    </Modal>);
}

/* ----------------------------------------------------- company details */
const COUNTRIES = ['United Kingdom', 'Ireland', 'Nepal'] as const;
const REGIONS = ['England & Wales', 'Scotland', 'Northern Ireland', 'Republic of Ireland'] as const;
const FREQUENCIES = ['Weekly', 'Fortnightly', 'Four-weekly', 'Monthly'] as const;
const WEEK_ENDS = ['Sunday', 'Saturday', 'Friday'] as const;
type CompanyChange = NonNullable<UpdateTenantSettings['company']>;

/* One settings write, for every card below: the change, its toast, and the
   field it names when refused. */
function useSettings(tenant: Tenant) {
  const save = useUpdateTenantSettings();
  const send = (change: UpdateTenantSettings, said: string) =>
    save.mutate({ change, ifMatch: tenant.version }, { onSuccess: out => { if (out.auditId) toastInfo(said, 'It is live for everyone now.'); } });
  return {
    save, company: (c: CompanyChange, said: string) => send({ company: c }, said), name: (v: string) => send({ name: v }, 'Organisation name saved.'),
    error: (field: string) => save.fieldError(field) ?? save.fieldError(`company.${field}`),
  };
}

/* A text setting that saves when it is left, if it changed. Keyed by the
   stored value, so a save elsewhere does not lose what is being typed here. */
function TextSetting({ testId, label, value, wide, type, error, disabled, onSave }: {
  testId: string; label: string; value: string; wide?: boolean; type?: string; error?: string; disabled?: boolean; onSave(v: string): void;
}) {
  const [v, setV] = useState(value);
  const commit = () => { if (v.trim() !== value) onSave(v.trim()); };
  return (
    <div className="flex flex-col items-end max-md:w-full max-md:items-start">
      <SettingText testId={testId} aria-label={label} value={v} type={type} disabled={disabled} aria-invalid={error ? true : undefined}
        className={wide ? 'w-[min(560px,58vw)] max-md:w-full' : undefined}
        onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      {error && <p role="alert" className="mt-xs text-xs text-err">{error}</p>}
    </div>);
}
function SelectSetting<T extends string>({ testId, label, value, options, disabled, onSave }: {
  testId: string; label: string; value: string; options: readonly T[]; disabled?: boolean; onSave(v: T): void;
}) {
  return (
    <SettingSelect testId={testId} aria-label={label} value={value} disabled={disabled}
      onChange={e => { const o = options.find(x => x === e.target.value); if (o && o !== value) onSave(o); }}>
      {!options.some(o => o === value) && <option value={value}>{value || 'Not set'}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </SettingSelect>);
}

function CompanyCard({ tenant }: { tenant: Tenant }) {
  const s = useSettings(tenant), c = tenant.company, busy = s.save.anyPending;
  return (
    <AdminCard testId={tid.aorg.card('company')} icon={<Building2 />} title="Company profile" tipTestId={tid.aorg.tip('company')}
      tip="Shown in the top bar and on anything exported from the platform.">
      <SettingRow title="Organisation name">
        <TextSetting key={tenant.name} testId={tid.aorg.name} label="Organisation name" value={tenant.name} wide disabled={busy} error={s.error('name')} onSave={s.name} />
      </SettingRow>
      <SettingRow title="Registration number">
        <TextSetting key={c.registration} testId={tid.aorg.registration} label="Registration number" value={c.registration} disabled={busy} error={s.error('registration')}
          onSave={v => s.company({ registration: v }, 'Registration number saved.')} />
      </SettingRow>
      <SettingRow title="Registered address">
        <TextSetting key={c.address} testId={tid.aorg.address} label="Registered address" value={c.address} wide disabled={busy} error={s.error('address')}
          onSave={v => s.company({ address: v }, 'Registered address saved.')} />
      </SettingRow>
      <SettingRow title="Country">
        <SelectSetting testId={tid.aorg.country} label="Country" value={c.country} options={COUNTRIES} disabled={busy}
          onSave={v => s.company({ country: v }, `Country: ${v}.`)} />
      </SettingRow>
    </AdminCard>);
}

function ComplianceCard({ tenant }: { tenant: Tenant }) {
  const s = useSettings(tenant), c = tenant.company, busy = s.save.anyPending;
  return (
    <AdminCard testId={tid.aorg.card('compliance')} icon={<ShieldCheck />} title="Compliance" tipTestId={tid.aorg.tip('compliance')}
      tip="Checks run on submission and warn the employee and approver. They never silently change pay.">
      <SettingRow title="National Minimum Wage check" desc="Warn if total pay ÷ hours falls below NMW">
        <SwitchField testId={tid.aorg.nmw} aria-label="National Minimum Wage check" checked={c.nmwCheck} disabled={busy}
          onCheckedChange={on => s.company({ nmwCheck: on }, `National Minimum Wage check ${on ? 'on' : 'off'}.`)} />
      </SettingRow>
      <SettingRow title="Bank-holiday calendar" desc="Used by the shared calendar and by date-derived premiums">
        <SelectSetting testId={tid.aorg.bankHolidays} label="Bank-holiday calendar" value={c.bankHolidayRegion} options={REGIONS} disabled={busy}
          onSave={v => s.company({ bankHolidayRegion: v }, `Bank-holiday calendar: ${v}.`)} />
      </SettingRow>
      <CardNote>Thresholds follow current guidance. Verify them against the applicable tax year before sign-off.</CardNote>
    </AdminCard>);
}

function PayPeriodsCard({ tenant }: { tenant: Tenant }) {
  const s = useSettings(tenant), c = tenant.company, busy = s.save.anyPending;
  const caps = useCaps();
  const ts = useTimesheetConfig(caps.has('mod_cfg'));
  let cutoff: ReactNode = 'Set on Timesheet setup';
  if (ts.data) cutoff = ts.data.config.cutoff;
  return (
    <AdminCard testId={tid.aorg.card('pay')} icon={<CalendarDays />} title="Pay periods" tipTestId={tid.aorg.tip('pay')}
      tip="Defines the window a timesheet belongs to, and therefore when it closes.">
      <SettingRow title="Pay frequency">
        <SelectSetting testId={tid.aorg.payFrequency} label="Pay frequency" value={c.payFrequency} options={FREQUENCIES} disabled={busy}
          onSave={v => s.company({ payFrequency: v }, `Pay frequency: ${v}.`)} />
      </SettingRow>
      <SettingRow title="Week ending day">
        <SelectSetting testId={tid.aorg.weekEnding} label="Week ending day" value={c.weekEnding} options={WEEK_ENDS} disabled={busy}
          onSave={v => s.company({ weekEnding: v }, `Week ending day: ${v}.`)} />
      </SettingRow>
      <SettingRow title="First pay date">
        <TextSetting key={c.firstPayDate} testId={tid.aorg.firstPayDate} label="First pay date" type="date" value={c.firstPayDate} disabled={busy} error={s.error('firstPayDate')}
          onSave={v => s.company({ firstPayDate: v }, v ? `First pay date: ${formatDmy(v)}.` : 'First pay date cleared.')} />
      </SettingRow>
      <SettingRow title="Pay-period cut-off" desc="After the cut-off the period is closed: employees can no longer submit">
        <span data-testid={tid.aorg.cutoff} className="text-sm">{cutoff}</span>
        <NavLink testId={tid.aorg.cutoffLink} to="/setup/mts" className="text-xs font-semibold text-brand underline dark:text-brand-accent">Change it on Timesheet setup</NavLink>
      </SettingRow>
    </AdminCard>);
}

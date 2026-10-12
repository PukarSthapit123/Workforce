import { memo, useCallback, useState, type ReactNode } from 'react';
import { Link2, Plus, RefreshCw, Repeat, Ruler, Tag, Trash2, TriangleAlert, Upload, UsersRound } from 'lucide-react';
import { tid } from '@/testids';
import {
  ActionBar, AdminCard, Button, Card, Chip, ChipPicker, Empty, Field, FormWarn, GuideButton, InlineInput, Modal, NavLink, Page, PageHead, Pill, Row, SettingRow,
  SettingSelect, Small, SubHead, SwitchField, TextInput, UnitInput, toastInfo,
} from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useLeaveConfig, useSaveLeaveConfig, type LeaveSetup, type LeaveTypeRecord } from '@/api/leave';
import type { Tenant } from '@/api/tenant';
import { useTenant } from '@/shell/shellData';
import { versionKey } from '@/lib/latest';
import { cn } from '@/lib/utils';
import {
  BANK_HOLIDAY_HANDLING, BANK_HOLIDAY_HANDLING_LABEL, LEAVE_METHODS, LEAVE_METHOD_LABEL, LEAVE_TYPE_ADDED, LEAVE_UNITS, STAGE_CHANNELS, TOIL_WINDOWS,
  type ServiceRule, type TypeLeave,
} from '@/domain/leave';
import { leaveCodeProblem, normaliseCode } from '@/domain/codes';
import { formatDmy } from '@/domain/time';
import { addedPolicy, addedType, draftOf, leaveBody, leaveMethod, leaveUnit, newStageDraft, type LeaveDraft, type NumKey, type PolicyDraft, type PolicyNumKey, type StageDraft, type ToggleKey } from './setup';

/* Leave setup: the prototype's admLeave (qnipay-workforce-v15.html:8960-9071)
   with the per-type leave policy it kept on the employee type (8160-8172).
   Every setting edits one draft: Save sends it with If-Match and writes one
   audit row with the before and after, Cancel puts it back (D11). The
   prototype applied each change as it was made. The module's feature
   switches (LV_*) belong to Modules & features, so they are shown here as
   they stand. Nothing here carries an amount (D13): a leave type is paid or
   unpaid, never a rate. */
const CRUMB = 'Modules · Leave · Leave setup';
const OFF = 'The Leave module is off for this tenant. Turn it on under Modules & features.';
const FLAG_NOTE = 'Switched on or off under Modules & features.';
const SAVE_NOTE = 'Save to keep the change.';

export function LeaveSetupPage() {
  const tenant = useTenant();
  const on = tenant.data?.modules.L === true;
  const setup = useLeaveConfig(on);
  const refused = setup.error instanceof ApiError ? setup.error.refusal : null;
  return (
    <Page testId={tid.page('mleave')}>
      <Head bare={tenant.data ? !on : false} />
      {tenant.data && !on && <Card><Empty testId={tid.mleave.off}>{OFF}</Empty></Card>}
      {on && tenant.data && (setup.data
        /* the draft starts again from what the server holds whenever the config gets a new version: after a save, or after a 412 */
        ? <SetupDraftView key={versionKey(setup.data.config)} setup={setup.data} tenant={tenant.data} />
        : !setup.isError && <p data-testid={tid.mleave.loading} className="text-text-secondary">Loading Leave setup&hellip;</p>)}
      {(setup.isError || tenant.isError) && <p data-testid={tid.mleave.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Leave setup could not be loaded. Reload the page.'}</p>}
    </Page>);
}

function Head({ bare }: { bare?: boolean }) {
  return bare
    ? <PageHead title="Leave setup" crumb={CRUMB} />
    : <PageHead title="Leave setup" crumb={CRUMB} tipTestId={tid.head.tip('mleave')}
        tip="Leave types, policies, entitlement rules, workflow, SLA and escalation" actions={<GuideButton view="mleave" />} />;
}

function Err({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-xs text-xs text-err">{text}</p> : null;
}
/* a control with its error under it, right-aligned in a setting row */
function Control({ error, children }: { error?: string; children: ReactNode }) {
  return <div className="flex flex-col items-end max-md:items-start">{children}<Err text={error} /></div>;
}
const invalid = (error: string | undefined) => (error ? true : undefined);

function SetupDraftView({ setup, tenant }: { setup: LeaveSetup; tenant: Tenant }) {
  const { config, employeeTypes, flags } = setup;
  const typeCodes = employeeTypes.map(t => t.code);
  const [draft, setDraft] = useState<LeaveDraft>(() => draftOf(config, typeCodes));
  const [picked, setPicked] = useState<string>(typeCodes[0] ?? '');
  const save = useSaveLeaveConfig();
  const body = leaveBody(config, draft);
  const dirty = Object.keys(body).length > 0;
  /* the field a refusal names, read from the refusal (field errors and the refusal are set and cleared together), so the
     function, and the memoised tables below, stay the same while someone types elsewhere on the page */
  const refusal = save.refusal;
  const fe = useCallback((field: string) => (refusal?.field === field ? refusal.message : undefined), [refusal]);
  const setTypes = useCallback((types: LeaveTypeRecord[]) => setDraft(d => ({ ...d, types })), []);
  const setPolicies = useCallback((policies: PolicyDraft[]) => setDraft(d => ({ ...d, policies })), []);
  const setStages = useCallback((stages: StageDraft[]) => setDraft(d => ({ ...d, stages })), []);
  const set = (patch: Partial<LeaveDraft>) => setDraft(d => ({ ...d, ...patch }));
  const setNum = (k: NumKey, v: string) => setDraft(d => ({ ...d, nums: { ...d.nums, [k]: v } }));
  const setToggle = (k: ToggleKey, v: boolean) => setDraft(d => ({ ...d, toggles: { ...d.toggles, [k]: v } }));
  /* a refusal about one employee type's leave policy opens that type, so the field it names is on screen */
  const refusedType = /^typeLeave\.([^.]+)/.exec(save.refusal?.field ?? '')?.[1];
  const [seen, setSeen] = useState(save.refusal);
  if (save.refusal !== seen) {
    setSeen(save.refusal);
    if (refusedType) setPicked(refusedType);
  }

  const submit = () => save.mutate({ config, body }, { onSuccess: d =>
    toastInfo(d.auditId ? 'Leave setup saved. It applies across the tenant straight away.' : 'Leave setup · nothing changed') });
  const cancel = () => { setDraft(draftOf(config, typeCodes)); save.clearFieldErrors(); };

  const flagRow = (code: string, title: string, desc: string) => (
    <SettingRow title={title} desc={<>{desc}<span className="block">{FLAG_NOTE}</span></>}>
      <SwitchField testId={tid.mleave.flag(code)} aria-label={title} checked={flags[code] === true} disabled /></SettingRow>);
  const numRow = (k: NumKey, title: string, desc: string | undefined, unit: string) => (
    <SettingRow title={title} desc={desc}>
      <Control error={fe(k)}>
        <UnitInput testId={tid.mleave.num(k)} unit={unit} aria-label={title} type="number" inputMode="decimal" min="0" value={draft.nums[k]}
          aria-invalid={invalid(fe(k))} onChange={e => setNum(k, e.target.value)} /></Control></SettingRow>);
  const toggleRow = (k: ToggleKey, title: string, desc?: string) => (
    <SettingRow title={title} desc={desc}>
      <SwitchField testId={tid.mleave.toggle(k)} aria-label={title} checked={draft.toggles[k]} onCheckedChange={v => setToggle(k, v)} /></SettingRow>);

  return (
    <>
      <TypesCard setup={setup} policies={draft.policies} types={draft.types} fe={fe} onChange={setTypes} />
      <PoliciesCard policies={draft.policies} fe={fe} onChange={setPolicies} />

      <AdminCard testId={tid.mleave.card('entitlement')} icon={<RefreshCw />} title="Entitlement rules" desc="How annual leave is derived and expressed">
        {flagRow('LV_ENT', 'Automatic entitlement calculation', 'Derive entitlement from working hours, pattern, service and policy rather than entering it by hand')}
        {flagRow('LV_PRORATA', 'Pro-rata recalculation', 'Recalculate automatically when contracted hours or working arrangements change')}
        {flagRow('LV_LEAVER', 'Leaver reconciliation', 'Settle over- or under-taken leave against pro-rata entitlement at the leaving date')}
        {/* D3: the financial year and full-time hours are the tenant's, set on Calendar and shown here as they stand */}
        <SettingRow title="Financial year" desc="Entitlement and leaver reconciliation use the year set on Calendar.">
          <span data-testid={tid.mleave.finYear} className="text-xs text-text-muted tabular-nums">
            {formatDmy(tenant.financialYear.start)} – {formatDmy(tenant.financialYear.end)}</span>
          <NavLink testId={tid.mleave.finYearLink} to="/setup/acal" className="text-xs font-semibold text-brand underline dark:text-brand-accent">Change it on Calendar</NavLink>
        </SettingRow>
        <SettingRow title="Full-time weekly hours" desc="A pro-rated policy divides contracted hours by this.">
          <span data-testid={tid.mleave.fullTimeHours} className="text-xs text-text-muted tabular-nums">{tenant.fullTimeWeeklyHours} hours a week</span>
          <NavLink testId={tid.mleave.fullTimeLink} to="/setup/acal" className="text-xs font-semibold text-brand underline dark:text-brand-accent">Change it on Calendar</NavLink>
        </SettingRow>
        <SettingRow testId={tid.mleave.recordUnit} title="Record leave in" desc="Leave is recorded in each policy’s unit.">{null}</SettingRow>
        {toggleRow('bhPaid', 'Bank holidays are on top of entitlement', 'When off, a scheduled working bank holiday is deducted from entitlement.')}
        {flags.LV_TOIL === true && <>
          {numRow('toilMax', 'Most TOIL anyone can build up', undefined, 'hrs')}
          <SettingRow title="TOIL must be used within">
            <Control error={fe('toilWindow')}>
              <SettingSelect testId={tid.mleave.toilWindow} aria-label="TOIL must be used within" value={draft.toilWindow}
                aria-invalid={invalid(fe('toilWindow'))} onChange={e => set({ toilWindow: Number(e.target.value) })}>
                {TOIL_WINDOWS.map(m => <option key={m} value={m}>{m} months</option>)}</SettingSelect></Control>
          </SettingRow>
        </>}
        {/* D7: buying and selling leave settles in money, so it waits for Payroll */}
        <SettingRow testId={tid.mleave.buySell} title="Buy and sell leave" desc="Not built yet. It belongs with Payroll and Business Central.">{null}</SettingRow>
        {numRow('absenceTrigger', 'Absence trigger score', 'Bradford factor threshold that starts the return-to-work steps', 'pts')}
      </AdminCard>
      <SicknessReasonsCard reasons={draft.sicknessReasons} onChange={sicknessReasons => set({ sicknessReasons })} />

      <AdminCard testId={tid.mleave.card('workflow')} icon={<Repeat />} title="Escalation" tipTestId={tid.mleave.tip('workflow')}
        tip="Requests move through this timed escalation ladder until a decision is made."
        desc="Stages, waits and escalation for a leave request">
        {flagRow('LV_SLA', 'Approval SLA and escalation', 'Escalate a request that is not decided within the SLA')}
        {numRow('slaDays', 'Tenant SLA default', 'A policy can set its own SLA. This is used when its SLA is blank.', 'days')}
        {numRow('minNotice', 'Minimum notice', 'How far ahead a request must be made', 'days')}
        {numRow('cancelWindow', 'Cancellation window', 'How close to the start date a colleague may still cancel', 'days')}
        <StagesTable stages={draft.stages} fe={fe} onChange={setStages} />
      </AdminCard>

      <AdminCard testId={tid.mleave.card('rota')} icon={<Link2 />} title="Leave and Rota" desc="How approved leave affects availability">
        {flagRow('LV_ROTA', 'Approved leave makes the person unavailable on the rota',
          'Coverage is recalculated, and the fulfilment workflow may trigger if the day falls below minimum')}
        {!setup.rotaOn && <p data-testid={tid.mleave.rotaOff} className="border-b py-[11px] text-xs text-text-muted">
          The Rota module is off for this tenant, so approved leave reaches the timesheet but no rota.</p>}
        {toggleRow('blocksTimesheet', 'Approved leave blocks timesheet capture', 'An employee cannot log worked hours on a leave day unless they were called in')}
      </AdminCard>

      {flags.LV_LEAVER === true && setup.leavers && <LeaversCard leavers={setup.leavers} />}

      <TypeLeaveCard setup={setup} policies={draft.policies} typeLeave={draft.typeLeave} picked={picked} onPick={setPicked} fe={fe}
        onChange={(code, t) => setDraft(d => ({ ...d, typeLeave: { ...d.typeLeave, [code]: t } }))} />

      {save.refusal && <FormWarn testId={tid.mleave.warn}>{save.refusal.message} {save.refusal.next}</FormWarn>}
      {/* Save and Cancel stay in reach while a change waits to be saved */}
      <ActionBar stuck={dirty}>
        {dirty && <span data-testid={tid.mleave.dirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        <Button testId={tid.mleave.cancel} kind="ghost" disabled={!dirty || save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.mleave.save} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>
    </>);
}

type FieldError = (field: string) => string | undefined;

/* ------------------------------------------------------------ leave types */
const TypesCard = memo(function TypesCard({ setup, policies, types, fe, onChange }: {
  setup: LeaveSetup; policies: PolicyDraft[]; types: LeaveTypeRecord[]; fe: FieldError; onChange(types: LeaveTypeRecord[]): void;
}) {
  const names = policies;
  const [adding, setAdding] = useState(false);
  const setType = (i: number, patch: Partial<LeaveTypeRecord>) => onChange(types.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <AdminCard testId={tid.mleave.card('types')} icon={<Tag />} title="Leave types" desc="What a colleague can request. The exact list is configurable.">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Code</TableHead><TableHead>Leave type</TableHead><TableHead>Policy</TableHead><TableHead>Paid</TableHead>
          <TableHead>Evidence required</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Requests</TableHead><TableHead>Active</TableHead><TableHead><span className="sr-only">Remove</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{types.map((t, i) => {
          const at = (k: string) => fe(`types.${i}.${k}`);
          return (
            <Row key={`${t.code}:${i}`} testId={tid.mleave.type(i)}>
              <TableCell className="font-mono text-xs">{t.code}</TableCell>
              <TableCell><InlineInput testId={tid.mleave.typeName(i)} aria-label={`Name of leave type ${t.code}`} value={t.name}
                aria-invalid={invalid(at('name'))} onChange={e => setType(i, { name: e.target.value })} /><Err text={at('name')} /></TableCell>
              <TableCell>
                <SettingSelect testId={tid.mleave.typePolicy(i)} small aria-label={`Policy for ${t.name || t.code}`} value={t.policy}
                  aria-invalid={invalid(at('policy'))} onChange={e => setType(i, { policy: e.target.value })}>
                  {names.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</SettingSelect><Err text={at('policy')} /></TableCell>
              <TableCell><SwitchField testId={tid.mleave.typePaid(i)} aria-label={`${t.name || t.code} paid`} checked={t.paid}
                onCheckedChange={v => setType(i, { paid: v })} /></TableCell>
              <TableCell><SwitchField testId={tid.mleave.typeEvidence(i)} aria-label={`${t.name || t.code} evidence required`} checked={t.evidence}
                onCheckedChange={v => setType(i, { evidence: v })} /></TableCell>
              <TableCell>
                <SettingSelect testId={tid.mleave.typeUnit(i)} small aria-label={`Unit for ${t.name || t.code}`} value={t.unit}
                  aria-invalid={invalid(at('unit'))} onChange={e => { const u = leaveUnit(e.target.value); if (u) setType(i, { unit: u }); }}>
                  {LEAVE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</SettingSelect><Err text={at('unit')} /></TableCell>
              <TableCell data-testid={tid.mleave.typeCount(i)} className="text-right tabular-nums">{setup.requestCounts[t.code] ?? 0}</TableCell>
              <TableCell><SwitchField testId={tid.mleave.typeActive(i)} aria-label={`${t.name || t.code} active`} checked={t.active}
                onCheckedChange={v => setType(i, { active: v })} /></TableCell>
              <TableCell className="text-right"><Button testId={tid.mleave.typeRemove(i)} kind="ghost" small onClick={() => {
                onChange(types.filter((_, j) => j !== i));
                toastInfo('Leave type removed from the draft', SAVE_NOTE);
              }}><Trash2 aria-hidden="true" />Remove</Button></TableCell>
            </Row>);
        })}</TableBody>
      </Table>
      <Err text={fe('types')} />
      <div className="mt-lg flex flex-wrap justify-end gap-sm">
        <Button testId={tid.mleave.typeAdd} kind="ghost" small onClick={() => setAdding(true)}>Add leave type</Button></div>
      {adding && <AddWithCode title="Add leave type" existing={types.map(t => t.code)} onClose={() => setAdding(false)} onAdd={(code, name) => {
        onChange([...types, addedType(code, name, policies)]);
        toastInfo(LEAVE_TYPE_ADDED, SAVE_NOTE);
      }} />}
    </AdminCard>);
});

/* --------------------------------------------------------- leave policies */
/* P's dense policy table (v15:9245-9262), one row per policy, with every field
   now editable: the method is a choice the maths reads, the service rule a list
   of { after years, add, cap }, pro-rata and approval are switches, and a blank
   SLA uses the tenant default. */
const PoliciesCard = memo(function PoliciesCard({ policies, fe, onChange }: {
  policies: PolicyDraft[]; fe: FieldError; onChange(policies: PolicyDraft[]): void;
}) {
  const [adding, setAdding] = useState(false);
  const setPolicy = (i: number, patch: Partial<PolicyDraft>) => onChange(policies.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setRule = (i: number, j: number, patch: Partial<ServiceRule>) => setPolicy(i, {
    serviceRules: policies[i]?.serviceRules.map((r, n) => n === j ? { ...r, ...patch } : r) ?? [],
  });
  return (
    <AdminCard testId={tid.mleave.card('policies')} icon={<Ruler />} title="Leave policies" tipTestId={tid.mleave.tip('policies')}
      tip="A policy defines the calculation, not just the number: method, unit, service rules, pro-rata, carry-over, approval, SLA and bank-holiday handling."
      desc="Entitlement is calculated automatically from these rules">
      <Table dense>
        <TableHeader><TableRow>
          <TableHead>Policy</TableHead><TableHead>Method</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Base</TableHead>
          <TableHead>Pro-rata</TableHead><TableHead className="text-right">Carry cap</TableHead>
          <TableHead>Approval</TableHead><TableHead className="text-right">SLA</TableHead><TableHead><span className="sr-only">Remove</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{policies.map((p, i) => {
          const rowErr = fe(`policies.${i}`) ?? fe(`policies.${i}.name`), unitErr = fe(`policies.${i}.unit`), methodErr = fe(`policies.${i}.method`);
          const short = p.unit.slice(0, 1);
          const numInput = (key: PolicyNumKey, unit: string, label: string, step = '1', placeholder?: string) => (
            <UnitInput testId={tid.mleave.policyNum(i, key)} unit={unit} aria-label={`${label} for ${p.name}`} type="number" inputMode="decimal" min="0" step={step}
              placeholder={placeholder} className="ml-auto" value={p.nums[key]} aria-invalid={invalid(rowErr)}
              onChange={e => setPolicy(i, { nums: { ...p.nums, [key]: e.target.value } })} />);
          const ruleInput = (j: number, field: keyof ServiceRule, unit: string, label: string, value: number) => (
            <UnitInput testId={tid.mleave.serviceRule(i, j, field)} unit={unit} aria-label={`${p.name} service rule ${j + 1}: ${label}`}
              type="number" min="0" step={field === 'afterYears' ? '1' : '0.1'} value={value} onChange={e => setRule(i, j, { [field]: Number(e.target.value) })} />);
          return [
            <Row key={p.code} testId={tid.mleave.policy(i)}>
              <TableCell>
                <InlineInput testId={tid.mleave.policyName(i)} aria-label={`Name of policy ${p.code}`} value={p.name} maxLength={60}
                  aria-invalid={invalid(rowErr)} onChange={e => setPolicy(i, { name: e.target.value })} />
                <div className="font-mono text-xs text-text-muted">{p.code}</div><Err text={rowErr} /></TableCell>
              <TableCell>
                <SettingSelect testId={tid.mleave.policyMethod(i)} small aria-label={`Method for ${p.name}`} value={p.method} aria-invalid={invalid(methodErr)}
                  onChange={e => { const method = leaveMethod(e.target.value); if (method) setPolicy(i, { method }); }}>
                  {LEAVE_METHODS.map(method => <option key={method} value={method}>{LEAVE_METHOD_LABEL[method]}</option>)}</SettingSelect><Err text={methodErr} /></TableCell>
              <TableCell>
                <SettingSelect testId={tid.mleave.policyUnit(i)} small aria-label={`Unit for ${p.name}`} value={p.unit} aria-invalid={invalid(unitErr)}
                  onChange={e => { const unit = leaveUnit(e.target.value); if (unit) setPolicy(i, { unit }); }}>
                  {LEAVE_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</SettingSelect><Err text={unitErr} /></TableCell>
              <TableCell className="text-right">{numInput('base', short, 'Base', '0.1')}</TableCell>
              <TableCell><SwitchField testId={tid.mleave.policyProrata(i)} aria-label={`Pro-rata by contracted hours for ${p.name}`} checked={p.prorata}
                onCheckedChange={prorata => setPolicy(i, { prorata })} /></TableCell>
              <TableCell className="text-right">{numInput('carry', 'd', 'Carry-over cap', '0.1')}</TableCell>
              <TableCell><SwitchField testId={tid.mleave.policyApproval(i)} aria-label={`Approval needed for ${p.name}`} checked={p.approval}
                onCheckedChange={approval => setPolicy(i, { approval })} /></TableCell>
              <TableCell className="text-right">{numInput('sla', 'd', 'SLA')}</TableCell>
              <TableCell className="text-right"><Button testId={tid.mleave.policyRemove(i)} kind="ghost" small aria-label={`Remove ${p.name}`}
                onClick={() => { onChange(policies.filter((_, j) => j !== i)); toastInfo('Policy removed from the draft', SAVE_NOTE); }}>
                <Trash2 aria-hidden="true" /></Button></TableCell>
            </Row>,
            /* under each policy: how it treats bank holidays, and its service rules (after so many years, add so much, up to a cap) */
            <Row key={`${p.code}-rules`} testId={tid.mleave.policyRules(i)}>
              <TableCell colSpan={9} className="pt-0">
                <div className="flex flex-wrap items-center gap-x-lg gap-y-xs pl-md text-xs text-text-secondary">
                  <span className="flex items-center gap-xs whitespace-nowrap">Bank holidays
                    <SettingSelect testId={tid.mleave.policyBh(i)} small aria-label={`Bank-holiday handling for ${p.name}`} value={p.bankHolidayHandling}
                      onChange={e => { const bh = BANK_HOLIDAY_HANDLING.find(x => x === e.target.value); if (bh) setPolicy(i, { bankHolidayHandling: bh }); }}>
                      {BANK_HOLIDAY_HANDLING.map(bh => <option key={bh} value={bh}>{BANK_HOLIDAY_HANDLING_LABEL[bh]}</option>)}</SettingSelect></span>
                  {p.serviceRules.map((rule, j) => (
                    <span key={j} className="flex items-center gap-xs whitespace-nowrap">
                      Service rule {j + 1}: after {ruleInput(j, 'afterYears', 'y', 'after years', rule.afterYears)} add {ruleInput(j, 'add', short, 'add', rule.add)}
                      up to {ruleInput(j, 'cap', short, 'cap', rule.cap)}
                      <Button testId={tid.mleave.serviceRuleRemove(i, j)} kind="ghost" small aria-label={`Remove ${p.name} service rule ${j + 1}`}
                        onClick={() => setPolicy(i, { serviceRules: p.serviceRules.filter((_, n) => n !== j) })}><Trash2 aria-hidden="true" /></Button>
                    </span>))}
                  <Button testId={tid.mleave.serviceRuleAdd(i)} kind="ghost" small
                    onClick={() => setPolicy(i, { serviceRules: [...p.serviceRules, { afterYears: 1, add: 1, cap: 1 }] })}><Plus aria-hidden="true" />Add service rule</Button>
                </div></TableCell>
            </Row>];
        })}</TableBody>
      </Table>
      <p className="mt-sm text-xs text-text-muted">A blank SLA uses the tenant default under Escalation. With approval off, a request is approved at once, unless its leave type needs evidence.</p>
      <Err text={fe('policies')} />
      <div className="mt-lg flex justify-end"><Button testId={tid.mleave.policyAdd} kind="ghost" small onClick={() => setAdding(true)}>
        <Plus aria-hidden="true" />Add policy</Button></div>
      {adding && <AddWithCode title="Add leave policy" existing={policies.map(p => p.code)} onClose={() => setAdding(false)} onAdd={(code, name) => {
        onChange([...policies, addedPolicy(code, name)]);
        toastInfo('Policy added', SAVE_NOTE);
      }} />}
    </AdminCard>);
});

function SicknessReasonsCard({ reasons, onChange }: { reasons: string[]; onChange(reasons: string[]): void }) {
  return <AdminCard testId={tid.mleave.card('sicknessReasons')} icon={<Tag />} title="Sickness reasons" desc="The reasons available when recording an absence">
    {reasons.map((reason, i) => <div key={i} className="flex items-center gap-sm border-b py-sm">
      <InlineInput testId={tid.mleave.sicknessReason(i)} aria-label={`Sickness reason ${i + 1}`} value={reason}
        onChange={e => onChange(reasons.map((r, j) => j === i ? e.target.value : r))} />
      <Button testId={tid.mleave.sicknessReasonRemove(i)} kind="ghost" small onClick={() => onChange(reasons.filter((_, j) => j !== i))}>
        <Trash2 aria-hidden="true" />Remove</Button>
    </div>)}
    <div className="mt-md flex justify-end"><Button testId={tid.mleave.sicknessReasonAdd} kind="ghost" small onClick={() => onChange([...reasons, 'New reason'])}>
      <Plus aria-hidden="true" />Add reason</Button></div>
  </AdminCard>;
}

/* Module 8 group 3: a leave type's or policy's code is given here, once, and is read-only from then on */
function AddWithCode({ title, existing, onClose, onAdd }: { title: string; existing: readonly string[]; onClose(): void; onAdd(code: string, name: string): void }) {
  const [code, setCode] = useState(''), [name, setName] = useState('');
  const problem = code.trim() ? leaveCodeProblem(code, existing) : null;
  const ready = code.trim() !== '' && !problem && name.trim() !== '';
  const add = () => { if (!ready) return; onAdd(normaliseCode(code), name.trim()); onClose(); };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={title}
      footer={<>
        <Button testId={tid.mleave.addCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.mleave.addSave} kind="primary" disabled={!ready} onClick={add}>Add</Button>
      </>}>
      <Field label="Code" required error={problem?.message} hint="Up to 10 capital letters, digits, dashes or underscores. It cannot change once added.">
        <TextInput testId={tid.mleave.addCode} className="uppercase" maxLength={10} value={code} onChange={e => setCode(e.target.value)} />
      </Field>
      <Field label="Name" required>
        <TextInput testId={tid.mleave.addName} maxLength={60} value={name} onChange={e => setName(e.target.value)} />
      </Field>
    </Modal>);
}

/* -------------------------------------------------------- workflow stages */
const StagesTable = memo(function StagesTable({ stages, fe, onChange }: { stages: StageDraft[]; fe: FieldError; onChange(stages: StageDraft[]): void }) {
  const setStage = (i: number, patch: Partial<StageDraft>) => onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <>
      <div className="mt-md">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-[52px]">Stage</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead>
            <TableHead className="text-right">Wait</TableHead><TableHead>Notification</TableHead><TableHead><span className="sr-only">Remove</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{stages.map((s, i) => {
            const row = fe(`stages.${i}`), wait = fe(`stages.${i}.wait`), channel = fe(`stages.${i}.channel`);
            return (
              <Row key={i} testId={tid.mleave.stage(i)}>
                <TableCell><Pill tone="neu">{i + 1}</Pill></TableCell>
                <TableCell><InlineInput testId={tid.mleave.stageWho(i)} aria-label={`Stage ${i + 1} approver`} value={s.who} aria-invalid={invalid(row)}
                  onChange={e => setStage(i, { who: e.target.value })} /><Err text={row} /></TableCell>
                <TableCell><InlineInput testId={tid.mleave.stageAction(i)} aria-label={`Stage ${i + 1} action`} value={s.action} aria-invalid={invalid(row)}
                  onChange={e => setStage(i, { action: e.target.value })} /></TableCell>
                <TableCell className="text-right">
                  <UnitInput testId={tid.mleave.stageWait(i)} unit="d" aria-label={`Stage ${i + 1} wait in days`} type="number" inputMode="numeric" min="0"
                    className="ml-auto" value={s.wait} aria-invalid={invalid(wait)} onChange={e => setStage(i, { wait: e.target.value })} />
                  <Err text={wait} /></TableCell>
                <TableCell>
                  <SettingSelect testId={tid.mleave.stageChannel(i)} small aria-label={`Stage ${i + 1} notification`} value={s.channel}
                    aria-invalid={invalid(channel)} onChange={e => setStage(i, { channel: e.target.value })}>
                    {STAGE_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</SettingSelect><Err text={channel} /></TableCell>
                {/* the employee and line manager stages stay, as the prototype offered Remove only from the third */}
                <TableCell className="text-right">{i > 1 && <Button testId={tid.mleave.stageRemove(i)} kind="ghost" small onClick={() => {
                  onChange(stages.filter((_, j) => j !== i));
                  toastInfo('Stage removed', SAVE_NOTE);
                }}>Remove</Button>}</TableCell>
              </Row>);
          })}</TableBody>
        </Table>
        <Err text={fe('stages')} />
      </div>
      <div className="mt-lg flex flex-wrap justify-end gap-sm">
        <Button testId={tid.mleave.stageAdd} kind="ghost" small onClick={() => {
          onChange([...stages, newStageDraft(stages.length + 1)]);
          toastInfo('Leave workflow stage added', SAVE_NOTE);
        }}>Add stage</Button></div>
    </>);
});

/* -------------------------------------------------- leaver reconciliation */
/* Days and the direction only; payroll settles the money (D13). */
function LeaversCard({ leavers }: { leavers: NonNullable<LeaveSetup['leavers']> }) {
  return (
    <AdminCard testId={tid.mleave.card('leavers')} icon={<Upload />} title="Leaver reconciliation" desc="Calculated at the leaving date against pro-rata entitlement">
      {leavers.rows.length
        ? <Table data-testid={tid.mleave.leavers}>
            <TableHeader><TableRow>
              <TableHead>Employee</TableHead><TableHead>Leaving</TableHead><TableHead className="text-right">Months worked</TableHead>
              <TableHead className="text-right">Full-year</TableHead><TableHead className="text-right">Pro-rata</TableHead>
              <TableHead className="text-right">Taken</TableHead><TableHead className="text-right">Difference</TableHead><TableHead>Outcome</TableHead>
            </TableRow></TableHeader>
            <TableBody>{leavers.rows.map(x => (
              <Row key={x.personCode} testId={tid.mleave.leaver(x.personCode)}>
                <TableCell><strong>{x.name}</strong><div className="font-mono text-xs text-text-muted">{x.personCode}</div></TableCell>
                <TableCell className="font-mono">{formatDmy(x.leaveDate)}</TableCell>
                <TableCell className="text-right tabular-nums">{x.months}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{x.full} d</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{x.prorata} d</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{x.taken} d</TableCell>
                <TableCell className={cn('text-right font-mono font-semibold tabular-nums', x.diff < 0 ? 'text-warn' : 'text-info')}>
                  {x.diff > 0 ? '+' : ''}{x.diff} d</TableCell>
                <TableCell><Pill tone={x.tone} glyph={x.diff === 0 ? '✓' : <TriangleAlert aria-hidden="true" />}>{x.verdict}</Pill><Small>{x.action}</Small></TableCell>
              </Row>))}</TableBody>
          </Table>
        : <Empty>Nobody is leaving with leave to reconcile.</Empty>}
      <p className="mt-sm text-xs text-text-muted">{leavers.settled}</p>
    </AdminCard>);
}

/* ------------------------------------------------ per-type leave policy */
/* The prototype set these on Employee types (v15:8160-8172); here they are
   saved with the rest of Leave setup and merged by employee type code. */
function TypeLeaveCard({ setup, policies, typeLeave, picked, onPick, fe, onChange }: {
  setup: LeaveSetup; policies: PolicyDraft[]; typeLeave: Record<string, TypeLeave>; picked: string; onPick(code: string): void;
  fe: FieldError; onChange(code: string, t: TypeLeave): void;
}) {
  const types = setup.employeeTypes;
  const current = types.find(t => t.code === picked) ?? types[0];
  const code = current?.code ?? '';
  const t = Object.hasOwn(typeLeave, code) ? typeLeave[code] : undefined;
  const i = policies.findIndex(p => p.code === t?.policy);
  const policy = policies[i];
  const carry = policy?.nums.carry ?? '0';
  const polErr = fe(`typeLeave.${code}.policy`) ?? fe(`typeLeave.${code}`), unitErr = fe(`typeLeave.${code}.unit`);
  return (
    <AdminCard testId={tid.mleave.card('typeLeave')} icon={<UsersRound />} title="Leave policy by employee type"
      desc="Which policy drives each type's entitlement, and how its balances are shown. Pick a type to configure.">
      <ChipPicker>{types.map(x => (
        <Chip key={x.code} testId={tid.mleave.empType(x.code)} on={x.code === code} onClick={() => onPick(x.code)}>{x.name}</Chip>))}</ChipPicker>
      {current && t && <>
        <SubHead>{current.name}</SubHead>
        <SettingRow title="Leave policy" desc="Drives entitlement, accrual and pro-rata for this type">
          <Control error={polErr}>
            <SettingSelect testId={tid.mleave.tlPolicy} aria-label={`Leave policy for ${current.name}`} value={t.policy} aria-invalid={invalid(polErr)}
              onChange={e => onChange(code, { ...t, policy: e.target.value })}>
              {policies.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</SettingSelect></Control>
        </SettingRow>
        <SettingRow title="Display unit" desc="How balances are shown to this type. Both are always held.">
          <Control error={unitErr}>
            <SettingSelect testId={tid.mleave.tlUnit} aria-label={`Display unit for ${current.name}`} value={t.unit} aria-invalid={invalid(unitErr)}
              onChange={e => onChange(code, { ...t, unit: e.target.value === 'hours' ? 'hours' : 'days' })}>
              <option value="days">Days</option><option value="hours">Hours</option></SettingSelect></Control>
        </SettingRow>
        {policy && <p data-testid={tid.mleave.tlNote} className="mt-sm text-xs text-text-muted">
          Policy: <b>{LEAVE_METHOD_LABEL[policy.method]}</b> · pro-rata {policy.prorata ? 'on' : 'off'} · {carry} days carry-over.</p>}
      </>}
    </AdminCard>);
}

import { useEffect, useState, type ReactNode } from 'react';
import { Check, FlaskConical, Minus, Plug, Ruler, SlidersHorizontal } from 'lucide-react';
import { useLocation } from 'react-router';
import { tid } from '@/testids';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  ActionBar, AdminCard, Button, Chip, ChipPicker, Empty, Field, FormWarn, GroupLabel, GuideButton, Modal, Page, PageHead, Pill, Row, ScopeBadge,
  SettingRow, SettingSelect as Asel, SettingText, Small, SubHead, SwitchField, TextInput, Tip, UnitInput, toastInfo,
} from '@/ui';
import { useSaveTimesheetConfig, useTimesheetConfig, type TimesheetConfig, type TimesheetSetup } from '@/api/timesheets';
import { useEmployeeTypes } from '@/api/reference';
import { useTenant } from '@/shell/shellData';
import type { EmployeeTypeRow } from '@/contract/employee-types';
import type { CaptureRules, PayCode, TypeCapture } from '@/contract/timesheets';
import type { TypeRule } from '@/domain/timesheet';
import { PAY_BASIS, RATE_TRIGGERS, WEEK_GRID_LABEL, WEEK_LAYOUT_LABEL, payBasisOf, payCodeList, payElement } from '@/domain/timesheet';
import { versionKey } from '@/lib/latest';
import {
  ALLOWANCE_EXISTS, HOW_APPLIED, allowanceCode, allowanceNeed, draftOf, emptyType, newRule, setupBody, setupFieldGroups,
  toggleMandatory, toggleVisible, type SetupDraft,
} from './setup';

/* Timesheet setup: the prototype's admTimesheet and admCaptureFields
   (qnipay-workforce-v15.html:8680-8764, 8085-8104). What each employee type
   captures, what the system refuses, the allowances and automatic pay rules
   per type, overtime, and the Business Central boundary. The prototype wrote
   each change as it was made; here every change edits one draft, Save sends
   it with If-Match and one audit row, and Cancel puts the draft back (D12).
   Pay codes are read here, never edited (module 6), and nothing carries an
   amount (D11). */
export function TimesheetSetupPage() {
  const setup = useTimesheetConfig(), types = useEmployeeTypes(), tenant = useTenant();
  const { hash } = useLocation();
  const [picked, setPicked] = useState<string | null>(null);
  const ready = setup.data && types.data && tenant.data;
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, ready]);
  return (
    <Page testId={tid.page('mts')}>
      {ready
        /* the draft starts again from what the server holds whenever the config gets a new version: after a save, or after a 412 */
        ? <SetupDraftView key={versionKey(setup.data.config)} setup={setup.data} types={types.data} env={tenant.data}
            picked={picked} onPick={setPicked} />
        : <Head />}
      {(setup.isError || types.isError || tenant.isError) &&
        <p data-testid={tid.mts.error} role="alert" className="text-err">Timesheet setup could not be loaded. Reload the page.</p>}
    </Page>);
}

function Head() {
  return <PageHead title="Timesheet setup" crumb="Modules · Timesheet · Timesheet setup" tipTestId={tid.head.tip('mts')}
    tip="What each employee type captures, what the system refuses, and how time reaches payroll"
    actions={<GuideButton view="mts" />} />;
}

const SUB_NOTE = 'font-normal text-text-muted';

function Err({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-xs text-xs text-err">{text}</p> : null;
}
const MODE: Record<string, string> = { clock: 'Clock entry', grid: 'Weekly grid', form: 'Day form' };
/* a select keeps the stored value even when it is not one of the usual choices */
const withValue = <T,>(opts: readonly T[], v: T) => (opts.includes(v) ? opts : [...opts, v]);
const RULE_SELECTS: { key: 'maxDaily' | 'warnDaily' | 'varianceWarn'; title: string; desc: string; opts: number[] }[] = [
  { key: 'maxDaily', title: 'Daily maximum (hours)', desc: 'A day above this is refused outright', opts: [12, 14, 16, 18, 20] },
  { key: 'warnDaily', title: 'Review threshold (hours)', desc: 'A day above this is flagged for the approver but allowed', opts: [8, 10, 12, 14] },
  { key: 'varianceWarn', title: 'Rota variance warning (hours)', desc: 'Hours away from the rota line before it is flagged', opts: [1, 2, 3, 4] },
];
const CUTOFF_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'] as const;
const TRIGGER_LABEL = (when: string) => {
  const t = Object.hasOwn(RATE_TRIGGERS, when) ? RATE_TRIGGERS[when] : undefined;
  return t ? t.label.charAt(0).toUpperCase() + t.label.slice(1) : 'Matches nothing yet';
};

interface Env { modules: Record<string, boolean>; flags: Record<string, boolean> }
function SetupDraftView({ setup, types, env, picked, onPick }: {
  setup: TimesheetSetup; types: EmployeeTypeRow[]; env: Env; picked: string | null; onPick(code: string): void;
}) {
  const { config, fields, payCodes } = setup;
  const [draft, setDraft] = useState<SetupDraft>(() => draftOf(config));
  const [adding, setAdding] = useState(false);
  const save = useSaveTimesheetConfig();
  const body = setupBody(config, draft);
  const dirty = Object.keys(body).length > 0;
  const current = types.find(t => t.code === picked) ?? types[0];
  const code = current?.code ?? '';
  const type = Object.hasOwn(draft.types, code) ? draft.types[code] ?? emptyType() : emptyType();
  const setType = (fn: (t: TypeCapture) => TypeCapture) => setDraft(d => ({ ...d, types: { ...d.types, [code]: fn(type) } }));
  const setRule = <K extends keyof CaptureRules>(k: K, v: CaptureRules[K]) => setDraft(d => ({ ...d, rules: { ...d.rules, [k]: v } }));
  const [cutoffDay = 'Monday', cutoffTime = '12:00'] = draft.cutoff.split(' ');
  const setCutoff = (day: string, time: string) => setDraft(d => ({ ...d, cutoff: `${day} ${time}` }));
  const fe = save.fieldError;
  /* a refusal about one employee type opens that type, so the field it names is on screen */
  const refusedType = /^types\.([^.]+)/.exec(save.refusal?.field ?? '')?.[1];
  useEffect(() => { if (refusedType) onPick(refusedType); }, [refusedType, onPick]);

  const submit = () => save.mutate({ config, body }, { onSuccess: d =>
    toastInfo(d.auditId ? 'Timesheet setup saved. It applies to the next save or submission.' : 'Timesheet setup · nothing changed') });
  const cancel = () => { setDraft(draftOf(config)); save.clearFieldErrors(); };

  return (
    <>
      <Head />
      {save.refusal && <FormWarn testId={tid.mts.warn}>{save.refusal.message} {save.refusal.next}</FormWarn>}

      <AdminCard testId={tid.mts.card('fields')} icon={<SlidersHorizontal />} title="Capture fields" tipTestId={tid.mts.tip('fields')}
        tip="Which fields each employee type fills in, and which are required. A field must be switched on under Features before a type can be given it.">
        <ChipPicker>
          {types.map(t => (
            <EmployeeTypeChip key={t.code} type={t} testId={tid.mts.fieldType(t.code)} selected={t.code === code} onClick={() => onPick(t.code)} />))}
        </ChipPicker>
        {current && <SubHead>Capture fields for {current.name}</SubHead>}
        {current && <CaptureFields fields={fields} env={{ ...env, capabilities: current.capabilities }} labels={config.fieldDefaults} type={type}
          onChange={map => setType(t => ({ ...t, fields: map }))} />}
      </AdminCard>

      <AdminCard testId={tid.mts.card('rules')} icon={<Ruler />} title="Capture rules" tipTestId={tid.mts.tip('rules')}
        tip="Applied when a day or a week is saved or submitted. Errors block the submission; thresholds only warn.">
        {RULE_SELECTS.map(r => (
          <SettingRow key={r.key} title={r.title} desc={r.desc}>
            <div className="flex flex-col items-end max-md:items-start">
              <Asel testId={tid.mts.rule(r.key)} aria-label={r.title} aria-invalid={fe(`rules.${r.key}`) ? true : undefined}
                value={draft.rules[r.key]} onChange={e => setRule(r.key, Number(e.target.value))}>
                {withValue(r.opts, draft.rules[r.key]).map(o => <option key={o} value={o}>{o}</option>)}</Asel>
              <Err text={fe(`rules.${r.key}`)} />
            </div>
          </SettingRow>))}
        <SettingRow title="Minimum net time" desc="The minimum recorded time after breaks">
          <div className="flex flex-col items-end max-md:items-start">
            <UnitInput testId={tid.mts.rule('minNet')} unit="hours" aria-label="Minimum net time" type="number" inputMode="decimal" step="0.25" min="0"
              value={draft.rules.minNet} aria-invalid={fe('rules.minNet') ? true : undefined}
              onChange={e => setRule('minNet', Number(e.target.value))} />
            <Err text={fe('rules.minNet')} />
          </div>
        </SettingRow>
        <SettingRow title="Night or unsocial window" desc="The time range used by automatic pay rules">
          <div className="flex flex-wrap items-center justify-end gap-sm max-md:justify-start">
            <label className="flex items-center gap-xs text-xs text-text-secondary">From
              <SettingText testId={tid.mts.rule('nightFrom')} className="w-[130px]" aria-label="Night window starts at" type="time" value={draft.rules.nightFrom}
                aria-invalid={fe('rules.nightFrom') ? true : undefined} onChange={e => setRule('nightFrom', e.target.value)} />
            </label>
            <label className="flex items-center gap-xs text-xs text-text-secondary">to
              <SettingText testId={tid.mts.rule('nightTo')} className="w-[130px]" aria-label="Night window ends at" type="time" value={draft.rules.nightTo}
                aria-invalid={fe('rules.nightTo') ? true : undefined} onChange={e => setRule('nightTo', e.target.value)} />
            </label>
            {(fe('rules.nightFrom') || fe('rules.nightTo')) && <Err text={fe('rules.nightFrom') ?? fe('rules.nightTo')} />}
          </div>
        </SettingRow>
        {([
          ['otDaily', 'Daily overtime threshold', 'Hours in one day before the daily overtime trigger applies', 24],
        ] as const).map(([key, title, desc, max]) => (
          <SettingRow key={key} title={title} desc={desc}>
            <div className="flex flex-col items-end max-md:items-start">
              <UnitInput testId={tid.mts.rule(key)} unit="hours" aria-label={title} type="number" inputMode="decimal" step="0.25" min="0" max={max}
                value={draft.rules[key]} aria-invalid={fe(`rules.${key}`) ? true : undefined}
                onChange={e => setRule(key, Number(e.target.value))} />
              <Err text={fe(`rules.${key}`)} />
            </div>
          </SettingRow>))}
        <SettingRow title={<>Block future-dated entry<Tip testId={tid.mts.tip('future')} text="Time cannot be recorded for a day that has not happened." /></>}
          desc="Refuse time for a date after today">
          <SwitchField testId={tid.mts.rule('blockFuture')} aria-label="Block future-dated entry" checked={draft.rules.blockFuture}
            onCheckedChange={v => setRule('blockFuture', v)} /></SettingRow>
        <SettingRow title="Warn on short rest" desc="Flag when rest against an adjacent shift is below the employee type’s rule">
          <SwitchField testId={tid.mts.rule('enforceRest')} aria-label="Warn on short rest" checked={draft.rules.enforceRest}
            onCheckedChange={v => setRule('enforceRest', v)} /></SettingRow>
        <SettingRow title="Pay-period cut-off" desc="The day and 24-hour time when the period closes">
          <div id="mts-cutoff" className="flex flex-wrap items-center justify-end gap-sm max-md:justify-start">
            <Asel testId={tid.mts.cutoffDay} aria-label="Pay-period cut-off day" value={cutoffDay}
              aria-invalid={fe('cutoff') ? true : undefined} onChange={e => setCutoff(e.target.value, cutoffTime)}>
              {CUTOFF_DAYS.map(day => <option key={day} value={day}>{day}</option>)}
            </Asel>
            <SettingText testId={tid.mts.cutoffTime} className="w-[130px]" aria-label="Pay-period cut-off time" type="time" value={cutoffTime}
              aria-invalid={fe('cutoff') ? true : undefined} onChange={e => setCutoff(cutoffDay, e.target.value)} />
            <Err text={fe('cutoff')} />
          </div>
        </SettingRow>
        <SettingRow title="Enforce period lock" desc="Refuse submissions and amendments after the cut-off">
          <div id="mts-period-lock"><SwitchField testId={tid.mts.rule('enforceLock')} aria-label="Enforce period lock" checked={draft.rules.enforceLock}
            aria-invalid={fe('rules.enforceLock') ? true : undefined} onCheckedChange={v => setRule('enforceLock', v)} /></div>
        </SettingRow>
        <SettingRow title="Return reason required" desc="Require an approver to give a reason when sending a timesheet back">
          <div id="mts-return-reason"><SwitchField testId={tid.mts.returnReasonRequired} aria-label="Return reason required" checked={draft.returnReasonRequired}
            onCheckedChange={v => setDraft(d => ({ ...d, returnReasonRequired: v }))} /></div>
        </SettingRow>
        {/* D6: what the weekly grid captures and how it is laid out live on the
            Weekly grid feature's row in Modules & features; this is a pointer to it */}
        {env.flags.WEEKLY && <SettingRow title="Weekly grid"
          desc={<span data-testid={tid.mtsPointer.weekly}>{WEEK_GRID_LABEL[config.weekGrid]}. {WEEK_LAYOUT_LABEL[config.weekLayout]}. Set on the Weekly grid row in Modules &amp; features.</span>}>{null}
        </SettingRow>}
      </AdminCard>

      <AdminCard testId={tid.mts.card('allowances')} icon={<FlaskConical />} title="Allowances & rules by employee type" tipTestId={tid.mts.tip('allowances')}
        tip="Allowances are declared by the employee on the day. Rules derive pay automatically in Business Central.">
        <ChipPicker>
          {types.map(t => (
            <EmployeeTypeChip key={t.code} type={t} testId={tid.mts.type(t.code)} selected={t.code === code} onClick={() => onPick(t.code)} />))}
        </ChipPicker>
        {current && <>
          <SubHead>Allowances this type can claim <span className={SUB_NOTE}>· the employee ticks these on the day; the value is what Business Central posts</span></SubHead>
          <Table variant="matrix" data-testid={tid.mts.allowTable}>
            <TableHeader><TableRow>
              <TableHead>Allowance</TableHead>
              <TableHead>Payroll mapping</TableHead>
              <TableHead className="text-center">Claimable</TableHead>
            </TableRow></TableHeader>
            <TableBody>
            {/* Keep unavailable allowances legible; disable only their claim switch and explain why. */}
            {Object.values(draft.allowances).map(a => {
              const need = allowanceNeed(a.tier), blocked = Boolean(need && !(current.capabilities as readonly string[]).includes(need));
              const on = type.allowances.includes(a.code), err = fe(`allowances.${a.code}.label`);
              return (
                <Row key={a.code} testId={tid.mts.allowRow(a.code)}>
                  <TableCell className="min-w-[220px]">
                    <TextInput testId={tid.mts.allowLabel(a.code)} aria-label={`${a.label} allowance name`} aria-invalid={err ? true : undefined} value={a.label}
                      onChange={e => setDraft(d => ({ ...d, allowances: { ...d.allowances, [a.code]: { ...a, label: e.target.value } } }))} />
                    <Err text={err} />
                  </TableCell>
                  <TableCell className="text-xs text-text-muted">{blocked && need ? `Needs the ${need} capability`
                    : <>Employee-declared · posts {a.code} to <b className="tabular-nums">{payElement(payCodes, draft.allowances, a.code)}</b></>}</TableCell>
                  <TableCell className="text-center"><SwitchField testId={tid.mts.allowOn(a.code)} aria-label={`${a.label} for ${current.name}`} checked={on} disabled={blocked}
                    onCheckedChange={() => setType(t => ({ ...t, allowances: on ? t.allowances.filter(x => x !== a.code) : [...t.allowances, a.code] }))} /></TableCell>
                </Row>);
            })}
            </TableBody>
          </Table>
          <Err text={fe(`types.${code}.allowances`)} />
          <div className="mt-lg flex flex-wrap justify-end gap-sm">
            <Button testId={tid.mts.allowAdd} kind="ghost" small onClick={() => setAdding(true)}>Add allowance</Button></div>

          <SubHead>Automatic pay rules <span className={SUB_NOTE}>· derived in Business Central from dates and hours, with no employee input</span></SubHead>
          <PayRules code={code} rules={type.rules} payCodes={payCodes} draft={draft} fe={fe} onChange={rules => setType(t => ({ ...t, rules }))} />

          <SubHead>Weekly overtime</SubHead>
          <Small testId={tid.mts.otDay}>Not built yet. Weekly overtime thresholds and multipliers are not applied by the timesheet rules.</Small>
        </>}
      </AdminCard>

      <AdminCard testId={tid.mts.card('boundary')} icon={<Plug />} title="Business Central boundary" tipTestId={tid.mts.tip('boundary')}
        tip="The platform posts hours and pay codes. Rates, tax treatment and gross-to-net stay in Business Central.">
        <Boundary />
      </AdminCard>

      {/* Save and Cancel stay in reach while a change waits to be saved */}
      <ActionBar stuck={dirty}>
        {dirty && <span data-testid={tid.mts.dirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        <Button testId={tid.mts.cancel} kind="ghost" disabled={!dirty || save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.mts.save} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>

      {adding && current && <AddAllowance typeName={current.name} exists={c => Object.hasOwn(draft.allowances, c)} onClose={() => setAdding(false)}
        onAdd={(c, label) => {
          setDraft(d => ({ ...d, allowances: { ...d.allowances, [c]: { code: c, label, payCode: c, tier: 'core' } } }));
          setType(t => ({ ...t, allowances: [...t.allowances, c] }));
          toastInfo(`${label} added. Save to put it on the form for ${current.name}.`);
        }} />}
    </>);
}

function EmployeeTypeChip({ type, testId, selected, onClick }: { type: EmployeeTypeRow; testId: string; selected: boolean; onClick(): void }) {
  return <Chip testId={testId} on={selected} onClick={onClick}>
    {type.name}<span className="text-xs opacity-70">{MODE[type.mode] ?? 'Day form'} · paid per {type.uom || 'hour'}</span></Chip>;
}

/* admCaptureFields and typeFieldRows: one row per field, Visible and Mandatory switches, the pack that owns it. */
function CaptureFields({ fields, env, labels, type, onChange }: {
  fields: TimesheetSetup['fields']; env: Env & { capabilities: readonly string[] }; labels: TimesheetConfig['fieldDefaults'];
  type: TypeCapture; onChange(map: TypeCapture['fields']): void;
}) {
  const groups = setupFieldGroups(fields, env, labels);
  let fieldRowIndex = 0;
  return (
    <Table variant="matrix" dense>
      <TableHeader><TableRow>
        <TableHead>Field</TableHead>
        <TableHead className="text-center">Visible<Tip testId={tid.mts.tip('visible')} text="Whether this type sees the field at all on its capture form." /></TableHead>
        <TableHead className="text-center">Mandatory<Tip testId={tid.mts.tip('mandatory')} text="Blocks submission until it is filled. Only the first occurrence of a repeating group can be mandatory." /></TableHead>
        <TableHead>Scope<Tip testId={tid.mts.tip('scope')} text="Which pack owns the field: core ships with the product, the rest arrive with an industry template." /></TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {groups.length === 0 && <Row testId={tid.mts.fieldsEmpty}><TableCell colSpan={4}>
          <Empty>No fields available. Give this type a capability under Employee types, or turn a feature on under Modules & features.</Empty></TableCell></Row>}
        {groups.map(g => [
          <Row key={`cat-${g.cat}`} testId={tid.mts.fieldCat(g.cat)} data-row-kind="category" className="!bg-surface-tint"><TableCell colSpan={4} className="text-xs font-[650] text-text-secondary">{g.cat}</TableCell></Row>,
          ...g.rows.map(({ field: f, label, max }) => {
            const s = Object.hasOwn(type.fields, f.c) ? type.fields[f.c] : undefined;
            const vis = Boolean(s?.vis);
            const stripe = fieldRowIndex++ % 2 === 1;
            return (
              <Row key={f.c} testId={tid.mts.fieldRow(f.c)} data-row-kind="field" className={stripe ? '!bg-surface-sunken' : '!bg-surface-card'}>
                <TableCell>{label}{max != null && <span className="text-xs text-text-muted"> up to {max}</span>}</TableCell>
                <TableCell className="text-center"><SwitchField testId={tid.mts.fieldVis(f.c)} aria-label={`Show ${label}`} checked={vis}
                  onCheckedChange={() => onChange(toggleVisible(type.fields, fields, f))} /></TableCell>
                <TableCell className="text-center"><SwitchField testId={tid.mts.fieldMand(f.c)} aria-label={`Make ${label} mandatory`} checked={Boolean(s?.mand)}
                  disabled={!vis} onCheckedChange={() => onChange(toggleMandatory(type.fields, fields, f))} /></TableCell>
                <TableCell>{f.tier === 'core' ? <span className="text-xs text-text-muted">Core</span> : <ScopeBadge>{f.tier}</ScopeBadge>}</TableCell>
              </Row>);
          }),
        ])}
      </TableBody>
    </Table>);
}

/* The automatic pay rules table. The code select resolves the element and its basis from the pay codes, which are read-only here. */
function PayRules({ code, rules, payCodes, draft, fe, onChange }: {
  code: string; rules: readonly TypeRule[]; payCodes: PayCode[]; draft: SetupDraft; fe(field: string): string | undefined;
  onChange(rules: TypeRule[]): void;
}) {
  const set = (i: number, patch: Partial<TypeRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const codes = payCodeList(payCodes, draft.allowances);
  const at = (i: number, k: string) => fe(`types.${code}.rules.${i}.${k}`);
  return (
    <>
      <Table variant="matrix">
        <TableHeader><TableRow>
          <TableHead>Trigger</TableHead><TableHead>Pay code</TableHead>
          <TableHead>BC element<Tip testId={tid.mts.tip('element')} text="Pulled from the Pay codes tab. A rule cannot invent an element." /></TableHead>
          <TableHead>Value</TableHead><TableHead>Applied</TableHead><TableHead><span className="sr-only">Remove</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rules.length === 0 && <Row testId={tid.mts.payEmpty}><TableCell colSpan={6}><Empty>No automatic rules for this type yet</Empty></TableCell></Row>}
          {rules.map((r, i) => {
            const basis = payBasisOf(payCodes, draft.allowances, r.code);
            return (
              <Row key={i} testId={tid.mts.payRow(i)}>
                <TableCell className="align-top">
                  <TextInput testId={tid.mts.payTrigger(i)} aria-label="Trigger" className="w-full min-w-[120px]" value={r.trigger} onChange={e => set(i, { trigger: e.target.value })} />
                  <Asel testId={tid.mts.payWhen(i)} small aria-label="What the trigger matches" className="mt-xs" value={r.when}
                    aria-invalid={at(i, 'when') ? true : undefined} onChange={e => set(i, { when: e.target.value })}>
                    {withValue(['', ...Object.keys(RATE_TRIGGERS)], r.when).map(w => <option key={w} value={w}>{TRIGGER_LABEL(w)}</option>)}</Asel>
                  <Err text={at(i, 'when')} />
                </TableCell>
                <TableCell className="align-top">
                  <Asel testId={tid.mts.payCode(i)} small aria-label="Pay code" value={r.code} aria-invalid={at(i, 'code') ? true : undefined}
                    onChange={e => set(i, { code: e.target.value })}>
                    {withValue(codes, r.code).map(c => <option key={c} value={c}>{c}</option>)}</Asel>
                  <Err text={at(i, 'code')} />
                </TableCell>
                <TableCell className="align-top text-xs text-text-muted tabular-nums">{payElement(payCodes, draft.allowances, r.code)}
                  <span className="block">{(Object.hasOwn(PAY_BASIS, basis) ? PAY_BASIS[basis as keyof typeof PAY_BASIS].label : basis).toLowerCase()}</span></TableCell>
                <TableCell className="align-top">
                  <TextInput testId={tid.mts.payValue(i)} aria-label="Value" className="w-[90px] min-w-0 tabular-nums" value={r.value}
                    aria-invalid={at(i, 'value') ? true : undefined} onChange={e => set(i, { value: e.target.value })} />
                  <Err text={at(i, 'value')} />
                </TableCell>
                <TableCell className="align-top">
                  <Asel testId={tid.mts.payHow(i)} small aria-label="Applied" value={r.how} onChange={e => set(i, { how: e.target.value })}>
                    {withValue<string>(HOW_APPLIED, r.how).map(h => <option key={h} value={h}>{h}</option>)}</Asel>
                </TableCell>
                <TableCell className="align-top text-right">
                  <Button testId={tid.mts.payRemove(i)} kind="ghost" small onClick={() => onChange(rules.filter((_, j) => j !== i))}>Remove</Button></TableCell>
              </Row>);
          })}
        </TableBody>
      </Table>
      <div className="mt-lg flex flex-wrap justify-end gap-sm">
        <Button testId={tid.mts.payAdd} kind="ghost" small onClick={() => onChange([...rules, newRule()])}>Add rule</Button></div>
    </>);
}

/* What crosses the boundary, and what never does. Static. */
const POSTED = ['Employee ID', 'Date and hours', 'Pay code and element', 'Cost centre and project', 'Location / site', 'Approval record'];
const NEVER = ['Pay rates', 'Tax treatment', 'Gross to net', 'Payslips, P45, P60', 'RTI filing'];
function Boundary() {
  const line = (label: string, pill: ReactNode) => (
    <div key={label} className="flex items-center justify-between gap-md border-b py-sm text-sm last:border-b-0"><span>{label}</span>{pill}</div>);
  return (
    <div className="grid grid-cols-2 gap-md max-lg:grid-cols-1">
      <div><GroupLabel>Posted to Business Central</GroupLabel>
        {POSTED.map(p => line(p, <Pill tone="ok" glyph={<Check />}><span className="sr-only">Posted</span></Pill>))}</div>
      <div><GroupLabel>Never determined here</GroupLabel>
        {NEVER.map(p => line(p, <Pill tone="neu" glyph={<Minus />}>Payroll</Pill>))}</div>
    </div>);
}

/* allow-add: the prototype asked with prompt(); here a small dialog. The
   allowance joins the draft and this type's list, and is stored on Save. */
function AddAllowance({ typeName, exists, onClose, onAdd }: {
  typeName: string; exists(code: string): boolean; onClose(): void; onAdd(code: string, label: string): void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const add = () => {
    const label = name.trim(), c = allowanceCode(name);
    if (!label || !c.replace(/_/g, '')) { setError('Give the allowance a name.'); return; }
    if (exists(c)) { setError(ALLOWANCE_EXISTS); return; }
    onAdd(c, label);
    onClose();
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Add allowance"
      footer={<>
        <Button testId={tid.mts.allowCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.mts.allowConfirm} kind="primary" onClick={add}>Add allowance</Button>
      </>}>
      <Field label="Allowance name" hint={`It is offered to ${typeName} once saved. Business Central decides what it is worth.`} error={error}>
        <TextInput testId={tid.mts.allowName} placeholder="e.g. Waking night" value={name} onChange={e => { setName(e.target.value); setError(undefined); }} />
      </Field>
    </Modal>);
}

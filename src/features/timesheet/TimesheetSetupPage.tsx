import { useEffect, useState, type ReactNode } from 'react';
import { Check, FlaskConical, Minus, Plug, Ruler, SlidersHorizontal } from 'lucide-react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  ActionBar, AdminCard, Button, Chip, ChipPicker, Empty, Field, FormWarn, GroupLabel, GuideButton, Modal, Page, PageHead, Pill, Row, ScopeBadge,
  INLINE_INPUT, SettingRow, SettingSelect as Asel, Small, SwitchField, TextInput, Tip, UnitInput, toastInfo,
} from '@/ui';
import { useSaveTimesheetConfig, useTimesheetConfig, type TimesheetConfig, type TimesheetSetup } from '@/api/timesheets';
import { useEmployeeTypes } from '@/api/reference';
import { useTenant } from '@/shell/shellData';
import type { EmployeeTypeRow } from '@/contract/employee-types';
import type { CaptureRules, PayCode, TypeCapture } from '@/contract/timesheets';
import type { TypeRule } from '@/domain/timesheet';
import { PAY_BASIS, RATE_TRIGGERS, WEEK_GRID_LABEL, WEEK_GRIDS, WEEK_LAYOUT_LABEL, WEEK_LAYOUTS, payBasisOf, payCodeList, payElement } from '@/domain/timesheet';
import { versionKey } from '@/lib/latest';
import {
  ALLOWANCE_EXISTS, DEFAULT_OVERTIME, HOW_APPLIED, allowanceCode, allowanceNeed, draftOf, emptyType, newRule, setupBody, setupFieldGroups,
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
  const [picked, setPicked] = useState<string | null>(null);
  const ready = setup.data && types.data && tenant.data;
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

/* .inl and .asel are shared (src/ui FormParts). */
const INL = INLINE_INPUT;
/* .wtsub (v15:1503-1506) */
const SUB = 'mt-lg mb-sm border-b pb-xs text-xs font-[650] tracking-normal text-text-secondary first:mt-0';
const SUB_NOTE = 'font-normal text-text-muted';

function Err({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-xs text-xs text-err">{text}</p> : null;
}
const MODE: Record<string, string> = { clock: 'Clock entry', grid: 'Weekly grid', form: 'Day form' };
/* a select keeps the stored value even when it is not one of the usual choices */
const withValue = <T,>(opts: readonly T[], v: T) => (opts.includes(v) ? opts : [...opts, v]);
const RULE_SELECTS: { key: 'maxDaily' | 'warnDaily' | 'varianceWarn'; title: string; desc: string; opts: number[] }[] = [
  { key: 'maxDaily', title: 'Daily maximum', desc: 'A day above this is refused outright', opts: [12, 14, 16, 18, 20] },
  { key: 'warnDaily', title: 'Review threshold', desc: 'A day above this is flagged for the approver but allowed', opts: [8, 10, 12, 14] },
  { key: 'varianceWarn', title: 'Rota variance warning', desc: 'Hours away from the rota line before it is flagged', opts: [1, 2, 3, 4] },
];
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
            <Chip key={t.code} testId={tid.mts.fieldType(t.code)} on={t.code === code} onClick={() => onPick(t.code)}>
              {t.name}<span className="text-xs opacity-70">{MODE[t.mode] ?? 'Day form'} · paid per {t.uom || 'hour'}</span></Chip>))}
        </ChipPicker>
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
        <SettingRow title={<>Block future-dated entry<Tip testId={tid.mts.tip('future')} text="Time cannot be recorded for a day that has not happened." /></>}
          desc="Refuse time for a date after today">
          <SwitchField testId={tid.mts.rule('blockFuture')} aria-label="Block future-dated entry" checked={draft.rules.blockFuture}
            onCheckedChange={v => setRule('blockFuture', v)} /></SettingRow>
        <SettingRow title="Warn on short rest" desc="Flag when rest against an adjacent shift is below the employee type’s rule">
          <SwitchField testId={tid.mts.rule('enforceRest')} aria-label="Warn on short rest" checked={draft.rules.enforceRest}
            onCheckedChange={v => setRule('enforceRest', v)} /></SettingRow>
        {env.flags.WEEKLY && <>
          <SettingRow title="Weekly grid" desc="What the weekly grid asks for">
            <Asel testId={tid.mts.weekGrid} small aria-label="Weekly grid" value={draft.weekGrid}
              onChange={e => { const v = WEEK_GRIDS.find(x => x === e.target.value); if (v) setDraft(d => ({ ...d, weekGrid: v })); }}>
              {WEEK_GRIDS.map(g => <option key={g} value={g}>{WEEK_GRID_LABEL[g]}</option>)}</Asel></SettingRow>
          <SettingRow title="Weekly view layout" desc="How the week is laid out on the weekly grid">
            <Asel testId={tid.mts.weekLayout} small aria-label="Weekly view layout" value={draft.weekLayout}
              onChange={e => { const v = WEEK_LAYOUTS.find(x => x === e.target.value); if (v) setDraft(d => ({ ...d, weekLayout: v })); }}>
              {WEEK_LAYOUTS.map(l => <option key={l} value={l}>{WEEK_LAYOUT_LABEL[l]}</option>)}</Asel></SettingRow>
        </>}
      </AdminCard>

      <AdminCard testId={tid.mts.card('allowances')} icon={<FlaskConical />} title="Allowances & rules by employee type"
        desc="Allowances are declared by the employee on the day. Rules derive pay automatically in Business Central. Pick a type to configure.">
        <ChipPicker>
          {types.map(t => (
            <Chip key={t.code} testId={tid.mts.type(t.code)} on={t.code === code} onClick={() => onPick(t.code)}>
              {t.name} <span className="text-xs font-bold tracking-[.05em] opacity-70">{t.uom === 'day' ? 'DAY' : 'HR'}</span></Chip>))}
        </ChipPicker>
        {current && <>
          <h3 className={SUB}>Allowances this type can claim <span className={SUB_NOTE}>· the employee ticks these on the day; the value is what Business Central posts</span></h3>
          <div>
            {/* An allowance the type lacks the capability for is not dimmed as a whole row, as the
                prototype did: at half opacity its name and line fall below AA contrast. Its switch
                is disabled and the line says which capability it needs. */}
            {Object.values(draft.allowances).map(a => {
              const need = allowanceNeed(a.tier), blocked = Boolean(need && !(current.capabilities as readonly string[]).includes(need));
              const on = type.allowances.includes(a.code), err = fe(`allowances.${a.code}.label`);
              return (
                <div key={a.code} data-testid={tid.mts.allowRow(a.code)} className="flex flex-wrap items-center gap-md border-b py-[10px] last:border-b-0">
                  <div className="min-w-[200px] flex-1">
                    <input data-testid={tid.mts.allowLabel(a.code)} aria-label="Allowance name" className={INL} value={a.label} aria-invalid={err ? true : undefined}
                      onChange={e => setDraft(d => ({ ...d, allowances: { ...d.allowances, [a.code]: { ...a, label: e.target.value } } }))} />
                    <span className="mt-px block text-xs text-text-muted">{blocked && need ? `Needs the ${need} capability`
                      : <>Employee-declared · posts {a.code} to <b className="tabular-nums">{payElement(payCodes, draft.allowances, a.code)}</b></>}</span>
                    <Err text={err} />
                  </div>
                  <SwitchField testId={tid.mts.allowOn(a.code)} aria-label={`${a.label} for ${current.name}`} checked={on} disabled={blocked}
                    onCheckedChange={() => setType(t => ({ ...t, allowances: on ? t.allowances.filter(x => x !== a.code) : [...t.allowances, a.code] }))} />
                </div>);
            })}
          </div>
          <Err text={fe(`types.${code}.allowances`)} />
          <div className="mt-lg flex flex-wrap justify-end gap-sm">
            <Button testId={tid.mts.allowAdd} kind="ghost" small onClick={() => setAdding(true)}>Add allowance</Button></div>

          <h3 className={SUB}>Automatic pay rules <span className={SUB_NOTE}>· derived in Business Central from dates and hours, with no employee input</span></h3>
          <PayRules code={code} rules={type.rules} payCodes={payCodes} draft={draft} fe={fe} onChange={rules => setType(t => ({ ...t, rules }))} />

          <h3 className={SUB}>Overtime thresholds <span className={SUB_NOTE}>· hourly types only</span></h3>
          {(current.uom || 'hour') === 'day'
            ? <Small testId={tid.mts.otDay}>{current.name} is paid per worked day, so weekly overtime thresholds do not apply.
                Switch the pay basis to hourly on the Employee types tab to use them.</Small>
            : <OvertimeRows key={code} code={code} overtime={type.overtime} fe={fe} onChange={overtime => setType(t => ({ ...t, overtime }))} />}
          <Small className="mt-[10px]">These are thresholds and multipliers, not amounts.</Small>
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

/* admCaptureFields and typeFieldRows: one row per field, Visible and Mandatory switches, the pack that owns it. */
function CaptureFields({ fields, env, labels, type, onChange }: {
  fields: TimesheetSetup['fields']; env: Env & { capabilities: readonly string[] }; labels: TimesheetConfig['fieldDefaults'];
  type: TypeCapture; onChange(map: TypeCapture['fields']): void;
}) {
  const groups = setupFieldGroups(fields, env, labels);
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
          <Row key={`cat-${g.cat}`} testId={tid.mts.fieldCat(g.cat)}><TableCell colSpan={4} className="text-xs font-[650] text-text-secondary">{g.cat}</TableCell></Row>,
          ...g.rows.map(({ field: f, label, max }) => {
            const s = Object.hasOwn(type.fields, f.c) ? type.fields[f.c] : undefined;
            const vis = Boolean(s?.vis);
            return (
              <Row key={f.c} testId={tid.mts.fieldRow(f.c)}>
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
                <TableCell>
                  <input data-testid={tid.mts.payTrigger(i)} aria-label="Trigger" className={INL} value={r.trigger} onChange={e => set(i, { trigger: e.target.value })} />
                  <Asel testId={tid.mts.payWhen(i)} small aria-label="What the trigger matches" className="mt-xs" value={r.when}
                    aria-invalid={at(i, 'when') ? true : undefined} onChange={e => set(i, { when: e.target.value })}>
                    {withValue(['', ...Object.keys(RATE_TRIGGERS)], r.when).map(w => <option key={w} value={w}>{TRIGGER_LABEL(w)}</option>)}</Asel>
                  <Err text={at(i, 'when')} />
                </TableCell>
                <TableCell>
                  <Asel testId={tid.mts.payCode(i)} small aria-label="Pay code" value={r.code} aria-invalid={at(i, 'code') ? true : undefined}
                    onChange={e => set(i, { code: e.target.value })}>
                    {withValue(codes, r.code).map(c => <option key={c} value={c}>{c}</option>)}</Asel>
                  <Err text={at(i, 'code')} />
                </TableCell>
                <TableCell className="text-xs text-text-muted tabular-nums">{payElement(payCodes, draft.allowances, r.code)}
                  <span className="block">{(Object.hasOwn(PAY_BASIS, basis) ? PAY_BASIS[basis as keyof typeof PAY_BASIS].label : basis).toLowerCase()}</span></TableCell>
                <TableCell>
                  <input data-testid={tid.mts.payValue(i)} aria-label="Value" className={cn(INL, 'min-w-[96px] max-w-[90px] tabular-nums')} value={r.value}
                    aria-invalid={at(i, 'value') ? true : undefined} onChange={e => set(i, { value: e.target.value })} />
                  <Err text={at(i, 'value')} />
                </TableCell>
                <TableCell>
                  <Asel testId={tid.mts.payHow(i)} small aria-label="Applied" value={r.how} onChange={e => set(i, { how: e.target.value })}>
                    {withValue<string>(HOW_APPLIED, r.how).map(h => <option key={h} value={h}>{h}</option>)}</Asel>
                </TableCell>
                <TableCell className="text-right">
                  <Button testId={tid.mts.payRemove(i)} kind="ghost" small onClick={() => onChange(rules.filter((_, j) => j !== i))}>Remove</Button></TableCell>
              </Row>);
          })}
        </TableBody>
      </Table>
      <div className="mt-lg flex flex-wrap justify-end gap-sm">
        <Button testId={tid.mts.payAdd} kind="ghost" small onClick={() => onChange([...rules, newRule()])}>Add rule</Button></div>
    </>);
}

/* The weekly overtime rows. A type with no thresholds yet shows the prototype's defaults; they are stored only once one is changed. */
type OtKey = keyof typeof DEFAULT_OVERTIME;
const OT_ROWS: { key: OtKey; title: string; desc: string; unit: string }[] = [
  { key: 'threshold', title: 'Weekly overtime threshold', desc: 'Hours per week before overtime applies', unit: 'hrs' },
  { key: 'multiplier', title: 'Weekly overtime multiplier', desc: 'Rate beyond the threshold', unit: '×' },
  { key: 'weekendMultiplier', title: 'Weekend / bank-holiday multiplier', desc: 'Applied automatically by date from the shared calendar', unit: '×' },
];
function OvertimeRows({ code, overtime, fe, onChange }: {
  code: string; overtime: TypeCapture['overtime']; fe(field: string): string | undefined; onChange(o: NonNullable<TypeCapture['overtime']>): void;
}) {
  const ot = overtime ?? DEFAULT_OVERTIME;
  /* the text as typed, so a half-typed "1." or an empty box is not rewritten under the cursor */
  const [text, setText] = useState<Record<OtKey, string>>(() => ({
    threshold: String(ot.threshold), multiplier: String(ot.multiplier), weekendMultiplier: String(ot.weekendMultiplier) }));
  return (
    <div>
      {OT_ROWS.map(r => {
        /* both multipliers are refused under one name */
        const err = fe(`types.${code}.overtime.${r.key === 'weekendMultiplier' ? 'multiplier' : r.key}`);
        return (
          <SettingRow key={r.key} title={r.title} desc={r.desc}>
            <div className="flex flex-col items-end max-md:items-start">
              <UnitInput testId={tid.mts.ot(r.key)} unit={r.unit} aria-label={r.title} type="number" inputMode="decimal" step="0.1" min="0"
                value={text[r.key]} aria-invalid={err ? true : undefined}
                onChange={e => {
                  const v = e.target.value;
                  setText(t => ({ ...t, [r.key]: v }));
                  onChange({ ...ot, [r.key]: v.trim() === '' || !Number.isFinite(Number(v)) ? 0 : Number(v) });
                }} />
              <Err text={err} />
            </div>
          </SettingRow>);
      })}
    </div>);
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

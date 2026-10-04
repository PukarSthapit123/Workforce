import { useState, type ReactNode } from 'react';
import { Clock, Link2, RadioTower, Repeat, Shield, Target, UsersRound } from 'lucide-react';
import { tid } from '@/testids';
import {
  ActionBar, AdminCard, Button, Card, CheckboxField, Chip, ChipPicker, ConfirmModal, Empty, FormWarn, GuideButton, InlineInput, Page, PageHead, Pill, Row,
  SettingRow, SettingSelect, SubHead, SwitchField, Tip, UnitInput, toastInfo, toastRefusal,
} from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useDimension, type InUseRow } from '@/api/reference';
import { useDeletePattern, usePatterns, useRotaConfig, useSaveRotaConfig, useShiftCatalogue, type PatternRecord, type RotaSetup } from '@/api/rota';
import { useTenant } from '@/shell/shellData';
import { versionKey } from '@/lib/latest';
import { FULFIL_AUDIENCES, FULFIL_CHANNELS, HORIZONS, ROTA_BUILT_BY, genLabel } from '@/domain/rota';
import { SUPPORT_LEVELS } from '@/features/dimensions/spec';
import { NewShiftTypeDialog, ShiftCatalogueBody } from './ShiftCatalogue';
import { NewPatternDialog, PatternEditor, PatternPeopleDialog, activePill, type PatternCtx } from './PatternEditor';
import { PatternUploadDialog } from './PatternUpload';
import { draftOf, newStageDraft, rotaBody, type NumKey, type RotaDraft, type ToggleKey, type TypeDraft, type TypeNumKey } from './setup';

/* Rota setup: the prototype's admRota (qnipay-workforce-v15.html:8765-8864)
   with the per-type rota eligibility it kept on the employee type (8144-8157).
   The shift catalogue and the working patterns are the same pieces Shift
   catalogue and Working patterns use, each saved on its own record. Every
   other setting edits one draft: Save sends it with If-Match and one audit
   row with the before and after, Cancel puts it back (D12). The prototype
   applied each change as it was made. The module's feature switches belong
   to Modules & features, so they are shown here as they stand. Nothing here
   carries a rate or an amount (D10). */
const CRUMB = 'Modules · Rota · Rota setup';
const OFF = 'The Rota module is off for this tenant. Turn it on under Modules & features.';
const FLAG_NOTE = 'Switched on or off under Modules & features.';

export function RotaSetupPage() {
  const tenant = useTenant();
  const on = tenant.data?.modules.R === true;
  const setup = useRotaConfig(on);
  const refused = setup.error instanceof ApiError ? setup.error.refusal : null;
  return (
    <Page testId={tid.page('mrota')}>
      <Head bare={tenant.data ? !on : false} />
      {tenant.data && !on && <Card><Empty testId={tid.mrota.off}>{OFF}</Empty></Card>}
      {on && <>
        <CatalogueCard />
        <PatternsCard horizon={setup.data?.config.horizon ?? HORIZONS[0]} />
        {setup.data
          /* the draft starts again from what the server holds whenever the config gets a new version: after a save, or after a 412 */
          ? <SetupDraftView key={versionKey(setup.data.config)} setup={setup.data} flags={tenant.data?.flags ?? {}} />
          : !setup.isError && <p data-testid={tid.mrota.loading} className="text-text-secondary">Loading Rota setup&hellip;</p>}
      </>}
      {(setup.isError || tenant.isError) && <p data-testid={tid.mrota.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Rota setup could not be loaded. Reload the page.'}</p>}
    </Page>);
}

function Head({ bare }: { bare?: boolean }) {
  return bare
    ? <PageHead title="Rota setup" crumb={CRUMB} />
    : <PageHead title="Rota setup" crumb={CRUMB} tipTestId={tid.head.tip('mrota')}
        tip="Shift catalogue, working patterns, staffing, eligibility and the fulfilment workflow" actions={<GuideButton view="mrota" />} />;
}

function Err({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-xs text-xs text-err">{text}</p> : null;
}
/* a control with its error under it, right-aligned in a setting row */
function Control({ error, children }: { error?: string; children: ReactNode }) {
  return <div className="flex flex-col items-end max-md:items-start">{children}<Err text={error} /></div>;
}

/* ------------------------------------------------------- shift catalogue */
function CatalogueCard() {
  const q = useShiftCatalogue();
  const [adding, setAdding] = useState(false);
  return (
    <AdminCard testId={tid.mrota.card('shifts')} icon={<Clock />} title="Shift catalogue" tipTestId={tid.mrota.tip('shifts')}
      tip="Bespoke shift patterns capable of covering 24 hours a day, 7 days a week, including shifts that cross midnight." desc="The shifts this workforce runs">
      {q.isError && <p data-testid={tid.tshifts.error} role="alert" className="text-err">The shift catalogue could not be loaded. Reload the page to try again.</p>}
      {!q.data && !q.isError && <p data-testid={tid.tshifts.loading} className="text-text-secondary">Loading the shift catalogue&hellip;</p>}
      {q.data && <ShiftCatalogueBody catalogue={q.data} onAdd={() => setAdding(true)} />}
      {adding && q.data && <NewShiftTypeDialog codes={q.data.items.map(s => s.code)} onClose={() => setAdding(false)} />}
    </AdminCard>);
}

/* ------------------------------------------------------ working patterns */
type Box = { k: 'edit' | 'people' | 'upload' | 'delete'; code: string; back?: boolean } | { k: 'new' } | { k: 'upload' } | null;
function PatternsCard({ horizon }: { horizon: number }) {
  /* The list carries today and the locations this person may cover, so an
     administrator without team_rota builds patterns here as P's admRota let them. */
  const list = usePatterns(), cat = useShiftCatalogue(), del = useDeletePattern();
  const locs = useDimension('locations'), jobs = useDimension('job-profiles'), ccs = useDimension('cost-centres');
  const [box, setBox] = useState<Box>(null);
  const refused = list.error instanceof ApiError ? list.error.refusal : null;
  const nameIn = (rows: readonly { code: string; name: string }[] | undefined) => (c: string) => rows?.find(x => x.code === c)?.name ?? c;
  const locName = nameIn(locs.data ?? list.data?.canCover), jobName = nameIn(jobs.data);
  const ready = list.data && cat.data;
  const ctx: PatternCtx | null = ready ? {
    shifts: cat.data.items, people: list.data.people, today: list.data.today, canCover: list.data.canCover, elsewhere: list.data.elsewhere,
    locations: (locs.data ?? list.data.canCover).filter(l => !('active' in l) || l.active !== false).map(l => ({ code: l.code, name: l.name })),
    jobs: (jobs.data ?? []).map(j => ({ code: j.code, name: j.name })), costCentres: (ccs.data ?? []).map(c => ({ code: c.code, name: c.name })),
  } : null;
  const at = (code: string) => list.data?.items.find(p => p.code === code);
  const cur = box && 'code' in box ? at(box.code) : undefined;
  const close = () => setBox(null);
  const names = (codes: readonly string[], fn: (c: string) => string) => codes.map(fn).join(', ') || '—';
  return (
    <AdminCard testId={tid.mrota.card('patterns')} icon={<Repeat />} title="Working patterns" tipTestId={tid.mrota.tip('patterns')}
      tip="Set a pattern once and the rota is generated from it, up to the configured horizon."
      desc="A pattern repeats on its cycle, keeps its cost centre, and is associated to locations and job profiles">
      {list.isError && <p data-testid={tid.mrota.patternsError} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Working patterns could not be loaded. Reload the page to try again.'}</p>}
      {list.data && cat.isError && <p data-testid={tid.mrota.patternsBlocked} role="alert" className="text-err">
        Patterns cannot be opened or added until the shift catalogue loads. Reload the page to try again.</p>}
      {list.data && (list.data.items.length
        ? <Table data-testid={tid.mrota.patterns}>
            <TableHeader><TableRow>
              <TableHead>Pattern</TableHead><TableHead className="text-right">Repeats every</TableHead><TableHead>Locations</TableHead>
              <TableHead>Job profiles</TableHead><TableHead>Cost centre</TableHead><TableHead className="text-right">People</TableHead>
              <TableHead>Horizon</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>{list.data.items.map((p: PatternRecord) => (
              <Row key={p.code} testId={tid.mrota.pattern(p.code)}>
                <TableCell><strong>{p.name}</strong><div className="font-mono text-xs text-text-muted">{p.code}</div></TableCell>
                <TableCell className="text-right tabular-nums">{p.cycle} days</TableCell>
                <TableCell className="text-xs text-text-muted">{names(p.locations, locName)}</TableCell>
                <TableCell className="text-xs text-text-muted">{names(p.jobProfiles, jobName)}</TableCell>
                <TableCell className="font-mono text-xs">{p.costCentre}</TableCell>
                <TableCell className="text-right tabular-nums">{p.people.length}</TableCell>
                <TableCell className="text-xs text-text-muted">{genLabel(p)}</TableCell>
                <TableCell>{activePill(p)}</TableCell>
                <TableCell className="text-right"><Button testId={tid.mrota.patternOpen(p.code)} kind="ghost" small disabled={!ctx}
                  onClick={() => setBox({ k: 'edit', code: p.code })}>Open</Button></TableCell>
              </Row>))}</TableBody>
          </Table>
        : <Empty testId={tid.mrota.patternsEmpty}>No working patterns yet</Empty>)}
      <div className="mt-lg flex flex-wrap justify-end gap-sm">
        <Button testId={tid.patUpload.open} kind="ghost" small onClick={() => setBox({ k: 'upload' })}>Upload patterns from a file</Button>
        <Button testId={tid.mrota.newPattern} kind="ghost" small disabled={!ctx} onClick={() => setBox({ k: 'new' })}>New pattern</Button>
      </div>
      {box?.k === 'upload' && <PatternUploadDialog horizon={horizon} onClose={() => setBox('code' in box ? { k: 'edit', code: box.code } : null)} />}
      {ctx && list.data && box?.k === 'new' && <NewPatternDialog patterns={list.data.items} ctx={ctx} onClose={close} onCreated={code => setBox({ k: 'edit', code })} />}
      {/* a saved pattern opens again from the server's copy */}
      {ctx && box?.k === 'edit' && cur && <PatternEditor key={`${cur.code}:${cur.version}`} pattern={cur} ctx={ctx} onClose={close}
        onAddPeople={() => setBox({ k: 'people', code: cur.code, back: true })} onUpload={() => setBox({ k: 'upload', code: cur.code })}
        onDelete={() => setBox({ k: 'delete', code: cur.code })} />}
      {box?.k === 'delete' && cur && <ConfirmModal open onOpenChange={o => { if (!o) setBox({ k: 'edit', code: cur.code }); }}
        title={`Delete ${cur.name}?`} confirmLabel="Delete the pattern" danger busy={del.anyPending}
        body={`Shifts already generated and published stay on the rota. Nothing further will be generated from this pattern, and ${
          cur.people.length ? `${cur.people.length} person(s) will no longer be scheduled by it.` : 'nobody is currently on it.'}`}
        onConfirm={() => del.mutate(cur, { onSuccess: () => { close(); toastInfo(`${cur.name} deleted`, 'Published shifts are untouched.'); } })} />}
      {ctx && box?.k === 'people' && cur && <PatternPeopleDialog pattern={cur} ctx={ctx}
        onClose={() => setBox(box.back ? { k: 'edit', code: cur.code } : null)} />}
    </AdminCard>);
}

/* ------------------------------------------------------------ the draft */
const SAFE_ROWS: { key: keyof RotaSetup['config']['safeRules']; title: string; desc: string }[] = [
  { key: 'clearance', title: 'Clearance / DBS', desc: 'Excludes anybody whose clearance has lapsed' },
  { key: 'quals', title: 'Qualifications', desc: 'Excludes anybody with an expired qualification' },
  { key: 'night', title: 'Night training / eligibility', desc: 'Excludes untrained workers from night shifts' },
  { key: 'availability', title: 'Current availability', desc: 'Excludes anybody on approved leave or recorded sick' },
  { key: 'conflicts', title: 'Existing shift conflicts', desc: 'Excludes anybody already working that day' },
  { key: 'maxHours', title: 'Maximum hours', desc: 'Excludes anybody the shift would push past their maximum' },
  { key: 'rest', title: 'Minimum rest', desc: 'Excludes anybody left with less than the configured rest' },
  { key: 'consec', title: 'Consecutive days', desc: 'Excludes anybody past their consecutive-day limit' },
];

function SetupDraftView({ setup, flags }: { setup: RotaSetup; flags: Record<string, boolean> }) {
  const { config, employeeTypes, shifts } = setup;
  const typeCodes = employeeTypes.map(t => t.code);
  const [draft, setDraft] = useState<RotaDraft>(() => draftOf(config, typeCodes));
  const [picked, setPicked] = useState<string>(typeCodes[0] ?? '');
  const save = useSaveRotaConfig();
  const locs = useDimension('locations');
  const body = rotaBody(config, draft);
  const dirty = Object.keys(body).length > 0;
  const fe = save.fieldError;
  const set = (patch: Partial<RotaDraft>) => setDraft(d => ({ ...d, ...patch }));
  const setNum = (k: NumKey, v: string) => setDraft(d => ({ ...d, nums: { ...d.nums, [k]: v } }));
  const setToggle = (k: ToggleKey, v: boolean) => setDraft(d => ({ ...d, toggles: { ...d.toggles, [k]: v } }));
  const setStage = (i: number, patch: Partial<RotaDraft['stages'][number]>) =>
    setDraft(d => ({ ...d, stages: d.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  /* a refusal about one employee type opens that type, so the field it names is on screen */
  const refusedType = /^types\.([^.]+)/.exec(save.refusal?.field ?? '')?.[1];
  const [seen, setSeen] = useState(save.refusal);
  if (save.refusal !== seen) {
    setSeen(save.refusal);
    if (refusedType) setPicked(refusedType);
  }
  const swOn = flags.SAFEWORKER === true;

  const submit = () => save.mutate({ config, body }, { onSuccess: d =>
    toastInfo(d.auditId ? 'Rota setup saved. It applies across the tenant straight away.' : 'Rota setup · nothing changed') });
  const cancel = () => { setDraft(draftOf(config, typeCodes)); save.clearFieldErrors(); };

  const flagRow = (code: string, title: string, desc: string, tip?: ReactNode) => (
    <SettingRow title={<>{title}{tip}</>} desc={<>{desc}<span className="block">{FLAG_NOTE}</span></>}>
      <SwitchField testId={tid.mrota.flag(code)} aria-label={title} checked={flags[code] === true} disabled /></SettingRow>);
  const numRow = (k: NumKey, title: string, desc: string | undefined, unit: string) => (
    <SettingRow title={title} desc={desc}>
      <Control error={fe(k)}>
        <UnitInput testId={tid.mrota.num(k)} unit={unit} aria-label={title} type="number" inputMode="decimal" min="0" value={draft.nums[k]}
          aria-invalid={fe(k) ? true : undefined} onChange={e => setNum(k, e.target.value)} /></Control></SettingRow>);
  const toggleRow = (k: ToggleKey, title: string, desc: string) => (
    <SettingRow title={title} desc={desc}>
      <SwitchField testId={tid.mrota.toggle(k)} aria-label={title} checked={draft.toggles[k]} onCheckedChange={v => setToggle(k, v)} /></SettingRow>);

  return (
    <>
      <AdminCard testId={tid.mrota.card('staffing')} icon={<Target />} title="Minimum staffing" tipTestId={tid.mrota.tip('staffing')}
        tip="Each location has a configurable staffing requirement driven by its support level." desc="Support level determines how many people every shift needs">
        {flagRow('MINSTAFF', 'Check coverage against minimum staffing', 'When off, the rota shows headcount but never flags a gap.')}
        {numRow('minDefault', 'Default people per shift', 'Used where a location has no support level', 'people')}
        {toggleRow('publishBlockOnGap', 'Coverage gaps block publishing', 'Hours warnings never block; coverage shortfalls do')}
        <SettingRow title={<>Who builds the rota<Tip testId={tid.mrota.tip('builtBy')} text="A tenant policy above the permission matrix. Both must agree." /></>}
          desc={draft.rotaBuiltBy === 'Admins only'
            ? 'Managers cannot create or generate working patterns, whatever the permission matrix says'
            : 'Managers may build patterns for the location they manage, if the matrix grants it'}>
          <Control error={fe('rotaBuiltBy')}>
            <SettingSelect testId={tid.mrota.builtBy} aria-label="Who builds the rota" value={draft.rotaBuiltBy}
              aria-invalid={fe('rotaBuiltBy') ? true : undefined} onChange={e => set({ rotaBuiltBy: e.target.value })}>
              {ROTA_BUILT_BY.map(o => <option key={o} value={o}>{o}</option>)}</SettingSelect></Control>
        </SettingRow>
        <div className="mt-md">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Support level</TableHead><TableHead className="text-right">People per shift</TableHead>
              <TableHead className="text-right">Locations</TableHead><TableHead>Locations at this level</TableHead>
            </TableRow></TableHeader>
            <TableBody>{SUPPORT_LEVELS.map(s => {
              const here = (locs.data ?? []).filter((l: InUseRow) => 'level' in l && l.level === s.code);
              return (
                <Row key={s.code} testId={tid.mrota.level(s.code)}>
                  <TableCell><strong>{s.label}</strong></TableCell>
                  <TableCell className="text-right tabular-nums">{s.min} people</TableCell>
                  <TableCell className="text-right tabular-nums">{here.length}</TableCell>
                  <TableCell className="text-xs text-text-muted">{here.map(l => l.name).join(', ') || '—'}</TableCell>
                </Row>);
            })}</TableBody>
          </Table>
          <p className="mt-sm text-xs text-text-muted">Each location's support level and people per shift are set on the location, under Locations.</p>
        </div>
      </AdminCard>

      <AdminCard testId={tid.mrota.card('fulfil')} icon={<RadioTower />} title="Shift fulfilment workflow" tipTestId={tid.mrota.tip('fulfil')}
        tip="Triggers automatically when coverage falls below minimum, and can also be started by hand. Every value below is a setting."
        desc="Timed, staged cover requests with a widening audience and escalation">
        {flagRow('FULFIL', 'Fulfilment workflow enabled', 'Opens a cover request automatically when coverage falls below minimum.')}
        {numRow('favHeadStart', 'Favourite head start', 'How long favourites are asked before everyone else', 'min')}
        {toggleRow('agencyManual', 'Agency booking', 'No automatic link to agency systems. Bookings are made by hand after escalation.')}
        <div className="mt-md">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-[52px]">Stage</TableHead><TableHead>Audience</TableHead><TableHead className="text-right">Wait</TableHead>
              <TableHead>Notification</TableHead><TableHead>Next action</TableHead><TableHead><span className="sr-only">Remove</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>{draft.stages.map((s, i) => {
              const at = (k: string) => fe(`stages.${i}.${k}`);
              return (
                <Row key={i} testId={tid.mrota.stage(i)}>
                  <TableCell><Pill tone="neu">{i + 1}</Pill></TableCell>
                  <TableCell>
                    <SettingSelect testId={tid.mrota.stageAudience(i)} small aria-label={`Stage ${i + 1} audience`} value={s.audience}
                      aria-invalid={at('audience') ? true : undefined} onChange={e => setStage(i, { audience: e.target.value })}>
                      {FULFIL_AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}</SettingSelect><Err text={at('audience')} /></TableCell>
                  <TableCell className="text-right">
                    <UnitInput testId={tid.mrota.stageWait(i)} unit="min" aria-label={`Stage ${i + 1} wait in minutes`} type="number" inputMode="numeric" min="0"
                      className="ml-auto" value={s.wait} aria-invalid={at('wait') ? true : undefined} onChange={e => setStage(i, { wait: e.target.value })} />
                    <Err text={at('wait')} /></TableCell>
                  <TableCell>
                    <SettingSelect testId={tid.mrota.stageChannel(i)} small aria-label={`Stage ${i + 1} notification`} value={s.channel}
                      aria-invalid={at('channel') ? true : undefined} onChange={e => setStage(i, { channel: e.target.value })}>
                      {FULFIL_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</SettingSelect><Err text={at('channel')} /></TableCell>
                  <TableCell><InlineInput testId={tid.mrota.stageNext(i)} aria-label={`Stage ${i + 1} next action`} value={s.next}
                    onChange={e => setStage(i, { next: e.target.value })} /></TableCell>
                  <TableCell className="text-right"><Button testId={tid.mrota.stageRemove(i)} kind="ghost" small onClick={() => {
                    if (draft.stages.length < 2) { toastRefusal({ message: 'Keep at least one stage.', next: 'Add another stage before removing this one.' }); return; }
                    set({ stages: draft.stages.filter((_, j) => j !== i) });
                    toastInfo('Stage removed', 'Save to keep the change.');
                  }}>Remove</Button></TableCell>
                </Row>);
            })}</TableBody>
          </Table>
          <Err text={fe('stages')} />
        </div>
        <div className="mt-lg flex flex-wrap justify-end gap-sm">
          <Button testId={tid.mrota.stageAdd} kind="ghost" small onClick={() => {
            set({ stages: [...draft.stages, newStageDraft(draft.stages.length + 1)] });
            toastInfo('Fulfilment stage added', 'Save to keep the change.');
          }}>Add stage</Button></div>
      </AdminCard>

      <AdminCard testId={tid.mrota.card('safe')} icon={<Shield />} title="Safe-worker rules" tipTestId={tid.mrota.tip('safe')}
        tip="Flexible work is only advertised to workers who are safe to work. Each rule below is a hard exclusion." desc="Which checks exclude somebody from being offered a shift">
        {flagRow('SAFEWORKER', 'Safe-worker filtering enabled', 'When off, every worker is offered every shift regardless of clearance.')}
        {/* With filtering off the rule switches are disabled. The rows are not dimmed as
            the prototype did: at its opacity the 12px line falls below AA contrast. */}
        {SAFE_ROWS.map(r => (
          <SettingRow key={r.key} title={r.title} desc={r.desc}>
            <SwitchField testId={tid.mrota.safe(r.key)} aria-label={r.title} checked={draft.safeRules[r.key]} disabled={!swOn}
              onCheckedChange={v => set({ safeRules: { ...draft.safeRules, [r.key]: v } })} /></SettingRow>))}
        {numRow('restHours', 'Minimum rest between shifts', 'Default where the employee type has no stricter value', 'hrs')}
        {numRow('maxHours', 'Maximum hours anyone can be rota’d', 'The lower of this, the employee type and the person’s own maximum applies', 'hrs')}
        {numRow('maxConsec', 'Maximum consecutive days', undefined, 'days')}
      </AdminCard>

      <AdminCard testId={tid.mrota.card('it')} icon={<Link2 />} title="IT access and calendars" desc="What happens once a shift is fulfilled">
        {flagRow('ITACCESS', 'Raise an IT access request when a shift is filled', 'Simulated in this build. There is no real service-desk integration.',
          <Tip testId={tid.mrota.tip('it')} text="Sends the employee ID, location and shift details so site access can be set up." />)}
        {toggleRow('outlook', 'Put shifts and leave in Outlook calendars', 'Two-way with Microsoft 365. Calendar sync is not built yet, so this only offers Add to Outlook on My shifts.')}
        {toggleRow('bhEnhanced', 'Bank-holiday enhanced rate flagged', 'Flagged for payroll. The rate is resolved in Business Central.')}
        <SettingRow title="Rota horizon" desc="How far ahead the rota is generated from patterns">
          <Control error={fe('horizon')}>
            <SettingSelect testId={tid.mrota.horizon} aria-label="Rota horizon" value={draft.horizon}
              aria-invalid={fe('horizon') ? true : undefined} onChange={e => set({ horizon: Number(e.target.value) })}>
              {HORIZONS.map(m => <option key={m} value={m}>{m} months</option>)}</SettingSelect></Control>
        </SettingRow>
      </AdminCard>

      <TypeLimits types={employeeTypes} shifts={shifts} draft={draft} picked={picked} onPick={setPicked} fe={fe}
        onChange={(code, t) => setDraft(d => ({ ...d, types: { ...d.types, [code]: t } }))} />

      {save.refusal && <FormWarn testId={tid.mrota.warn}>{save.refusal.message} {save.refusal.next}</FormWarn>}
      {/* Save and Cancel stay in reach while a change waits to be saved */}
      <ActionBar stuck={dirty}>
        {dirty && <span data-testid={tid.mrota.dirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        <Button testId={tid.mrota.cancel} kind="ghost" disabled={!dirty || save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.mrota.save} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>
    </>);
}

/* The rota eligibility of each employee type (v15:8144-8157): which shifts it
   may work, nights, and its own hours, rest and consecutive-day limits. */
const TYPE_NUMS: { key: TypeNumKey; title: string; desc?: string; unit: string }[] = [
  { key: 'maxHours', title: 'Maximum hours', desc: 'Operational maximum for this type. The lower of this and the person’s own maximum applies.', unit: 'hrs' },
  { key: 'restHours', title: 'Minimum rest', desc: 'Between the end of one shift and the start of the next', unit: 'hrs' },
  { key: 'maxConsec', title: 'Maximum consecutive days', unit: 'days' },
];
function TypeLimits({ types, shifts, draft, picked, onPick, fe, onChange }: {
  types: RotaSetup['employeeTypes']; shifts: RotaSetup['shifts']; draft: RotaDraft; picked: string; onPick(code: string): void;
  fe(field: string): string | undefined; onChange(code: string, t: TypeDraft): void;
}) {
  const current = types.find(t => t.code === picked) ?? types[0];
  const code = current?.code ?? '';
  const t = Object.hasOwn(draft.types, code) ? draft.types[code] : undefined;
  const at = (k: string) => fe(`types.${code}.${k}`);
  const order = shifts.map(s => s.code);
  return (
    <AdminCard testId={tid.mrota.card('types')} icon={<UsersRound />} title="Rota eligibility by employee type"
      desc="Hard rules the fulfilment workflow enforces. Pick a type to configure.">
      <ChipPicker>{types.map(x => (
        <Chip key={x.code} testId={tid.mrota.type(x.code)} on={x.code === code} onClick={() => onPick(x.code)}>{x.name}</Chip>))}</ChipPicker>
      {current && t && <>
        <SubHead>{current.name}</SubHead>
        <SettingRow title="Eligible shift types" desc="Which shifts this type may be assigned to">
          <div className="flex flex-wrap items-center gap-md">
            {shifts.map(s => (
              <label key={s.code} className="flex cursor-pointer items-center gap-[6px] text-xs">
                <CheckboxField testId={tid.mrota.typeShift(s.code)} checked={t.shifts.includes(s.code)} aria-label={`${s.name} for ${current.name}`}
                  onCheckedChange={v => onChange(code, { ...t, shifts: v === true
                    ? order.filter(c => c === s.code || t.shifts.includes(c))
                    : t.shifts.filter(c => c !== s.code) })} />
                {s.name}</label>))}
          </div>
        </SettingRow>
        <Err text={at('shifts') ?? fe(`types.${code}`)} />
        <SettingRow title="Night eligibility" desc="Whether this type may be allocated to night work at all">
          <SwitchField testId={tid.mrota.typeNight} aria-label={`Night eligibility for ${current.name}`} checked={t.night}
            onCheckedChange={v => onChange(code, { ...t, night: v })} /></SettingRow>
        {TYPE_NUMS.map(r => (
          <SettingRow key={r.key} title={r.title} desc={r.desc}>
            <Control error={at(r.key)}>
              <UnitInput testId={tid.mrota.typeNum(r.key)} unit={r.unit} aria-label={`${r.title} for ${current.name}`} type="number" inputMode="decimal" min="0"
                value={t.nums[r.key]} aria-invalid={at(r.key) ? true : undefined}
                onChange={e => onChange(code, { ...t, nums: { ...t.nums, [r.key]: e.target.value } })} /></Control>
          </SettingRow>))}
        <SettingRow title="Flexible-worker behaviour" desc="Counts bank weeks and appears in the flexible-worker milestones">
          <SwitchField testId={tid.mrota.typeFlexible} aria-label={`Flexible-worker behaviour for ${current.name}`} checked={t.flexible}
            onCheckedChange={v => onChange(code, { ...t, flexible: v })} /></SettingRow>
      </>}
    </AdminCard>);
}

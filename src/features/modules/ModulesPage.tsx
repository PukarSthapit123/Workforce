import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Blocks, Calendar, ClipboardList, Clock, LayoutGrid, SlidersHorizontal, Users } from 'lucide-react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import {
  AdminCard, Banner, Caution, ConfirmModal, Empty, IconTile, NavLink, Page, PageHead, Pill, ScopeBadge, SearchFilter, FilterBar,
  SettingRow, SettingSelect, Small, Stepper, SubHead, SwitchField, toastInfo,
} from '@/ui';
import { useSetFlag, useSetModule, useTenant, type ModuleSwitched, type Tenant } from '@/api/tenant';
import {
  EXTRA_BOUNDS, MODULES, WEEK_GRIDS, WEEK_LAYOUTS, enableNote, flagsFor, modSubs, moduleBy, moduleLive, modOn, offConfirm,
  type FlagDef, type ModuleDef, type SubDef,
} from '@/domain/modules';

/* Modules & features: the prototype's admModulesIndex, moduleEnableRow and
   admModuleFeatures (qnipay-workforce-v15.html:8570-8679), with the data-mod
   and data-flag handlers and the mod-off confirm (11119-11142, 12545-12559).
   The index is a card per module; opening one (/setup/amods?m=<code>) shows
   its enable row and its features, with the extras that hang off a feature
   on that feature's row (D6). Every switch is live for the whole tenant at
   once: it writes through useSetModule or useSetFlag with the tenant's
   version, and the screen changes only once the server has answered and the
   tenant has been read again. The toast is the server's own words. */
const ICON: Record<string, ReactNode> = { users: <Users />, clock: <Clock />, grid: <LayoutGrid />, calendar: <Calendar />, clipboard: <ClipboardList /> };
const iconOf = (m: ModuleDef) => ICON[m.icon] ?? <Blocks />;
const CAUTION = 'Switching a module or a feature takes effect for the whole tenant at once. There is no draft stage in this build.';
const LICENCE = 'In this build these switches stand in for licence entitlements. In the product, what a tenant has is decided by their licence, not by an administrator.';
const FEATURES_TIP = 'Tenant-wide switches. Employee types then decide who actually sees the fields a feature unlocks.';
const OFF_NOTE = 'These are shown rather than hidden so it is clear what switching the module on would bring back.';

export function ModulesPage() {
  const [params] = useSearchParams();
  const tenant = useTenant();
  const m = moduleBy(params.get('m') ?? '');
  const view = m ? 'mfeat' : 'amods';
  return (
    <Page testId={tid.page(view)}>
      {tenant.data ? (m ? <ModuleFeatures m={m} tenant={tenant.data} /> : <ModulesIndex tenant={tenant.data} />)
        : <>
            {m ? <FeaturesHead m={m} /> : <IndexHead />}
            {tenant.isError
              ? <p data-testid={tid.amods.error} role="alert" className="text-err">Modules could not be loaded. Reload the page.</p>
              : <p data-testid={tid.amods.loading} className="text-text-secondary">Loading modules&hellip;</p>}
          </>}
    </Page>);
}

/* ------------------------------------------------------------ the index */
function IndexHead() {
  return <PageHead title="Modules & features" tipTestId={tid.head.tip('amods')}
    tip="What this tenant runs. Open a module for its features and its configuration."
    actions={<Caution testId={tid.head.caution('amods')} text={CAUTION} />} />;
}
const hit = (q: string, ...texts: string[]) => texts.some(t => t.toLowerCase().includes(q.toLowerCase()));

function ModulesIndex({ tenant }: { tenant: Tenant }) {
  const [q, setQ] = useState('');
  const query = q.trim();
  const shown = MODULES.filter(m => !query || hit(query, m.name, m.description)
    || modSubs(m).some(x => hit(query, x.name, x.description)) || flagsFor(m).some(f => hit(query, f.label, f.description)));
  return (
    <>
      <IndexHead />
      <FilterBar><SearchFilter testId={tid.amods.search} label="Search a module or feature" placeholder="Search a module or feature"
        value={q} onChange={e => setQ(e.target.value)} /></FilterBar>
      <div className="mb-md grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-md">
        {shown.map(m => <ModuleCard key={m.code} m={m} tenant={tenant} />)}
      </div>
      {!shown.length && <Empty testId={tid.amods.empty}>Nothing matches that search</Empty>}
    </>);
}

/* .setupcard as a module (v15:8577-8593, 1406-1432): the icon tile, the name
   with "Always on" or an Off pill, what the module is about, and a brand
   line counting its capture methods and features and naming its setup page.
   An off module's card sits on the sunken surface with a muted tile. */
function ModuleCard({ m, tenant }: { m: ModuleDef; tenant: Tenant }) {
  const on = moduleLive(tenant.modules, m);
  const kids = flagsFor(m), methods = modSubs(m).filter(x => x.kind === 'method');
  const methodsOn = methods.filter(x => modOn(tenant.modules, x.code)).length;
  const live = kids.filter(f => tenant.flags[f.code] === true).length;
  const counts = [
    methods.length ? `${methodsOn} of ${methods.length} capture methods` : '',
    kids.length ? (on ? `${live} of ${kids.length} features` : `${kids.length} features`) : 'No features',
    m.setupLabel ?? '',
  ].filter(Boolean).join(' · ');
  return (
    <NavLink to={`/setup/amods?m=${m.code}`} testId={tid.amods.card(m.code)}
      className={cn('flex items-start gap-md rounded-card border p-lg text-left transition-[border-color,box-shadow] duration-(--qp-duration-fast) ease-qp hover:border-brand hover:shadow-sm dark:hover:border-brand-accent',
        on ? 'bg-surface-card' : 'bg-surface-sunken')}>
      <IconTile off={!on}>{iconOf(m)}</IconTile>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={cn('text-base leading-[normal] font-semibold', on ? 'text-text-primary' : 'text-text-muted')}>{m.name}
          <span data-testid={tid.amods.cardState(m.code)}>{m.locked ? <ScopeBadge>Always on</ScopeBadge>
            : !on && <Pill tone="neu" glyph="—" className="ml-[6px] align-middle">Off</Pill>}</span></span>
        <span className="text-xs leading-[1.45] text-text-muted">{m.description}</span>
        <span data-testid={tid.amods.cardCounts(m.code)}
          className={cn('mt-xs text-xs font-semibold', on ? 'text-brand dark:text-brand-accent' : 'text-text-muted')}>{counts}</span>
      </span>
    </NavLink>);
}

/* -------------------------------------------------------- the drill-in */
function FeaturesHead({ m, off }: { m: ModuleDef; off?: boolean }) {
  return <PageHead title={`${m.name} features`} crumb={`Modules · ${m.name} · ${m.name} features`}
    tip={m.description} tipTestId={tid.head.tip('mfeat')}
    actions={off ? <Pill testId={tid.amods.offPill} tone="neu" glyph="—">Module off</Pill> : undefined} />;
}

/* What a module switch kept, in a sentence, after the server's own message. */
function keptLine(effect: ModuleSwitched['effect']): string | undefined {
  const kept = effect.kept.filter(k => k.count > 0).map(k => `${k.count} ${k.what}`);
  return kept.length ? `Kept as they were: ${kept.join(', ')}.` : undefined;
}

function ModuleFeatures({ m, tenant }: { m: ModuleDef; tenant: Tenant }) {
  const setModule = useSetModule(), setFlag = useSetFlag();
  const [confirm, setConfirm] = useState<string | null>(null);
  const busy = setModule.anyPending || setFlag.anyPending;
  const on = moduleLive(tenant.modules, m);
  const licensed = !m.master || modOn(tenant.modules, m.code);
  const kids = flagsFor(m), subs = modSubs(m);
  const own = kids.filter(f => f.mod === m.code);

  const switchModule = (code: string, next: boolean) => {
    if (!next) { setConfirm(code); return; }
    setModule.mutate({ code, on: true, ifMatch: tenant.version }, { onSuccess: d => toastInfo(d.effect.message) });
  };
  const turnOff = (code: string) => setModule.mutate({ code, on: false, ifMatch: tenant.version },
    { onSuccess: d => { setConfirm(null); toastInfo(d.effect.message, keptLine(d.effect)); } });
  const change = (f: FlagDef, c: Parameters<typeof setFlag.mutate>[0]['change']) =>
    setFlag.mutate({ code: f.code, change: c, ifMatch: tenant.version }, { onSuccess: d => toastInfo(d.message) });

  const modSwitch = (code: string, name: string, disabled: boolean) => (
    <SwitchField testId={tid.amods.mod(code)} aria-label={`Turn ${name} ${modOn(tenant.modules, code) ? 'off' : 'on'}`}
      checked={modOn(tenant.modules, code) || (code === m.code && m.locked === true)} disabled={disabled || busy}
      onCheckedChange={v => switchModule(code, v)} />);

  const extra = (f: FlagDef): ReactNode => {
    if (!on || tenant.flags[f.code] !== true) return null;
    const x = tenant.extras;
    if (f.code === 'WEEKLY') return <>
      <SettingSelect testId={tid.amods.weekGrid} small aria-label="What the weekly grid captures" value={x.weekGrid} disabled={busy}
        onChange={e => { const v = WEEK_GRIDS.find(([k]) => k === e.target.value); if (v) change(f, { weekGrid: v[0] }); }}>
        {WEEK_GRIDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SettingSelect>
      <SettingSelect testId={tid.amods.weekLayout} small aria-label="Weekly view layout" value={x.weekLayout} disabled={busy}
        onChange={e => { const v = WEEK_LAYOUTS.find(([k]) => k === e.target.value); if (v) change(f, { weekLayout: v[0] }); }}>
        {WEEK_LAYOUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SettingSelect></>;
    if (f.code === 'BREAKS') return <>
      <Stepper label="Breaks per entry" value={x.breaksMax} min={EXTRA_BOUNDS.breaksMax.min} max={EXTRA_BOUNDS.breaksMax.max} disabled={busy}
        downTestId={tid.amods.stepDown('breaksMax')} upTestId={tid.amods.stepUp('breaksMax')} valueTestId={tid.amods.stepValue('breaksMax')}
        onChange={v => change(f, { breaksMax: v })} /><span className="text-xs text-text-muted">per entry</span></>;
    if (f.code === 'VEHICLE') return <>
      <Stepper label="Vehicles per entry" value={x.vehiclesMax} min={EXTRA_BOUNDS.vehiclesMax.min} max={EXTRA_BOUNDS.vehiclesMax.max} disabled={busy}
        downTestId={tid.amods.stepDown('vehiclesMax')} upTestId={tid.amods.stepUp('vehiclesMax')} valueTestId={tid.amods.stepValue('vehiclesMax')}
        onChange={v => change(f, { vehiclesMax: v })} /><span className="text-xs text-text-muted">max per entry</span></>;
    return null;
  };
  /* A feature row. An off module's rows stay at full strength, rather than
     the prototype's opacity .45 (below AA contrast); their switches are
     disabled and the banner above says why. */
  const featRow = (f: FlagDef, sub: boolean) => (
    <Nested key={f.code} sub={sub} testId={tid.amods.row(f.code)}>
      <SettingRow title={f.label} desc={f.description}>
        {extra(f)}
        <SwitchField testId={tid.amods.flag(f.code)} aria-label={`Turn ${f.label} ${tenant.flags[f.code] ? 'off' : 'on'}`}
          checked={tenant.flags[f.code] === true} disabled={!on || busy} onCheckedChange={v => change(f, { on: v })} />
      </SettingRow>
    </Nested>);
  /* a capability, with whatever features belong to it nested underneath */
  const subBlock = (x: SubDef) => [
    <Nested key={x.code} testId={tid.amods.row(x.code)}>
      <SettingRow title={x.name} desc={x.description}>{modSwitch(x.code, x.name, !licensed)}</SettingRow></Nested>,
    ...kids.filter(f => f.mod === x.code).map(f => featRow(f, true)),
  ];
  const groups = ([['method', 'Capture methods'], ['capability', 'Capabilities']] as const)
    .map(([kind, label]) => ({ label, subs: subs.filter(x => x.kind === kind) })).filter(g => g.subs.length);
  const pending = confirm ? offConfirm(confirm) : null;

  return (
    <>
      <FeaturesHead m={m} off={!on} />
      <AdminCard testId={tid.amods.moduleCard} icon={iconOf(m)} title={m.name} tip={LICENCE} tipTestId={tid.amods.moduleTip}>
        <SettingRow title={m.locked ? 'Always on' : 'Module enabled'} desc={<span data-testid={tid.amods.enableNote}>{enableNote(tenant.modules, m)}</span>}>
          {modSwitch(m.code, m.name, m.locked === true)}
        </SettingRow>
      </AdminCard>
      {kids.length || subs.length
        ? <AdminCard testId={tid.amods.features} icon={<SlidersHorizontal />} title="Features" tip={FEATURES_TIP} tipTestId={tid.amods.featuresTip}>
            {!on && <Banner testId={tid.amods.offBanner} tone="warn" title={`${m.name} is off`}>{OFF_NOTE}</Banner>}
            {groups.map(g => <div key={g.label}><SubHead>{g.label}</SubHead>{g.subs.flatMap(subBlock)}</div>)}
            {own.length > 0 && <div>{subs.length > 0 && <SubHead>Across all capture methods</SubHead>}{own.map(f => featRow(f, false))}</div>}
          </AdminCard>
        : <Small testId={tid.amods.noFeatures}>This module has no feature switches of its own</Small>}
      {pending && confirm && <ConfirmModal open onOpenChange={o => { if (!o) setConfirm(null); }} title={pending.title} body={pending.body}
        confirmLabel={pending.confirm} cancelLabel={pending.cancel} danger busy={busy} onConfirm={() => turnOff(confirm)} />}
    </>);
}

/* .arow.sub (v15:676-678): a feature that belongs to a capability sits under
   it, indented 22px with a 2px rule down its left. */
function Nested({ sub, testId, children }: { sub?: boolean; testId: string; children: ReactNode }) {
  return <div data-testid={testId} className={cn('border-b last:border-b-0', sub && 'relative pl-[22px] before:absolute before:inset-y-0 before:left-sm before:w-[2px] before:bg-border')}>{children}</div>;
}

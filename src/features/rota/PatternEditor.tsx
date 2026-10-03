import { useState, type ReactNode } from 'react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import {
  Avatar, Banner, Button, CheckboxField, Field, FieldGrid, FormWarn, Modal, NativeSelect, Pill, Row, SelectBox, SettingRow, SettingText, Small, SubHead,
  SwitchField, TextInput, Tip, UnitInput, toastInfo,
} from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  useAddPatternPeople, useCreatePattern, useGeneratePattern, useUpdatePattern, type PatternGenerated, type PatternRecord, type ShiftTypeRecord, type UpdatePattern,
} from '@/api/rota';
import { addDays, periodStart } from '@/domain/time';
import { GEN_PERIODS, clampCycle, genBy, genLabel, genRange, resizeCycle, shiftBy, shiftName, shiftTime, staggerOffsets, TICK_SOMEONE } from '@/domain/rota';
import type { PatternCandidate } from '@/contract/rota';
import type { z } from 'zod';

/* The working pattern windows: the prototype's patternDetail inside
   patternWindow, patternBox and patternPersonBox (qnipay-workforce-v15.html:
   8865-8958, 9073-9082, 10329-10411). The editor is shared with Rota setup.
   The prototype applied each field as it changed; here the window edits one
   draft, and Save sends it with If-Match and one audit row, Cancel puts it
   back. Generating and adding people work on the saved pattern, so they wait
   until the draft is saved. */

export type Candidate = z.infer<typeof PatternCandidate>;
export interface Named { code: string; name: string }
/* What the windows need to name things and to offer choices. */
export interface PatternCtx {
  shifts: readonly ShiftTypeRecord[]; people: readonly Candidate[]; locations: readonly Named[]; jobs: readonly Named[]; costCentres: readonly Named[];
  /* the locations a new pattern may cover: the manager's own, or every one an admin manages */
  canCover: readonly Named[]; today: string;
}
const nameIn = (list: readonly Named[]) => (code: string) => list.find(x => x.code === code)?.name ?? code;
const pluralOf = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const activePill = (p: Pick<PatternRecord, 'active'>, testId?: string) =>
  <Pill testId={testId} tone={p.active ? 'ok' : 'neu'} glyph={p.active ? '✓' : '–'}>{p.active ? 'Active' : 'Draft'}</Pill>;

/* save-pattern (v15:12257-12290): the summary is the server's, from what was
   actually written; rest warnings follow as a second note. */
export function useGenerateRun() {
  const gen = useGeneratePattern();
  return {
    pending: (code: string) => gen.isPending(`rota/pattern/${code}`),
    run: (p: PatternRecord, then?: (r: PatternGenerated) => void) => gen.mutate({ pattern: p, body: {} }, { onSuccess: r => {
      toastInfo(r.summary);
      if (r.rest.length) toastInfo(`Rest warnings: ${r.rest.slice(0, 4).join('; ')}${r.rest.length > 4 ? `; and ${r.rest.length - 4} more` : ''}`, 'Check those weeks on Team rota.');
      then?.(r);
    } }),
  };
}

/* .cyc (v15:1191-1200): each day of the cycle in its shift's colours, tapped through the catalogue and back to rest. */
const CYC_TONE: Record<string, string> = {
  E: 'bg-(--qp-rota-early-surface) text-(--qp-rota-early-ink) font-semibold',
  L: 'bg-(--qp-rota-late-surface) text-(--qp-rota-late-ink) font-semibold',
  N: 'bg-(--qp-rota-night-surface) text-(--qp-rota-night-ink) font-semibold',
};
/* .pick .pc (v15:1486-1494): a chosen location or job profile with its remove button. */
function PickChip({ testId, label, onRemove, children }: { testId: string; label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[6px] rounded-pill border border-transparent bg-brand-subtle py-xs pr-[6px] pl-[10px] text-xs font-semibold text-brand dark:bg-surface-tint dark:text-text-primary">
      {children}
      <button type="button" data-testid={testId} aria-label={label} onClick={onRemove}
        className="relative size-[17px] rounded-full text-xs leading-none opacity-65 before:absolute before:-inset-[13px] hover:bg-surface-card hover:opacity-100">✕</button>
    </span>);
}

type Draft = Pick<PatternRecord, 'name' | 'cycle' | 'starts' | 'active' | 'days' | 'locations' | 'jobProfiles' | 'costCentre' | 'gen' | 'genFrom' | 'genTo' | 'horizon' | 'people'>;
const DRAFT_KEYS = ['name', 'cycle', 'starts', 'active', 'days', 'locations', 'jobProfiles', 'costCentre', 'gen', 'genFrom', 'genTo', 'horizon', 'people'] as const;
const draftOf = (p: PatternRecord): Draft => Object.fromEntries(DRAFT_KEYS.map(k => [k, structuredClone(p[k])])) as Draft;
const changes = (p: PatternRecord, d: Draft): UpdatePattern =>
  Object.fromEntries(DRAFT_KEYS.filter(k => JSON.stringify(p[k]) !== JSON.stringify(d[k])).map(k => [k, d[k]]));

/* patternWindow with patternDetail (v15:9073-9082, 8865-8958). */
export function PatternEditor({ pattern, ctx, onClose, onAddPeople, onDelete }: {
  pattern: PatternRecord; ctx: PatternCtx; onClose: () => void; onAddPeople: () => void; onDelete: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftOf(pattern));
  const [cycleText, setCycleText] = useState(String(pattern.cycle));
  const save = useUpdatePattern(), gen = useGenerateRun();
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }));
  const body = changes(pattern, d), dirty = Object.keys(body).length > 0;
  const locName = nameIn(ctx.locations), jobName = nameIn(ctx.jobs);
  const sh = ctx.shifts;
  const hrs = d.days.reduce((a, c) => a + (shiftBy(sh, c)?.hours ?? 0), 0);
  const working = d.days.filter(c => !!c).length;
  const perWeek = d.cycle ? Math.round((hrs / d.cycle) * 7 * 10) / 10 : 0;
  const unknown = d.days.filter(c => c && !shiftBy(sh, c)).length;
  const run = genRange({ ...pattern, ...d }, ctx.today);
  const fe = save.fieldError;
  const commitCycle = () => {
    const n = clampCycle(Number(cycleText), d.cycle);
    setCycleText(String(n));
    if (n !== d.cycle) set(resizeCycle(d, n));
  };
  const tap = (i: number) => {
    const seq = ['', ...sh.map(s => s.code)], at = seq.indexOf(d.days[i] ?? '');
    set({ days: d.days.map((c, k) => (k === i ? seq[(at < 0 ? 0 : at + 1) % seq.length] ?? '' : c)) });
  };
  const setGen = (g: string) => {
    const per = genBy(g);
    const range = per.custom && !d.genFrom ? { genFrom: d.starts || ctx.today, genTo: addDays(d.starts || ctx.today, 27) } : {};
    set({ gen: g, ...(per.months ? { horizon: per.months } : {}), ...range });
  };
  const submit = () => save.mutate({ pattern, body }, { onSuccess: r =>
    toastInfo(`${r.record.name} saved`, r.record.active ? 'The rota generates from it.' : 'It is a draft and generates nothing until it is active.') });
  const later = dirty ? 'Save your changes first' : undefined;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`${pattern.name} · ${pattern.code}`} width="wide"
      footer={<>
        {dirty && <span data-testid={tid.tpat.dirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        {dirty
          ? <Button testId={tid.tpat.cancel} kind="ghost" disabled={save.anyPending} onClick={() => { setD(draftOf(pattern)); setCycleText(String(pattern.cycle)); }}>Cancel</Button>
          : <Button testId={tid.tpat.close} kind="ghost" onClick={onClose}>Close</Button>}
        <Button testId={tid.tpat.save} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </>}>
      <div data-testid={tid.tpat.editor}>
        <div className="mb-[14px] flex flex-wrap items-center gap-sm">
          <Small testId={tid.tpat.summary} className="flex-1">
            Repeats every {pluralOf(d.cycle, 'day')} · {pluralOf(working, 'working day')} · {hrs}h per cycle · about {perWeek}h a week · generated {genLabel({ ...pattern, ...d }).toLowerCase()} at a time</Small>
          {activePill(pattern)}
        </div>
        <SettingRow title="Pattern name" desc="What admins and managers see in the list">
          <SettingText testId={tid.tpat.name} aria-label="Pattern name" value={d.name} aria-invalid={fe('name') ? true : undefined} onChange={e => set({ name: e.target.value })} /></SettingRow>
        <SettingRow title="Cycle length" desc="How many days before the pattern repeats. Lengthening it adds rest days at the end.">
          <UnitInput testId={tid.tpat.cycle} unit="days" aria-label="Cycle length in days" type="number" inputMode="numeric" min="1" max="28" step="1" className="[&_input]:w-[52px]"
            value={cycleText} aria-invalid={fe('cycle') ? true : undefined} onChange={e => setCycleText(e.target.value)} onBlur={commitCycle}
            onKeyDown={e => { if (e.key === 'Enter') commitCycle(); }} /></SettingRow>
        <SettingRow title="First day of the cycle" desc="Day 1 falls on this date, then it repeats">
          <SettingText testId={tid.tpat.starts} aria-label="First day of the cycle" type="date" className="max-w-[160px]" value={d.starts}
            aria-invalid={fe('starts') ? true : undefined} onChange={e => set({ starts: e.target.value })} /></SettingRow>
        <SettingRow title="Active" desc="A draft pattern generates nothing until you turn it on">
          <SwitchField testId={tid.tpat.active} aria-label="Active" checked={d.active} onCheckedChange={v => set({ active: v })} /></SettingRow>

        <SubHead>The cycle <span className="font-normal text-text-muted">· tap a day to change what it is</span></SubHead>
        <div className="my-sm grid grid-cols-[repeat(auto-fit,minmax(74px,1fr))] gap-[6px]">
          {d.days.map((c, i) => {
            const s = shiftBy(sh, c);
            return (
              <button key={i} type="button" data-testid={tid.tpat.day(i)} onClick={() => tap(i)}
                aria-label={`Day ${i + 1}, ${c ? shiftName(sh, c) || c : 'rest day'}. Tap to change.`}
                className={cn('cursor-pointer rounded-sm border border-transparent bg-surface-tint px-[6px] py-[9px] text-center text-xs leading-[1.4] text-text-muted transition-shadow duration-(--qp-duration-fast) hover:shadow-[inset_0_0_0_2px_var(--qp-color-brand-primary)]',
                  s && CYC_TONE[s.tone])}>
                Day {i + 1}<br /><strong className="text-xs">{c ? (s ? `${s.from.slice(0, 2)}–${s.to.slice(0, 2)}` : c) : 'off'}</strong>
              </button>);
          })}
        </div>
        <Small testId={tid.tpat.legend}>{sh.map(s => `${s.code} = ${s.name} ${s.from}–${s.to}`).join(' · ')} · blank = rest day.
          {d.days.some(c => shiftBy(sh, c)?.cross) ? ' This cycle includes a shift that crosses midnight.' : ''}</Small>
        {unknown > 0 && <div className="mt-sm"><Banner testId={tid.tpat.unknown} tone="warn"
          title={`${unknown} day${unknown > 1 ? 's reference' : ' references'} a shift that is no longer in the catalogue`}>
          Tap those days to pick a shift that exists, or add the shift back under the shift catalogue.</Banner></div>}

        <div className="mt-[18px]">
          <FieldGrid>
            <Field label="Locations it runs at" hint="Locations and their support level come from the HRIS through shared workforce data." error={fe('locations')}>
              <NativeSelect testId={tid.tpat.addLocation} value="" onChange={e => { if (e.target.value) set({ locations: [...d.locations, e.target.value] }); }}>
                <option value="">{d.locations.length ? 'Add another location…' : 'Choose a location…'}</option>
                {ctx.locations.filter(l => !d.locations.includes(l.code)).map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </NativeSelect></Field>
            <Field label="Job profiles" hint="Only people on these job profiles can be put on the pattern." error={fe('jobProfiles')}>
              <NativeSelect testId={tid.tpat.addJob} value="" onChange={e => { if (e.target.value) set({ jobProfiles: [...d.jobProfiles, e.target.value] }); }}>
                <option value="">{d.jobProfiles.length ? 'Add another job profile…' : 'Choose a job profile…'}</option>
                {ctx.jobs.filter(j => !d.jobProfiles.includes(j.code)).map(j => <option key={j.code} value={j.code}>{j.name}</option>)}
              </NativeSelect></Field>
          </FieldGrid>
          <FieldGrid>
            <div className="-mt-sm mb-md flex flex-wrap gap-[6px]">{d.locations.map(c => (
              <PickChip key={c} testId={tid.tpat.dropLocation(c)} label={`Remove ${locName(c)}`} onRemove={() => set({ locations: d.locations.filter(x => x !== c) })}>{locName(c)}</PickChip>))}</div>
            <div className="-mt-sm mb-md flex flex-wrap gap-[6px]">{d.jobProfiles.map(c => (
              <PickChip key={c} testId={tid.tpat.dropJob(c)} label={`Remove ${jobName(c)}`} onRemove={() => set({ jobProfiles: d.jobProfiles.filter(x => x !== c) })}>{jobName(c)}</PickChip>))}</div>
          </FieldGrid>
          <FieldGrid>
            <Field label="Cost centre" hint="Carried onto every rota entry the pattern generates." error={fe('costCentre')}>
              <NativeSelect testId={tid.tpat.costCentre} value={d.costCentre} onChange={e => set({ costCentre: e.target.value })}>
                {(ctx.costCentres.some(c => c.code === d.costCentre) ? ctx.costCentres : [{ code: d.costCentre, name: d.costCentre }, ...ctx.costCentres])
                  .map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
              </NativeSelect></Field>
            <Field label="Generate for" hint="Weekly and fortnightly runs suit services that rota close to the day; the longer spans publish months ahead." error={fe('gen')}>
              <NativeSelect testId={tid.tpat.gen} value={d.gen || '12m'} onChange={e => setGen(e.target.value)}>
                {GEN_PERIODS.map(g => <option key={g.k} value={g.k}>{g.label}</option>)}
              </NativeSelect></Field>
            {d.gen === 'range' && <>
              <Field label="From"><TextInput testId={tid.tpat.genFrom} type="date" value={d.genFrom} onChange={e => set({ genFrom: e.target.value })} /></Field>
              <Field label="To"><TextInput testId={tid.tpat.genTo} type="date" value={d.genTo} onChange={e => set({ genTo: e.target.value })} /></Field>
            </>}
          </FieldGrid>
        </div>
        {run.ok
          ? <Banner testId={tid.tpat.range} tone="info" title={`This run covers ${run.range}`}>
              {pluralOf(run.span, 'day')} · {pluralOf(run.shifts, 'shift')} for {pluralOf(d.people.length, 'person', 'people')}{d.people.length ? '.' : '. Add somebody first.'}</Banner>
          : <Banner testId={tid.tpat.range} tone="warn" title={run.message} />}

        <div className="mt-[14px] mb-sm flex items-center text-xs font-bold tracking-[.08em] text-text-muted">People on this pattern
          <Tip testId={tid.tpat.peopleTip} text="Each person starts on a different day of the cycle, which is how one pattern covers every shift every day." /></div>
        <Table dense data-testid={tid.tpat.people}>
          <TableHeader><TableRow>
            <TableHead>Person</TableHead><TableHead>Job profile</TableHead><TableHead>Location</TableHead>
            <TableHead className="text-right">Starts on day</TableHead><TableHead>First shift they get</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {d.people.length ? d.people.map((x, i) => {
              const pe = ctx.people.find(c => c.code === x.personCode);
              const first = d.days[(((x.offset - 1) % d.cycle) + d.cycle) % d.cycle] ?? '';
              return (
                <Row key={x.personCode} testId={tid.tpat.person(x.personCode)}>
                  <TableCell><div className="flex items-center gap-[10px]"><Avatar name={pe?.name ?? x.personCode} />
                    <div><strong>{pe?.name ?? x.personCode}</strong><div className="font-mono text-xs text-text-muted">{x.personCode}</div></div></div></TableCell>
                  <TableCell className="text-xs text-text-muted">{pe ? jobName(pe.jobProfile) : '—'}</TableCell>
                  <TableCell className="text-xs text-text-muted">{pe ? locName(pe.location) : '—'}</TableCell>
                  <TableCell className="text-right"><UnitInput testId={tid.tpat.offset(x.personCode)} unit={`of ${d.cycle}`} aria-label={`${pe?.name ?? x.personCode} starts on day`}
                    type="number" inputMode="numeric" min="1" max={d.cycle} className="ml-auto [&_input]:w-[46px]" value={x.offset}
                    aria-invalid={fe(`people.${i}.offset`) ? true : undefined}
                    onChange={e => set({ people: d.people.map((y, k) => (k === i ? { ...y, offset: Math.max(1, Math.min(d.cycle, Math.trunc(Number(e.target.value)) || 1)) } : y)) })} /></TableCell>
                  <TableCell className="text-xs text-text-muted" data-testid={tid.tpat.first(x.personCode)}>{first ? `${shiftName(sh, first) || first} · ${shiftTime(sh, first)}` : 'Rest day'}</TableCell>
                  <TableCell className="text-right"><Button testId={tid.tpat.removePerson(x.personCode)} kind="ghost" small
                    onClick={() => set({ people: d.people.filter((_, k) => k !== i) })}>Remove</Button></TableCell>
                </Row>);
            }) : <TableRow><TableCell colSpan={6}><div data-testid={tid.tpat.noPeople} className="px-lg py-xl text-center text-sm text-text-muted">Nobody is on this pattern yet</div></TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="mt-lg flex flex-wrap justify-end gap-sm">
          <Button testId={tid.tpat.run} kind="secondary" disabled={dirty} title={later} pending={gen.pending(pattern.code)} onClick={() => gen.run(pattern)}>Generate the rota from this pattern</Button>
          <Button testId={tid.tpat.editorAdd} kind="ghost" disabled={dirty} title={later} onClick={onAddPeople}>Add a person</Button>
          <Button testId={tid.tpat.remove} kind="danger" disabled={dirty} title={later} onClick={onDelete}>Delete this pattern</Button>
        </div>
      </div>
    </Modal>);
}

/* patternBox and np-create (v15:10329-10365, 12320-12347): a new pattern starts as a draft. */
export function NewPatternDialog({ patterns, ctx, onClose, onCreated }: {
  patterns: readonly PatternRecord[]; ctx: PatternCtx; onClose: () => void; onCreated: (code: string) => void;
}) {
  const single = ctx.canCover.length === 1;
  const [f, setF] = useState({
    name: '', cycle: '8', starts: addDays(periodStart(ctx.today), 7), base: '', locs: single ? ctx.canCover.map(l => l.code) : [] as string[],
    jobs: [] as string[], cc: ctx.costCentres[0]?.code ?? '', gen: '4w',
  });
  const [named, setNamed] = useState(true);
  const create = useCreatePattern();
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));
  const go = () => {
    const name = f.name.trim();
    if (!name) { setNamed(false); return; }
    const base = patterns.find(p => p.code === f.base);
    create.mutate({
      name, cycle: clampCycle(Number(f.cycle)), starts: f.starts, ...(base ? { base: base.code } : {}),
      locations: f.locs.length ? f.locs : base ? [...base.locations] : [], jobProfiles: f.jobs.length ? f.jobs : base ? [...base.jobProfiles] : [],
      costCentre: f.cc || base?.costCentre || '', gen: f.gen, horizon: genBy(f.gen).months ?? 1,
    }, { onSuccess: r => {
      onCreated(r.record.code);
      toastInfo(`${name} created as a draft`, `${base ? `Copied from ${base.name}. ` : ''}Set its cycle and add people, then generate the rota.`);
    } });
  };
  const multi = (e: { target: HTMLSelectElement }) => Array.from(e.target.selectedOptions).map(o => o.value);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="New working pattern"
      footer={<>
        <Button testId={tid.tpat.newCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.tpat.newCreate} kind="primary" pending={create.anyPending} onClick={go}>Create pattern</Button>
      </>}>
      <Small className="mb-md">Created as a draft. Set its cycle and add people in the pattern window, then generate the rota from it.</Small>
      <Field label="Pattern name" required error={named ? create.fieldError('name') : 'A name is required.'}>
        <TextInput testId={tid.tpat.newName} placeholder="e.g. 3-on / 3-off twilights" value={f.name} onChange={e => { set({ name: e.target.value }); setNamed(true); }} /></Field>
      <FieldGrid>
        <Field label="Cycle length" hint="Days before it repeats, from 1 to 28. Set the shifts afterwards." error={create.fieldError('cycle')}>
          <TextInput testId={tid.tpat.newCycle} type="number" min="1" max="28" step="1" value={f.cycle} onChange={e => set({ cycle: e.target.value })} /></Field>
        <Field label="First day of the cycle" hint="Patterns run in whole cycles from this day." error={create.fieldError('starts')}>
          <TextInput testId={tid.tpat.newStart} type="date" value={f.starts} onChange={e => set({ starts: e.target.value })} /></Field>
      </FieldGrid>
      <Field label="Start from" hint="Copying brings the cycle, locations, job profiles and cost centre, not the people.">
        <NativeSelect testId={tid.tpat.newBase} value={f.base} onChange={e => set({ base: e.target.value })}>
          <option value="">Blank: every day a rest day</option>
          {patterns.map(p => <option key={p.code} value={p.code}>Copy {p.name} · {p.cycle}-day cycle</option>)}
        </NativeSelect></Field>
      <FieldGrid>
        <Field label="Locations it runs at" hint="Choose one or more. Hold Ctrl, or Cmd on a Mac." error={create.fieldError('locations')}
          tip={single ? 'A manager can only build patterns for the location they manage. An admin can span several.' : undefined}>
          <NativeSelect testId={tid.tpat.newLocs} multiple size={4} className="h-auto" value={f.locs} onChange={e => set({ locs: multi(e) })}>
            {ctx.canCover.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </NativeSelect></Field>
        <Field label="Job profiles" hint="Choose one or more." error={create.fieldError('jobProfiles')}>
          <NativeSelect testId={tid.tpat.newJobs} multiple size={4} className="h-auto" value={f.jobs} onChange={e => set({ jobs: multi(e) })}>
            {ctx.jobs.map(j => <option key={j.code} value={j.code}>{j.name}</option>)}
          </NativeSelect></Field>
        <Field label="Cost centre" error={create.fieldError('costCentre')}>
          <NativeSelect testId={tid.tpat.newCc} value={f.cc} onChange={e => set({ cc: e.target.value })}>
            {ctx.costCentres.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </NativeSelect></Field>
        <Field label="Generate for">
          <NativeSelect testId={tid.tpat.newGen} value={f.gen} onChange={e => set({ gen: e.target.value })}>
            {GEN_PERIODS.filter(g => !g.custom).map(g => <option key={g.k} value={g.k}>{g.label}</option>)}
          </NativeSelect></Field>
      </FieldGrid>
    </Modal>);
}

/* patternPersonBox and pp-add (v15:10366-10411, 12348-12375): several people
   at once, staggered across the days that carry a shift, or all on one day. */
export function PatternPeopleDialog({ pattern, ctx, onClose }: { pattern: PatternRecord; ctx: PatternCtx; onClose: () => void }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [mode, setMode] = useState<'stagger' | 'same'>('stagger');
  const [start, setStart] = useState('1');
  const [warn, setWarn] = useState(false);
  const add = useAddPatternPeople();
  const already = new Set(pattern.people.map(x => x.personCode));
  const pool = ctx.people.filter(x => !already.has(x.code));
  const fits = (x: Candidate) => (!pattern.locations.length || pattern.locations.includes(x.location)) && (!pattern.jobProfiles.length || pattern.jobProfiles.includes(x.jobProfile));
  const eligible = pool.filter(fits), others = pool.filter(x => !fits(x));
  const shiftDays = pattern.days.flatMap((c, i) => (c ? [i + 1] : []));
  const locName = nameIn(ctx.locations), jobName = nameIn(ctx.jobs);
  const toggle = (code: string, on: boolean) => { setTicked(t => (on ? [...t, code] : t.filter(c => c !== code))); setWarn(false); };
  const go = () => {
    if (!ticked.length) { setWarn(true); return; }
    const s = Number(start), n = ticked.length;
    add.mutate({ pattern, body: { personCodes: ticked, start: s, mode } }, { onSuccess: () => {
      onClose();
      const ring = shiftDays.length || pattern.cycle;
      toastInfo(`${n} added to ${pattern.name} · ${mode === 'same' ? `all from day ${s}` : `staggered across ${ring} day(s)`}`,
        `Starting days: ${staggerOffsets(pattern.days, s, mode, n).join(', ')}.`);
    } });
  };
  const person = (x: Candidate) => (
    <label key={x.code} className="flex cursor-pointer items-start gap-[9px] rounded-sm px-sm py-[7px] hover:bg-surface-tint">
      <CheckboxField testId={tid.tpat.pick(x.code)} className="mt-[2px]" checked={ticked.includes(x.code)} onCheckedChange={v => toggle(x.code, v === true)} />
      <span><strong>{x.name}</strong><span className="block text-xs text-text-muted">{jobName(x.jobProfile)} · {locName(x.location)} · {x.category}</span></span>
    </label>);
  const group = (label: string) => <div className="px-sm pt-sm pb-xs text-xs font-semibold tracking-[.04em] text-text-muted uppercase">{label}</div>;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Add people to ${pattern.name}`} width="wide"
      footer={<>
        <Button testId={tid.tpat.pickCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.tpat.pickAdd} kind="primary" pending={add.anyPending} onClick={go}>Add to the pattern</Button>
      </>}>
      <FieldGrid>
        <div>
          <div className="mb-[6px] flex items-center text-xs font-semibold">Who to add<Tip testId={tid.tpat.pickWhoTip} text="Tick as many as you like. Everyone ticked is added in one go." /></div>
          <div className="max-h-[280px] overflow-auto rounded-sm border p-xs">
            {eligible.length > 0 && <>{group('Matches this pattern’s locations and job profiles')}{eligible.map(person)}</>}
            {others.length > 0 && <>{group('Everyone else')}{others.map(person)}</>}
            {!pool.length && <div data-testid={tid.tpat.pickNone} className="px-lg py-xl text-center text-sm text-text-muted">Nobody left to add</div>}
          </div>
          {!eligible.length && pool.length > 0 && <Small className="mt-xs">Nobody matches this pattern’s locations and job profiles yet. The list is everyone else.</Small>}
        </div>
        <div>
          <Field label="Where they start" tip="Stagger spreads the selection evenly across the days that carry a shift, so every day of the cycle is covered.">
            <SelectBox testId={tid.tpat.pickMode} value={mode} onValueChange={v => setMode(v === 'same' ? 'same' : 'stagger')}
              options={[{ value: 'stagger', label: 'Stagger them across the cycle' }, { value: 'same', label: 'All on the same day' }]} /></Field>
          <Field label="Starting from day" hint={shiftDays.length
            ? `${shiftDays.length} of the ${pattern.cycle} days carry a shift. Staggering cycles through those days in turn.`
            : 'No day in this cycle carries a shift yet. Set the cycle first.'}>
            <SelectBox testId={tid.tpat.pickStart} value={start} onValueChange={setStart}
              options={pattern.days.map((c, i) => ({ value: String(i + 1), label: `Day ${i + 1} · ${c ? shiftName(ctx.shifts, c) || c : 'rest day'}` }))} /></Field>
          {warn && <FormWarn testId={tid.tpat.pickWarn}>{TICK_SOMEONE}</FormWarn>}
        </div>
      </FieldGrid>
    </Modal>);
}

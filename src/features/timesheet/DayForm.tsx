import { useState } from 'react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { AddLine, CheckboxField, CheckRow, Empty, Field, FieldGrid, FormExpander, FormGroupLabel, SelectBox, TextArea, TextInput, Tip } from '@/ui';
import type { CaptureSetup } from '@/contract/timesheets';
import { useTenant } from '@/api/tenant';
import { MAX_BREAKS, MAX_VEHICLES, breakIndex, fieldOptions, formGroups, hm, isAllowance, varianceText, type DayStats as Stats, type FormField, type FormValues } from './capture';

/* The day form: the prototype's buildForm and fieldControl
   (qnipay-workforce-v15.html:6097-6125, 6177-6205). One renderer for every
   entry surface: My timesheet's day view (open groups in the entry card, the
   closed ones in the side column's "Shift details") and proxy entry (all of
   it in one column). A field renders as the thing it holds: a time gets a
   time control, an amount a numeric keypad. */
export interface DayFieldsProps {
  capture: CaptureSetup; values: FormValues; errorFor: (code: string) => string | undefined;
  onChange: (code: string, value: string | boolean) => void; onBlur: (code: string) => void;
  breaks: number; onAddBreak: () => void;
  which: 'open' | 'closed' | 'all'; single?: boolean; disabled?: boolean;
  /* fields the clock owns while a shift runs (lockShiftTimes, v15:6920-6926): shown, read-only */
  readOnly?: readonly string[];
}

const INPUT: Record<string, { type: string; step?: string; min?: string; max?: string; inputMode?: 'decimal' }> = {
  time: { type: 'time', step: '300' },
  duration: { type: 'number', step: '0.25', min: '0', max: '24', inputMode: 'decimal' },
  date: { type: 'date' },
  number: { type: 'number', step: '0.01', min: '0', inputMode: 'decimal' },
};

function Control({ f, p }: { f: FormField; p: DayFieldsProps }) {
  const { def, setting, hint } = f, code = def.c, id = tid.dayForm.field(code);
  const v = p.values[code], text = typeof v === 'string' ? v : '';
  if (def.input === 'check') {
    const tip = isAllowance(def)
      ? <Tip testId={tid.dayForm.tip(code)} text={`You are declaring this yourself. It posts pay code ${def.pay ?? ''} once for this shift.`} />
      : hint ? <Tip testId={tid.dayForm.tip(code)} text={hint} /> : undefined;
    return <CheckRow tip={tip} control={<CheckboxField testId={id} checked={v === true} disabled={p.disabled}
      onCheckedChange={c => p.onChange(code, c === true)} />}>{setting.label}</CheckRow>;
  }
  const wide = def.input === 'textarea';
  let control;
  if (def.input === 'calc') control = <TextInput testId={id} value={def.val ?? ''} readOnly />;
  else if (def.input === 'select')
    control = <SelectBox testId={id} options={fieldOptions(def, p.capture, p.values)} value={text || undefined} placeholder="Choose" disabled={p.disabled}
      onValueChange={x => p.onChange(code, x)} />;
  else if (def.input === 'textarea')
    control = <TextArea testId={id} rows={2} value={text} disabled={p.disabled} onChange={e => p.onChange(code, e.target.value)} onBlur={() => p.onBlur(code)} />;
  else {
    const a = (def.t && INPUT[def.t]) || { type: 'text' };
    const ro = p.readOnly?.includes(code) === true;
    control = <TextInput testId={id} {...a} value={text} disabled={p.disabled} readOnly={ro}
      className={ro ? 'cursor-default bg-surface-tint text-text-secondary' : undefined}
      onChange={e => p.onChange(code, e.target.value)} onBlur={() => p.onBlur(code)} />;
  }
  return (
    <div className={cn('mb-md', wide && 'col-span-full')}>
      <Field label={def.input === 'calc' && def.src ? `${setting.label} (${def.src})` : setting.label} required={setting.mand} tip={hint} error={p.errorFor(code)}>
        {control}
      </Field>
    </div>);
}

/* Break rows are opt-in (applyOptIn): one pair shows, "Add break" reveals the next.
   How many breaks and vehicles an entry may hold is the tenant's, set beside
   Break tracking and Vehicle & movement fields in Modules & features (D6). */
function GroupBody({ fields, p }: { fields: FormField[]; p: DayFieldsProps }) {
  const extras = useTenant().data?.extras;
  const maxBreaks = extras?.breaksMax ?? MAX_BREAKS, maxVehicles = extras?.vehiclesMax ?? MAX_VEHICLES;
  const shown = fields.filter(f => f.def.repeat !== 'vehicle' || (f.def.seq ?? 1) <= maxVehicles);
  const avail = Math.min(maxBreaks, MAX_BREAKS, new Set(shown.map(f => breakIndex(f.def.c)).filter(i => i >= 0)).size);
  return (
    <FieldGrid single={p.single}>
      {shown.filter(f => breakIndex(f.def.c) < Math.min(p.breaks, maxBreaks)).map(f => <Control key={f.def.c} f={f} p={p} />)}
      {avail > 0 && p.breaks < avail && <AddLine testId={tid.dayForm.addBreak} label="Add break" onClick={p.onAddBreak}
        note={`${p.breaks} of ${avail} breaks shown`} />}
    </FieldGrid>);
}

/* The groups this surface shows. Closed groups open on their own when they already hold something. */
export function DayFields(p: DayFieldsProps) {
  const groups = formGroups(p.capture);
  const [opened] = useState(() => new Set(groups.filter(g => g.fields.some(f => {
    const v = p.values[f.def.c];
    return v === true || (typeof v === 'string' && v.trim() !== '');
  })).map(g => g.group.key)));
  if (!groups.length) return p.which === 'closed' ? null
    : <Empty testId={tid.dayForm.empty}>No fields are enabled for this employee type yet. Turn a capability on under Employee types.</Empty>;
  const shown = groups.filter(g => p.which === 'all' || (p.which === 'open') === g.group.open);
  return <>{shown.map(({ group, fields }) => group.open
    ? <div key={group.key}><FormGroupLabel>{group.name}</FormGroupLabel><GroupBody fields={fields} p={p} /></div>
    : <FormExpander key={group.key} testId={tid.dayForm.group(group.key)} title={group.name} note={group.tip} defaultOpen={opened.has(group.key)}>
        <GroupBody fields={fields} p={p} />
      </FormExpander>)}</>;
}
export const hasClosedGroups = (c: CaptureSetup) => formGroups(c).some(g => !g.group.open);

/* .sstats and .cst (v15:1273-1282): the day's figures, read with the hours.
   Muted while there are no times yet; the rate its rules resolve carries why.
   With a rota shift on the day, "Against the rota" spans the card under them
   (renderDaySummary, v15:6740-6757): the hours scheduled and, once there are
   times, the variance. */
export function DayStatsCard({ capture, stats, scheduled }: { capture: CaptureSetup; stats: Stats; scheduled?: number }) {
  const has = stats.net != null;
  const cells: { key: string; label: string; value: string; accent?: boolean; why?: string }[] = [
    { key: 'net', label: 'Net working', value: hm(capture, stats.net ?? 0), accent: true },
    { key: 'breaks', label: 'Breaks', value: hm(capture, stats.breaks) + (stats.nBreaks > 1 ? ` · ${stats.nBreaks}` : '') },
    { key: 'extra', label: stats.extra.label, value: stats.extra.value },
    ...(stats.rate ? [{ key: 'rate', label: 'Rate type', value: stats.rate.label, accent: true, why: stats.rate.why }] : []),
  ];
  return (
    <div className="mb-md grid grid-cols-3 gap-sm rounded-card border bg-surface-card p-lg max-md:grid-cols-1 max-md:gap-md">
      {cells.map(c => (
        <div key={c.key}>
          <div data-caps className="flex items-center text-xs font-bold tracking-[.05em] text-text-muted uppercase">
            {c.label}{c.why && <Tip testId={tid.dayForm.rateTip} text={c.why} />}</div>
          <div data-testid={tid.dayForm.stat(c.key)}
            className={cn('mt-[2px] text-lg font-semibold tabular-nums', !has ? 'text-text-muted' : c.accent && 'text-brand dark:text-brand-accent')}>{c.value}</div>
        </div>))}
      {scheduled ? <div className="col-span-full border-t pt-[10px]">
        <div data-caps className="text-xs font-bold tracking-[.05em] text-text-muted uppercase">Against the rota</div>
        <div data-testid={tid.dayForm.stat('rota')} className="mt-[2px] text-sm font-semibold tabular-nums">
          {scheduled}h scheduled{stats.net != null ? ` · ${varianceText(stats.net, scheduled)}h variance` : ''}</div>
      </div> : null}
    </div>);
}

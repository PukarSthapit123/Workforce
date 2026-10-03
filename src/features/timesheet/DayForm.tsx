import { useState, type TextareaHTMLAttributes } from 'react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { fieldControl } from '@/ui/shadcn/input';
import { AddLine, CheckboxField, CheckRow, Empty, Field, FieldGrid, FormExpander, FormGroupLabel, SelectBox, TextInput, Tip } from '@/ui';
import type { CaptureSetup } from '@/contract/timesheets';
import { MAX_BREAKS, breakIndex, fieldOptions, formGroups, hm, isAllowance, type DayStats as Stats, type FormField, type FormValues } from './capture';

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
}

function TextArea({ testId, className, ...rest }: { testId: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-testid={testId} rows={2} {...rest} className={cn(fieldControl, 'h-auto resize-y py-[9px] leading-[1.5]', className)} />;
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
    control = <TextArea testId={id} value={text} disabled={p.disabled} onChange={e => p.onChange(code, e.target.value)} onBlur={() => p.onBlur(code)} />;
  else {
    const a = (def.t && INPUT[def.t]) || { type: 'text' };
    control = <TextInput testId={id} {...a} value={text} disabled={p.disabled}
      onChange={e => p.onChange(code, e.target.value)} onBlur={() => p.onBlur(code)} />;
  }
  return (
    <div className={cn('mb-md', wide && 'col-span-full')}>
      <Field label={def.input === 'calc' && def.src ? `${setting.label} (${def.src})` : setting.label} required={setting.mand} tip={hint} error={p.errorFor(code)}>
        {control}
      </Field>
    </div>);
}

/* Break rows are opt-in (applyOptIn): one pair shows, "Add break" reveals the next. */
function GroupBody({ fields, p }: { fields: FormField[]; p: DayFieldsProps }) {
  const avail = Math.min(MAX_BREAKS, new Set(fields.map(f => breakIndex(f.def.c)).filter(i => i >= 0)).size);
  return (
    <FieldGrid single={p.single}>
      {fields.filter(f => breakIndex(f.def.c) < p.breaks).map(f => <Control key={f.def.c} f={f} p={p} />)}
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
   Muted while there are no times yet; the rate its rules resolve carries why. */
export function DayStatsCard({ capture, stats }: { capture: CaptureSetup; stats: Stats }) {
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
    </div>);
}

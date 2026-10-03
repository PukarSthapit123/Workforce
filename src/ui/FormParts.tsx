import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { fieldControl } from '@/ui/shadcn/input';

/* The prototype's form layout pieces (qnipay-workforce-v15.html). */

/* .wtsub (v15:1503-1506) over a .fgrid (1260-1262): a form section's name in
   12px/650 secondary ink with a rule under it, then two columns of fields,
   one on a phone. A field spanning both columns takes `wide`. */
export function FormSection({ title, children, single }: { title: string; children: ReactNode; single?: boolean }) {
  return (
    <section className="mt-lg first:mt-0">
      <h3 className="mb-sm border-b pb-xs text-xs font-[650] tracking-normal text-text-secondary">{title}</h3>
      <div className={cn('grid gap-md', single ? 'grid-cols-1' : 'grid-cols-2 max-md:grid-cols-1')}>{children}</div>
    </section>);
}
export function Wide({ children }: { children: ReactNode }) { return <div className="col-span-full">{children}</div>; }

/* .formwarn (v15:1295-1297): why the form was not saved, in the error
   colour on its surface, under the fields. */
export function FormWarn({ testId, children }: { testId: string; children: ReactNode }) {
  return <p data-testid={testId} role="alert" className="mt-[10px] rounded-sm bg-err-surface px-md py-[9px] text-xs text-err">{children}</p>;
}

/* .unit (v15:514-519): a short number with its unit beside it, such as
   "h / week". Field clones its child with the id and aria props, so they
   are forwarded to the input itself. */
export function UnitInput({ testId, unit, className, ...rest }: { testId: string; unit: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cn('inline-flex w-fit items-center overflow-hidden rounded-sm border border-border-strong bg-surface-sunken focus-within:border-brand focus-within:shadow-focus has-[[aria-invalid=true]]:border-err', className)}>
      <input data-testid={testId} {...rest}
        className="h-[30px] w-16 border-0 bg-transparent px-sm text-right text-sm tabular-nums outline-none focus:shadow-none disabled:text-text-secondary max-md:min-h-touch max-md:text-base" />
      <span aria-hidden="true" className="grid h-[30px] place-items-center border-l px-sm text-xs text-text-muted max-md:min-h-touch">{unit}</span>
    </span>);
}

/* .att with a .cbx radio (v15:1210-1212, 535): one choice among a few, its
   name and what it means, the whole row clickable. */
export function ChoiceRow({ testId, name, value, checked, onChange, title, note }: {
  testId: string; name: string; value: string; checked: boolean; onChange(): void; title: string; note?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-md border-b px-md py-[10px] text-sm last:border-b-0 has-[:checked]:bg-brand-subtle">
      <input type="radio" data-testid={testId} name={name} value={value} checked={checked} onChange={onChange}
        className="size-4 shrink-0 cursor-pointer accent-brand dark:accent-brand-accent" />
      <span><strong className="font-semibold">{title}</strong>{note && <span className="block text-xs text-text-muted">{note}</span>}</span>
    </label>);
}
export function ChoiceList({ label, children }: { label: string; children: ReactNode }) {
  return <fieldset className="mb-md"><legend className="sr-only">{label}</legend>{children}</fieldset>;
}

/* A native select, for the one case SelectBox cannot draw: option groups
   (plan 1b decision D20). Same look as every other field control. */
export function NativeSelect({ testId, className, children, ...rest }: { testId: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <select data-testid={testId} {...rest} className={cn(fieldControl, 'cursor-pointer pr-lg', className)}>{children}</select>;
}

/* The capture form's layout (qnipay-workforce-v15.html:1257-1272, 1299-1304),
   shared by the day form, the weekly grid and proxy entry. */

/* .fgrid: two columns of fields 12px apart both ways, one on a phone or in a
   narrow column (`single`). A field in it keeps .fld's own 12px under it. */
export function FieldGrid({ single, children }: { single?: boolean; children: ReactNode }) {
  return <div className={cn('grid gap-md', single ? 'grid-cols-1' : 'grid-cols-2 max-md:grid-cols-1')}>{children}</div>;
}
/* .fsec: an open group's name, 12px/700 in muted ink with wide tracking, set
   in sentence case. */
export function FormGroupLabel({ children }: { children: ReactNode }) {
  return <div className="mt-lg mb-sm text-xs font-bold tracking-[.08em] text-text-muted first:mt-0">{children}</div>;
}
/* .fexp: a group that stays closed until it applies, a + or – before its name
   and a muted note at the end of the summary line. */
export function FormExpander({ testId, title, note, defaultOpen, children }: {
  testId: string; title: string; note?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group mb-sm rounded-card border bg-surface-card px-lg py-md last:mb-0">
      <summary data-testid={testId} role="button"
        className="flex cursor-pointer list-none items-center gap-sm text-sm font-semibold before:w-[14px] before:font-bold before:text-text-muted before:content-['+'] group-open:before:content-['–'] [&::-webkit-details-marker]:hidden">
        {title}{note && <span className="ml-auto text-xs font-normal text-text-muted">{note}</span>}
      </summary>
      <div className="mt-md">{children}</div>
    </details>);
}
/* .addline: a dashed button that reveals one more of a repeating pair, with how many are shown beside it. */
export function AddLine({ testId, label, note, onClick }: { testId: string; label: string; note?: string; onClick: () => void }) {
  return (
    <div className="col-span-full mt-sm flex items-center gap-md">
      <button type="button" data-testid={testId} onClick={onClick}
        className="inline-flex items-center gap-[6px] rounded-sm border border-dashed border-border-strong px-md py-[6px] text-xs font-semibold text-brand hover:bg-brand-subtle max-md:min-h-touch dark:text-brand-accent">
        <span aria-hidden="true">+</span> {label}</button>
      {note && <span className="text-xs text-text-muted">{note}</span>}
    </div>);
}
/* .chk: a checkbox and its words on one clickable row. The control carries the test id. */
export function CheckRow({ children, control, tip, className }: { children: ReactNode; control: ReactNode; tip?: ReactNode; className?: string }) {
  return (
    <div className={cn('col-span-full flex items-center gap-[9px] py-[6px] text-sm', className)}>
      <label className="flex cursor-pointer items-center gap-[9px]">{control}<span>{children}</span></label>{tip}
    </div>);
}

/* .inl (v15:507-512): an input that reads as text until it is hovered or
   focused, for editing a value where it sits in a table row. */
export const INLINE_INPUT = 'h-[30px] w-full min-w-[168px] rounded-sm border border-transparent bg-transparent px-[7px] text-sm text-ellipsis outline-none hover:bg-surface-tint focus:border-border-strong focus:bg-surface-sunken focus:text-clip focus:shadow-focus aria-invalid:border-err max-md:min-h-touch max-md:text-base';
export function InlineInput({ testId, className, ...rest }: { testId: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <input data-testid={testId} {...rest} className={cn(INLINE_INPUT, className)} />;
}
/* .asel and .asel.sml (v15:1457-1459): the 32px setting select, 28px at 12px in a table. */
const SETTING_SELECT = 'h-8 max-w-[250px] cursor-pointer rounded-sm border border-border-strong bg-surface-sunken px-[9px] text-sm aria-invalid:border-err max-md:min-h-touch max-md:text-base';
export function SettingSelect({ testId, small, className, children, ...rest }: { testId: string; small?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <select data-testid={testId} {...rest} className={cn(SETTING_SELECT, small && 'h-7 text-xs', className)}>{children}</select>;
}
/* .ctext (v15:1460-1462): a 32px text box beside a setting, 270px at most. */
export function SettingText({ testId, className, ...rest }: { testId: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <input data-testid={testId} {...rest}
    className={cn('h-8 w-[270px] max-w-full flex-none rounded-sm border border-border-strong bg-surface-sunken px-[9px] text-sm outline-none focus:border-brand focus:shadow-focus aria-invalid:border-err max-md:min-h-touch max-md:text-base', className)} />;
}
/* .wtsub (v15:1503-1506): a sub-heading inside a card, 12px/650 secondary ink over a rule. */
export function SubHead({ children }: { children: ReactNode }) {
  return <div className="mt-lg mb-sm border-b pb-xs text-xs font-[650] tracking-normal text-text-secondary first:mt-0">{children}</div>;
}

import type { InputHTMLAttributes, ReactNode } from 'react';
import { Input, filterControl } from '@/ui/shadcn/input';
import { cn } from '@/lib/utils';
import { SelectBox, type SelectOption } from './Select';

/* The prototype's filter bar (qnipay-workforce-v15.html:536-549): a row of
   32px pill controls with 8px between them and 12px under the row. A filter
   has no visible label, so each one names itself; `label` is that name.
   Use this above a list, never full labelled Fields: those are for forms. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="group" aria-label="Filters" className={cn('mb-md flex flex-wrap items-center gap-sm max-md:gap-y-sm', className)}>{children}</div>;
}
/* .srch input: 32px pill, 0 14px, 14px, at least 190px wide */
export function SearchFilter({ testId, label, className, ...rest }: { testId: string; label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-label'>) {
  return <Input data-testid={testId} type="search" aria-label={label} {...rest}
    className={cn(filterControl, 'h-8 w-auto min-w-[190px] px-[14px] text-sm max-md:flex-1', className)} />;
}
/* .chipbtn (v15:540-544): a 32px pill that picks one filter out of a few,
   12px/500 in secondary ink; the one picked is filled brand, the accent in dark. */
export function ChipButton({ testId, on, onClick, children }: { testId: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" data-testid={testId} aria-pressed={on} onClick={onClick}
    className={cn(filterControl, 'px-md text-xs font-medium transition-colors max-md:min-h-[40px] max-md:text-xs',
      on ? 'border-brand bg-brand text-text-on-brand dark:border-brand-accent dark:bg-brand-accent dark:text-text-on-accent'
        : 'text-text-secondary hover:bg-surface-tint')}>{children}</button>;
}
/* select.flt: 32px pill, 0 10px, 12px */
export function SelectFilter({ testId, label, options, value, onValueChange }: {
  testId: string; label: string; options: SelectOption[]; value?: string; onValueChange?: (value: string) => void;
}) {
  return <SelectBox testId={testId} look="filter" aria-label={label} options={options} value={value} onValueChange={onValueChange} />;
}

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Popover } from 'radix-ui';
import { cn } from '@/lib/utils';
import { fieldControl, filterControl } from '@/ui/shadcn/input';
import type { SelectBoxProps } from './Select';

/* The most matches drawn at once; a long company list stays quick to render. */
export const COMBOBOX_LIMIT = 50;

export interface ComboboxProps extends SelectBoxProps {
  /* The search box has no visible label, so it names itself. */
  searchLabel?: string;
}

/* A SelectBox you can type into: the closed control is the same trigger, the
   panel adds a search box over the list. Props match SelectBox, so swapping
   one for the other is a rename. As with SelectBox, Field clones its child with
   an `id`, `aria-describedby`, `aria-invalid` and `aria-required`; all four, and
   the aria-label, go to the trigger button. */
export function Combobox({ testId, options, value, onValueChange, placeholder, disabled, name, id,
  'aria-describedby': ariaDescribedBy, 'aria-required': ariaRequired, 'aria-invalid': ariaInvalid, 'aria-label': ariaLabel,
  look = 'field', searchLabel = 'Search' }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const shown = matches.slice(0, COMBOBOX_LIMIT);
  const selected = options.find(o => o.value === value);
  const hasValue = value !== undefined && value !== '';

  function changeOpen(next: boolean) {
    setOpen(next);
    setQuery('');
    if (next) setActive(Math.max(0, options.slice(0, COMBOBOX_LIMIT).findIndex(o => o.value === value)));
  }
  function pick(v: string) {
    onValueChange?.(v);
    changeOpen(false);
  }
  function move(to: number) {
    setActive(to);
    document.getElementById(optionId(to))?.scrollIntoView({ block: 'nearest' });
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const n = shown.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); move((active + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); move((active - 1 + n) % n); }
    else if (e.key === 'Home' && n) { e.preventDefault(); move(0); }
    else if (e.key === 'End' && n) { e.preventDefault(); move(n - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = shown[active]; if (o) pick(o.value); }
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger ref={triggerRef} type="button" id={id} data-testid={testId} disabled={disabled}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={ariaLabel} aria-describedby={ariaDescribedBy} aria-required={ariaRequired} aria-invalid={ariaInvalid}
        data-size={look === 'filter' ? 'filter' : 'default'}
        data-placeholder={selected || hasValue ? undefined : ''}
        className={cn(
          look === 'filter'
            ? cn(filterControl, 'w-fit gap-xs px-[10px] text-xs max-md:text-base')
            : cn(fieldControl, 'gap-sm'),
          'flex items-center justify-between whitespace-nowrap disabled:cursor-not-allowed data-[placeholder]:text-text-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4 [&_svg:not([class*=\'text-\'])]:text-text-muted')}>
        <span className="line-clamp-1 flex items-center gap-2">{selected ? selected.label : hasValue ? value : placeholder}</span>
        <ChevronDownIcon className="size-4 opacity-50" />
      </Popover.Trigger>
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4}
          onOpenAutoFocus={e => { e.preventDefault(); inputRef.current?.focus(); }}
          className="z-[120] min-w-(--radix-popover-trigger-width) origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-control border bg-popover text-popover-foreground shadow-md outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="p-1 pb-0">
            <input ref={inputRef} type="text" data-testid={`${testId}-search`} aria-label={searchLabel}
              role="searchbox" aria-autocomplete="list" aria-controls={listId}
              aria-activedescendant={shown.length ? optionId(active) : undefined}
              autoComplete="off" value={query} onKeyDown={onKeyDown}
              onChange={e => { setQuery(e.target.value); setActive(0); }}
              className="h-[34px] w-full rounded-sm border border-border-strong bg-surface-sunken px-[11px] text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-brand focus:shadow-focus max-md:text-base" />
          </div>
          <div id={listId} role="listbox" aria-label={ariaLabel ?? searchLabel} className="max-h-[300px] overflow-y-auto p-1">
            {shown.map((o, i) => (
              <div key={o.value} id={optionId(i)} role="option" aria-selected={o.value === value}
                data-testid={`${testId}-option-${o.value}`} data-active={i === active ? '' : undefined}
                onMouseDown={e => e.preventDefault()} onMouseMove={() => { if (i !== active) setActive(i); }}
                onClick={() => pick(o.value)}
                className="relative flex w-full cursor-default items-center gap-2 rounded-sm py-[9px] pr-8 pl-[11px] text-sm select-none data-[active]:bg-surface-tint aria-selected:font-semibold">
                {o.label}
                {o.value === value && <span className="absolute right-2 flex size-3.5 items-center justify-center"><CheckIcon className="size-4 text-muted-foreground" /></span>}
              </div>
            ))}
            {shown.length === 0 && <p className="px-[11px] py-[9px] text-sm text-text-muted">No matches</p>}
            {matches.length > COMBOBOX_LIMIT && (
              <p className="px-[11px] py-[9px] text-xs text-text-muted">Showing {COMBOBOX_LIMIT} of {matches.length}. Type to narrow down.</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

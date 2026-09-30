import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select';

export interface SelectOption { value: string; label: string; }

export interface SelectBoxProps {
  testId: string;
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-required'?: boolean | 'true' | 'false';
  'aria-invalid'?: boolean | 'true' | 'false';
  /* A filter-bar select has no visible label, so it names itself. */
  'aria-label'?: string;
  /* field: a form field inside a Field. filter: a pill in a FilterBar. */
  look?: 'field' | 'filter';
}
/* Field.tsx clones its child with an `id`, `aria-describedby`, `aria-invalid`
   and `aria-required` (for the <label htmlFor> and its hint/error text),
   assuming a plain input; SelectBox must accept and forward all four to the
   real trigger button, or the label never associates with anything, the
   trigger is left with no accessible name, and its hint/error/required state
   never reaches assistive tech at all. */
export function SelectBox({ testId, options, value, onValueChange, placeholder, disabled, name, id,
  'aria-describedby': ariaDescribedBy, 'aria-required': ariaRequired, 'aria-invalid': ariaInvalid, 'aria-label': ariaLabel, look = 'field' }: SelectBoxProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled} name={name}>
      <SelectTrigger id={id} data-testid={testId} size={look === 'filter' ? 'filter' : 'default'} aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy} aria-required={ariaRequired} aria-invalid={ariaInvalid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value} data-testid={`${testId}-option-${o.value}`}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

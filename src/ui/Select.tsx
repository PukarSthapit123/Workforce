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
}
/* Field.tsx clones its child with an `id` (for the <label htmlFor>), assuming
   a plain input; SelectBox must accept and forward that id to the real
   trigger button, or the label never associates with anything and the
   trigger is left with no accessible name at all. */
export function SelectBox({ testId, options, value, onValueChange, placeholder, disabled, name, id }: SelectBoxProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled} name={name}>
      <SelectTrigger id={id} data-testid={testId}>
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

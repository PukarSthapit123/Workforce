import { cloneElement, useId, type InputHTMLAttributes, type ReactElement } from 'react';
import { Label } from '@/ui/shadcn/label';
import { Input } from '@/ui/shadcn/input';
import { tid } from '@/testids';
import { Tip } from './Affordances';

/* The wrapped control is one element carrying its own testId (TextInput,
   SelectBox, CheckboxField and so on). The Field's test id, and its tip's,
   are derived from that one, so they can never drift or be typed by hand. */
export function Field({ label, hint, error, required, tip, children }: {
  label: string; hint?: string; error?: string; required?: boolean; tip?: string;
  children: ReactElement<{ testId: string }>;
}) {
  const id = useId(), descId = `${id}-desc`;
  const controlTestId = children.props.testId;
  const control = cloneElement(children as ReactElement<Record<string, unknown>>, {
    id, 'aria-describedby': hint || error ? descId : undefined, 'aria-invalid': error ? 'true' : undefined,
    'aria-required': required ? 'true' : undefined });
  return (
    <div data-testid={tid.field.root(controlTestId)} className="flex flex-col gap-xs">
      {/* The tip sits beside the label, not inside it, so its text never
          becomes part of the control's accessible name. */}
      <div className="flex min-h-5 items-center gap-xs">
        <Label htmlFor={id} className="text-text-secondary">
          {label}{required && <span aria-hidden="true" className="text-err">*</span>}
        </Label>
        {tip && <Tip testId={tid.field.tip(controlTestId)} text={tip} />}
      </div>
      {control}
      {(error || hint) && <p id={descId} className={error ? 'text-err text-xs' : 'text-text-secondary text-xs'}>{error ?? hint}</p>}
    </div>);
}
export function TextInput({ testId, ...rest }: { testId: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <Input data-testid={testId} {...rest} />;
}

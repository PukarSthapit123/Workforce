import { cloneElement, useId, type InputHTMLAttributes, type ReactElement, type TextareaHTMLAttributes } from 'react';
import { Label } from '@/ui/shadcn/label';
import { Input, fieldControl } from '@/ui/shadcn/input';
import { cn } from '@/lib/utils';
import { tid } from '@/testids';
import { Tip } from './Affordances';

/* The prototype's .fld (qnipay-workforce-v15.html:489-508): a 12px/600 label
   5px above the control, hint or error 12px and 4px below it, 12px under the
   whole field. The required marker is .req, a small error-coloured
   "• required" beside the label, never an asterisk inside it.

   The wrapped control is one element carrying its own testId (TextInput,
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
    <div data-testid={tid.field.root(controlTestId)} className="mb-md flex flex-col last:mb-0">
      {/* The tip sits beside the label, not inside it, so its text never
          becomes part of the control's accessible name. */}
      <div className="mb-[5px] flex items-center">
        <Label htmlFor={id}>{label}</Label>
        {required && <span aria-hidden="true" data-caps
          className="ml-[5px] align-[1px] text-xs font-bold tracking-[.04em] text-err uppercase before:content-['•_']">required</span>}
        {tip && <Tip testId={tid.field.tip(controlTestId)} text={tip} />}
      </div>
      {control}
      {(error || hint) && <p id={descId} className={`mt-xs text-xs ${error ? 'text-err' : 'text-text-muted'}`}>{error ?? hint}</p>}
    </div>);
}
export function TextInput({ testId, ...rest }: { testId: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <Input data-testid={testId} {...rest} />;
}
/* A field's text box over several lines (.fld textarea): the input's look,
   growing downwards, for a reason or a note someone else will read. */
export function TextArea({ testId, className, rows = 3, ...rest }: { testId: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-testid={testId} rows={rows} {...rest} className={cn(fieldControl, 'h-auto resize-y py-[9px] leading-[1.5]', className)} />;
}

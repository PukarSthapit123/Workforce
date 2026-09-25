import { cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Label } from '@/ui/shadcn/label';
import { Input } from '@/ui/shadcn/input';
import { Tip } from './Affordances';

export function Field({ testId, label, hint, error, required, tip, children }: {
  testId: string; label: string; hint?: string; error?: string; required?: boolean; tip?: string; children: ReactNode;
}) {
  const id = useId(), descId = `${id}-desc`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id, 'aria-describedby': hint || error ? descId : undefined, 'aria-invalid': error ? 'true' : undefined,
        'aria-required': required ? 'true' : undefined })
    : children;
  return (
    <div data-testid={testId} className="flex flex-col gap-xs">
      <Label htmlFor={id} className="flex min-h-5 items-center gap-xs text-text-secondary">
        {label}{required && <span aria-hidden="true" className="text-err">*</span>}
        {tip && <Tip testId={`${testId}-tip`} text={tip} />}
      </Label>
      {control}
      {(error || hint) && <p id={descId} className={error ? 'text-err text-xs' : 'text-text-secondary text-xs'}>{error ?? hint}</p>}
    </div>);
}
export function TextInput({ testId, ...rest }: { testId: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <Input data-testid={testId} {...rest} />;
}

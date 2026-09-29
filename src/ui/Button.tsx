import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Button as Base } from '@/ui/shadcn/button';

/* The prototype's kinds: pri, sec, gho, dgr. Sizes: normal, sml. */
const KIND = { primary: 'default', secondary: 'secondary', ghost: 'ghost', danger: 'destructive' } as const;
export type ButtonKind = keyof typeof KIND;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  testId: string; kind?: ButtonKind; small?: boolean;
  /* While a write this button started (or one it would repeat) is in flight:
     aria-disabled and aria-busy rather than `disabled`, so keyboard focus stays
     on the button, and a click does nothing. */
  pending?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ testId, kind = 'secondary', small, pending, onClick, className, ...rest }, ref) =>
    <Base ref={ref} variant={KIND[kind]} size={small ? 'sm' : 'default'} {...rest}
      aria-disabled={pending || rest['aria-disabled'] || undefined} aria-busy={pending || undefined}
      className={`aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${className ?? ''}`}
      onClick={e => { if (pending) { e.preventDefault(); return; } onClick?.(e); }}
      data-testid={testId} />);
Button.displayName = 'Button';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Button as Base } from '@/ui/shadcn/button';

/* The prototype's kinds: pri, sec, gho, dgr. Sizes: normal, sml. */
const KIND = { primary: 'default', secondary: 'secondary', ghost: 'ghost', danger: 'destructive' } as const;
export type ButtonKind = keyof typeof KIND;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  testId: string; kind?: ButtonKind; small?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ testId, kind = 'secondary', small, ...rest }, ref) =>
    <Base ref={ref} data-testid={testId} variant={KIND[kind]} size={small ? 'sm' : 'default'} {...rest} />);
Button.displayName = 'Button';

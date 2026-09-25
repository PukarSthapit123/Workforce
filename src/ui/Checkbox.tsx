import type { ComponentProps } from 'react';
import { Checkbox as Base } from '@/ui/shadcn/checkbox';

export function CheckboxField({ testId, ...rest }: { testId: string } & ComponentProps<typeof Base>) {
  return <Base data-testid={testId} {...rest} />;
}

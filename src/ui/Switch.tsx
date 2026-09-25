import type { ComponentProps } from 'react';
import { Switch as Base } from '@/ui/shadcn/switch';

export function SwitchField({ testId, ...rest }: { testId: string } & ComponentProps<typeof Base>) {
  return <Base data-testid={testId} {...rest} />;
}

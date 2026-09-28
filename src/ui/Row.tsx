import type { ComponentProps } from 'react';
import { TableRow } from '@/ui/shadcn/table';

/* A body row of a table. Spec §9: every record row carries a test id, and
   testId is required here so a row without one is a type error, not a gap a
   review has to spot. Header rows are not records and use TableRow. */
export function Row({ testId, ...rest }: { testId: string } & ComponentProps<typeof TableRow>) {
  return <TableRow data-testid={testId} {...rest} />;
}

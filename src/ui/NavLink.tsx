import type { ComponentProps } from 'react';
import { Link } from 'react-router';

/* An in-app link. Spec §9: every link carries a test id, and testId is
   required here so a link without one is a type error. React 19 passes ref
   as an ordinary prop, so a Radix asChild parent (a menu item) still reaches
   the anchor. */
export function NavLink({ testId, ...rest }: { testId: string } & ComponentProps<typeof Link>) {
  return <Link data-testid={testId} {...rest} />;
}

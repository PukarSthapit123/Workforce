import type { ReactNode } from 'react';
import { Logo } from '@/ui';

/* The prototype's .topbar (qnipay-workforce-v15.html:258-265, 1521-1522,
   1552-1582): 56px of the inverse surface, sticky at the top above the tab
   strip, the logo hard left, 24px side padding (16px below 1024px, 10px on a
   phone), 16px between its parts (8px below 1024px). Signed out, it carries
   the logo alone (body.signed-out, v15:790). */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-[70] flex h-14 shrink-0 items-center gap-lg bg-surface-inverse px-xl text-text-on-brand max-lg:gap-sm max-lg:px-md max-md:px-[10px]">
      <span className="flex shrink-0 items-center"><Logo /></span>
      {children}
    </header>);
}

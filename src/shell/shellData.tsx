import { useEffect, useRef } from 'react';
import { ApiError } from '@/api/client';
import { useTenant } from '@/api/tenant';
import { buildNav, type NavGroup } from '@/domain/nav';
import type { Session } from '@/contract/session';
import { tid } from '@/testids';
import { Button } from '@/ui';
import { useSession } from './SessionProvider';

/* Shared by Shell and any routed page that needs to know what this account
   can reach (SetupIndex today). Both used to fetch the tenant and derive nav
   independently, and both went blank on a slow or failed tenant load: no
   header, no way to sign out. This is the one place that loading and error
   state is handled, so a page only ever renders once there is something real
   to show. */
export type ShellData =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry(): void; onSignOut(): void }
  | { kind: 'ready'; session: Session; nav: NavGroup[]; onSignOut(): void; onViewAs(personCode: string): void; onEndViewAs(): void };

/* The tenant's settings, from the one cached query the shell itself reads
   (src/api/tenant.ts, beside the writes that invalidate it). */
export { useTenant };

export function useShellData(): ShellData {
  const { session, signOut, viewAs, endViewAs } = useSession();
  const tenant = useTenant();
  /* A ref, not a dependency: signOut is a fresh function identity every
     SessionProvider render, and this must fire once per failed attempt, not
     once per unrelated re-render. Refs are only ever written from an effect,
     never during render itself. */
  const signOutRef = useRef(signOut);
  useEffect(() => { signOutRef.current = signOut; });
  useEffect(() => {
    if (tenant.error instanceof ApiError && tenant.error.status === 401) void signOutRef.current();
  }, [tenant.error]);

  if (!session) return { kind: 'loading' }; // Gate never mounts a routed page without a session
  if (tenant.isPending) return { kind: 'loading' };
  if (tenant.isError) {
    if (tenant.error instanceof ApiError && tenant.error.status === 401) return { kind: 'loading' }; // signing out
    return { kind: 'error', onRetry: () => void tenant.refetch(), onSignOut: () => void signOut() };
  }
  const nav = buildNav({ caps: new Set(session.capabilities), modules: tenant.data.modules, flags: tenant.data.flags, onboarding: session.onboarding });
  /* viewAs and endViewAs toast their own failures and never reject on a
     refusal (SessionProvider's switchView), so nothing here goes unhandled. */
  return { kind: 'ready', session, nav, onSignOut: () => void signOut(), onViewAs: personCode => void viewAs(personCode), onEndViewAs: () => void endViewAs() };
}

export function ShellLoading() {
  return (
    <div data-testid={tid.shell.loading} className="flex min-h-dvh items-center justify-center p-lg">
      <p className="text-text-secondary">Loading your workspace&hellip;</p>
    </div>);
}

export function ShellError({ onRetry, onSignOut }: { onRetry(): void; onSignOut(): void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-md p-lg text-center">
      <p data-testid={tid.shell.error} className="text-err">Qnipay could not load your workspace. Nothing has changed on your account.</p>
      <p className="text-text-secondary">Try again, or sign out and sign back in.</p>
      <div className="flex gap-sm">
        <Button testId={tid.shell.retry} kind="primary" onClick={onRetry}>Try again</Button>
        <Button testId={tid.shell.signOut} kind="ghost" onClick={onSignOut}>Sign out</Button>
      </div>
    </div>);
}

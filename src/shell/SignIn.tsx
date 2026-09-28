import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { listAccounts } from '@/contract/session';
import { tid } from '@/testids';
import { Button, Field, TextInput } from '@/ui';
import { useSession } from './SessionProvider';

const NOTE = { employee: 'Their own work: timesheet, shifts and leave', manager: 'Approvals and their team', admin: 'Configuration, modules and access' } as const;
/* listAccounts is documented as "demo account shortcuts", but its handler
   (src/mocks/session.ts) returns literally every seeded account: 19 for the
   social tenant, not a shortcut. The list's own aria-label already promises
   "a shortcut, not the whole list"; picking one representative account per
   persona keeps that promise true without changing the endpoint's contract
   (e2e's signInAs still reads the full, unbounded response directly). */
const DEMO_ORDER = ['employee', 'manager', 'admin'] as const;
function demoShortcut<T extends { userType: 'employee' | 'manager' | 'admin' }>(accounts: T[]): T[] {
  return DEMO_ORDER.map(t => accounts.find(a => a.userType === t)).filter((a): a is T => a !== undefined);
}
/* Demo sign-in only exists while the fake server runs. Gating the whole
   affordance (not just the fake server import in main.tsx) on the same flag
   keeps the demo password out of a VITE_MOCKS=off production bundle too:
   see scripts/trace.mjs's build-proof grep, task-11. */
const MOCKS_ENABLED = import.meta.env.VITE_MOCKS !== 'off';

export function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const accounts = useQuery({ queryKey: ['demo-accounts'], queryFn: () => api(listAccounts), enabled: showAccounts && MOCKS_ENABLED });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await signIn(email, password); }
    catch (err) { setError(err instanceof ApiError ? `${err.refusal.message} ${err.refusal.next}` : 'Sign-in failed. Nothing has been changed.'); }
    finally { setBusy(false); }
  }
  return (
    <main data-testid={tid.page('sign-in')} className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-lg p-lg">
      <h1 className="text-[length:var(--qp-text-24)] font-semibold">Sign in to Qnipay Workforce</h1>
      <p className="text-text-secondary">Simulated sign-in. Production uses your Microsoft work account.</p>
      <form data-testid={tid.signIn.form} onSubmit={submit} className="flex flex-col gap-md" noValidate>
        <Field label="Email address"><TextInput testId={tid.signIn.email} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Password"><TextInput testId={tid.signIn.password} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
        {error && <p data-testid={tid.signIn.error} role="alert" className="text-err">{error}</p>}
        <Button testId={tid.signIn.submit} kind="primary" type="submit" disabled={busy}>Sign in</Button>
      </form>
      {MOCKS_ENABLED && <>
        <Button testId={tid.signIn.showAccounts} kind="ghost" onClick={() => setShowAccounts(s => !s)}>{showAccounts ? 'Hide demo accounts' : 'Show demo accounts'}</Button>
        {showAccounts && <ul className="flex flex-col gap-xs" aria-label="Demo accounts. A shortcut, not the whole list.">
          {demoShortcut(accounts.data ?? []).map(a => <li key={a.email}>
            <button type="button" data-testid={tid.signIn.account(a.email)} className="w-full rounded-control border border-border p-sm text-left"
              onClick={() => { setEmail(a.email); setPassword('Qnipay@123'); }}>
              <b>{a.name}</b> · {NOTE[a.userType]}<span className="block text-text-secondary">{a.email}</span></button></li>)}
        </ul>}
      </>}
    </main>);
}

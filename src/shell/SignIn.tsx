import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { listAccounts } from '@/contract/session';
import { tid } from '@/testids';
import { Button, Field, Logo, Pill, TextInput, Tip } from '@/ui';
import { useSession } from './SessionProvider';
import { TopBar } from './TopBar';
import { FAKE_SERVER_ON } from '@/lib/fake-server';

const NOTE = { employee: 'Their own work: timesheet, shifts and leave', manager: 'Approvals and their team', admin: 'Configuration, modules and access' } as const;
const ROLE = { employee: 'Employee', manager: 'Manager', admin: 'Admin' } as const;
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
   affordance on the same flag as main.tsx's fake server import keeps the
   demo password out of a production bundle too; npm run build:check fails
   the build if it ever appears there. */

/* The prototype's loginScreen (qnipay-workforce-v15.html:5078-5115) and its
   CSS (.login, .login-card, .login-brand, .acct; v15:760-794): the top bar
   with the logo alone, then a 420px card (border, radius 12, 24px in,
   shadow-md) opening on the logo on an inverse strip. On a phone the card
   drops its border and shadow and sits in the page. */
export function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const accounts = useQuery({ queryKey: ['demo-accounts'], queryFn: () => api(listAccounts), enabled: showAccounts && FAKE_SERVER_ON });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await signIn(email, password); }
    catch (err) { setError(err instanceof ApiError ? `${err.refusal.message} ${err.refusal.next}` : 'Sign-in failed. Nothing has been changed.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main data-testid={tid.page('sign-in')} className="mx-auto w-full max-w-[1360px] px-xl max-lg:px-md">
        <div className="grid min-h-[calc(100dvh-120px)] place-items-center py-xl max-md:min-h-0 max-md:py-lg">
          <div className="w-[min(420px,100%)] rounded-card border bg-surface-card p-xl shadow-md max-md:border-0 max-md:px-0 max-md:py-md max-md:shadow-none">
            <div className="mb-lg flex rounded-sm bg-surface-inverse px-[14px] py-md"><Logo className="max-md:h-5" /></div>
            <h1 className="mb-[2px]">Sign in</h1>
            <p className="mb-lg text-text-secondary">Simulated sign-in. Production uses your Microsoft work account.</p>
            <form data-testid={tid.signIn.form} onSubmit={submit} noValidate>
              <Field label="Email address"><TextInput testId={tid.signIn.email} type="email" inputMode="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} /></Field>
              <Field label="Password"><TextInput testId={tid.signIn.password} type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
              {error && <p data-testid={tid.signIn.error} role="alert" className="mb-md rounded-card border border-l-4 border-err bg-err-surface px-lg py-md text-sm font-semibold text-err">{error}</p>}
              <Button testId={tid.signIn.submit} kind="primary" type="submit" disabled={busy} className="w-full">Sign in</Button>
            </form>
            {FAKE_SERVER_ON && <>
              <div className="mt-md text-center">
                <Button testId={tid.signIn.showAccounts} kind="link" aria-expanded={showAccounts} className="max-md:min-h-touch" onClick={() => setShowAccounts(s => !s)}>
                  {showAccounts ? 'Hide the accounts' : 'Which accounts exist?'}</Button>
              </div>
              {showAccounts && <>
                <div className="mt-lg mb-sm border-b pb-xs text-xs font-[650] text-text-secondary">Accounts on this demonstration</div>
                <ul className="mb-md flex max-h-[330px] flex-col gap-xs overflow-y-auto" aria-label="Demo accounts. A shortcut, not the whole list.">
                  {demoShortcut(accounts.data ?? []).map(a => <li key={a.email}>
                    <button type="button" data-testid={tid.signIn.account(a.email)}
                      className="block w-full rounded-control border bg-surface-card px-md py-sm text-left transition-colors hover:border-border-strong hover:bg-surface-tint focus-visible:border-brand"
                      onClick={() => { setEmail(a.email); setPassword('Qnipay@123'); }}>
                      <span className="flex flex-wrap items-center gap-sm"><b className="text-sm font-[650]">{a.name}</b><Pill tone="neu">{ROLE[a.userType]}</Pill></span>
                      <span className="mt-[2px] block truncate text-xs text-text-secondary tabular-nums">{a.email}</span>
                      <span className="mt-[2px] block text-xs text-text-muted">{NOTE[a.userType]}</span>
                    </button></li>)}
                </ul>
                <p className="text-xs text-text-muted">A shortcut, not the whole list: anybody on the roster signs in with their own address. Every account uses <b className="tabular-nums">Qnipay@123</b> until it is changed.</p>
              </>}
              {/* Ported from the prototype's login note (v15:5111-5114). Only true, and
                  so only shown, while the fake server holds the data in this browser. */}
              <p data-testid={tid.signIn.storageNote} className="mt-lg text-xs text-text-muted">
                This demonstration keeps your work in this browser, on this device, and sends it nowhere else.
                <Tip testId={tid.signIn.storageTip} text="Anything held in a browser can be read by whoever has the browser, so this is a demonstration, not a security boundary." /></p>
            </>}
          </div>
        </div>
      </main>
    </div>);
}

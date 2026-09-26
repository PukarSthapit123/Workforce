import { useEffect, useState, type ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { getTenant } from '@/contract/tenant';
import { buildNav, type NavGroup, type NavTab } from '@/domain/nav';
import { tid } from '@/testids';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { useSession } from './SessionProvider';
import { AccountMenu } from './AccountMenu';
import { NotBuilt } from '@/features/not-built/NotBuilt';
import { SetupIndex } from '@/features/setup/SetupIndex';
import { PermissionsPage } from '@/features/access/PermissionsPage';
import { AuditPage } from '@/features/audit/AuditPage';

const BUILT: Record<string, ComponentType> = { asetup: SetupIndex, aperm: PermissionsPage, iaudit: AuditPage };
const THEME_KEY = 'qnipay.theme';

/* Avoids a non-null assertion on role[0]: charAt(0) is always defined, even
   for an empty string, so this needs no unsafe indexing. */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Shell() {
  const { session, signOut, endViewAs } = useSession();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api(getTenant) });
  if (!session || !tenant.data) return null;
  const nav = buildNav({ caps: new Set(session.capabilities), modules: tenant.data.modules, flags: tenant.data.flags, onboarding: false });
  const role = session.viewingAs?.userType ?? session.account.userType;
  return <ShellView nav={nav} roleLabel={capitalise(role)} viewingAs={session.viewingAs?.name ?? null}
    unread={0} onSignOut={() => void signOut()} onEndViewAs={() => void endViewAs()} />;
}

export function ShellView({ nav, roleLabel, viewingAs, unread, onSignOut, onEndViewAs }: {
  nav: NavGroup[]; roleLabel: string; viewingAs: string | null; unread: number; onSignOut(): void; onEndViewAs(): void;
}) {
  const { pathname } = useLocation();
  const [theme, toggleTheme] = useTheme();
  const current = nav.find(g => pathname.startsWith(`/${g.key}/`)) ?? nav[0];
  const first = nav[0]?.tabs[0];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-md bg-surface-inverse px-lg py-sm text-primary-foreground">
        <span className="font-semibold">Qnipay</span>
        <nav aria-label="Areas" className="flex gap-xs">
          {nav.map(g => <Link key={g.key} to={firstTabPath(g)} data-testid={tid.nav.group(g.key)}
            aria-current={g === current ? 'true' : undefined}
            className={`rounded-pill px-md py-xs ${g === current ? 'bg-brand-accent text-foreground' : ''}`}>{g.label}</Link>)}
        </nav>
        <span className="ml-auto" />
        <span data-testid={tid.shell.rolePill} className="rounded-pill border px-sm py-xs text-xs font-semibold"
          title={viewingAs ? `Looking at the app as ${viewingAs}` : undefined}>{roleLabel}</span>
        <button type="button" data-testid={tid.shell.bell} aria-label={`Notifications, ${unread} unread`} className="relative">
          🔔{unread > 0 && <span data-testid={tid.shell.bellCount} className="absolute -right-2 -top-2 rounded-pill bg-brand-accent px-xs text-xs text-foreground">{unread}</span>}
        </button>
        <button type="button" data-testid={tid.shell.theme} aria-label="Switch to the other colour theme"
          className="rounded-pill border px-sm py-xs text-xs" onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
        <AccountMenu onSignOut={onSignOut} />
      </header>
      {viewingAs && <div role="status" className="flex items-center gap-md bg-warn-surface px-lg py-sm text-warn">
        Looking at the app as <b>{viewingAs}</b>. Your own account is unchanged.
        <button type="button" data-testid={tid.shell.viewAsEnd} className="underline" onClick={onEndViewAs}>Return to my account</button></div>}
      {current && <TabStrip tabs={current.tabs} pathname={pathname} />}
      <main className="flex-1 p-lg">
        <Routes>
          {nav.flatMap(g => g.tabs).map(t => {
            const Page = BUILT[t.view];
            return <Route key={t.path} path={t.path} element={Page ? <Page /> : <NotBuilt tab={t} />} />;
          })}
          <Route path="*" element={first ? <Navigate to={first.path} replace /> : <NothingAvailable />} />
        </Routes>
      </main>
      {current && <BottomBar tabs={current.tabs} pathname={pathname} />}
    </div>);
}

/* buildNav never returns a group with no tabs (it filters those out before
   returning), so the first tab always exists; this still satisfies
   noUncheckedIndexedAccess without a non-null assertion, and fails loudly
   (rather than silently) if that invariant is ever broken. */
function firstTabPath(g: NavGroup): string {
  const t = g.tabs[0];
  if (!t) throw new Error(`nav group "${g.key}" has no tabs`);
  return t.path;
}

function useTheme(): ['light' | 'dark', () => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const toggle = () => setTheme(t => {
    const next = t === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage full or blocked: the theme still applies this session */ }
    return next;
  });
  return [theme, toggle];
}

/* Plan review focus: a valid session whose capabilities resolve to nothing
   (e.g. everything revoked) must not render an empty shell. This is what it
   sees instead of a blank main area: a clear statement and what to do next. */
function NothingAvailable() {
  return (
    <section data-testid={tid.page('none')} className="mx-auto max-w-xl rounded-card border border-border bg-surface-card p-xl">
      <h1 className="text-[length:var(--qp-text-20)] font-semibold">Nothing available</h1>
      <p className="text-text-secondary">Your account has no access to open here. Ask an administrator to grant a capability on Qnipay setup &rarr; Permissions.</p>
    </section>);
}

function TabStrip({ tabs, pathname }: { tabs: NavTab[]; pathname: string }) {
  const runs: { group?: string; tabs: NavTab[] }[] = [];
  tabs.forEach(t => { const last = runs[runs.length - 1]; if (t.group && last?.group === t.group) last.tabs.push(t); else runs.push({ group: t.group, tabs: [t] }); });
  const link = (t: NavTab) => <Link key={t.view} to={t.path} data-testid={tid.nav.tab(t.view)} aria-current={pathname === t.path ? 'page' : undefined}
    className={`px-md py-sm ${pathname === t.path ? 'border-b-2 border-brand font-semibold' : ''}`}>{t.label}</Link>;
  return (
    <nav aria-label="Pages" className="flex gap-xs overflow-x-auto border-b border-border bg-surface-card px-lg">
      {runs.map(r => !r.group ? r.tabs.map(link) : (
        <DropdownMenu key={r.group}>
          <DropdownMenuTrigger data-testid={tid.nav.menu(r.group.toLowerCase())} className={`px-md py-sm ${r.tabs.some(t => t.path === pathname) ? 'font-semibold' : ''}`}>{r.group} ▾</DropdownMenuTrigger>
          <DropdownMenuContent>{r.tabs.map(t => <DropdownMenuItem key={t.view} asChild>{link(t)}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>))}
    </nav>);
}

/* Prototype render() (html:10214-10230): at most five destinations, plus a
   catch-all More. The e2e phone checks come in plan 1c; here it only needs to
   render (below 768px) and carry its own test ids. */
function BottomBar({ tabs, pathname }: { tabs: NavTab[]; pathname: string }) {
  const destinations = tabs.slice(0, 5);
  if (!destinations.length) return null;
  return (
    <nav aria-label="Quick pages" className="flex border-t border-border bg-surface-card md:hidden">
      {destinations.map(t => <Link key={t.view} to={t.path} data-testid={tid.nav.bottom(t.view)}
        aria-current={pathname === t.path ? 'page' : undefined}
        className={`flex flex-1 flex-col items-center px-sm py-sm text-xs ${pathname === t.path ? 'font-semibold text-brand' : 'text-text-secondary'}`}>{t.label}</Link>)}
      <button type="button" data-testid={tid.nav.more} className="flex flex-1 flex-col items-center px-sm py-sm text-xs text-text-secondary">More</button>
    </nav>);
}

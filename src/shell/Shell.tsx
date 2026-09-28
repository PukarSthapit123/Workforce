import { useEffect, useState, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { NavGroup, NavTab } from '@/domain/nav';
import { tid } from '@/testids';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { Modal, NavLink } from '@/ui';
import { AccountMenu, type MenuAccount } from './AccountMenu';
import { useShellData, ShellLoading, ShellError } from './shellData';
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
  const data = useShellData();
  if (data.kind === 'loading') return <ShellLoading />;
  if (data.kind === 'error') return <ShellError onRetry={data.onRetry} onSignOut={data.onSignOut} />;
  const { session } = data;
  const role = session.viewingAs?.userType ?? session.account.userType;
  return <ShellView nav={data.nav} roleLabel={capitalise(role)} viewingAs={session.viewingAs?.name ?? null}
    account={session.account} canViewAs={session.capabilities.includes('perm_cfg')} unread={0}
    onSignOut={data.onSignOut} onViewAs={data.onViewAs} onEndViewAs={data.onEndViewAs} />;
}

export function ShellView({ nav, roleLabel, viewingAs, account, canViewAs = false, unread, onSignOut, onViewAs = () => {}, onEndViewAs }: {
  nav: NavGroup[]; roleLabel: string; viewingAs: string | null; account: MenuAccount; canViewAs?: boolean; unread: number;
  onSignOut(): void; onViewAs?(personCode: string): void; onEndViewAs(): void;
}) {
  const { pathname } = useLocation();
  const [theme, toggleTheme] = useTheme();
  const current = nav.find(g => pathname.startsWith(`/${g.key}/`)) ?? nav[0];
  const first = nav[0]?.tabs[0];
  const stripTabs = stripTabsFor(current, pathname);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-sm bg-surface-inverse px-md py-sm text-text-on-brand md:gap-md md:px-lg">
        <span className="hidden font-semibold md:inline">Qnipay</span>
        <nav aria-label="Areas" className="flex min-w-0 flex-1 gap-xs overflow-x-auto">
          {nav.map(g => <NavLink key={g.key} to={firstTabPath(g)} testId={tid.nav.group(g.key)}
            aria-current={g === current ? 'true' : undefined}
            className={`inline-flex min-h-touch shrink-0 items-center whitespace-nowrap rounded-pill px-md py-xs ${g === current ? 'bg-brand-accent text-text-on-accent' : ''}`}>{g.label}</NavLink>)}
        </nav>
        <span data-testid={tid.shell.rolePill}
          className={`hidden shrink-0 items-center rounded-pill border px-sm py-xs text-xs font-semibold md:inline-flex ${viewingAs ? 'border-dashed opacity-85' : ''}`}
          title={viewingAs ? `Looking at the app as ${viewingAs} · your account is ${account.name}` : undefined}>{roleLabel}</span>
        <button type="button" data-testid={tid.shell.bell} aria-label={`Notifications, ${unread} unread`}
          className="relative inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center">
          <span aria-hidden="true">🔔</span>{unread > 0 && <span data-testid={tid.shell.bellCount} className="absolute -right-2 -top-2 rounded-pill bg-brand-accent px-xs text-xs text-text-on-accent">{unread}</span>}
        </button>
        <button type="button" data-testid={tid.shell.theme} aria-label={`${theme === 'dark' ? 'Light' : 'Dark'} theme`}
          className="inline-flex min-h-touch shrink-0 items-center rounded-pill border px-sm py-xs text-xs" onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
        <AccountMenu account={account} viewingAs={viewingAs} canViewAs={canViewAs} onSignOut={onSignOut} onViewAs={onViewAs} onEndViewAs={onEndViewAs} />
      </header>
      {viewingAs && <div role="status" className="flex flex-wrap items-center gap-md bg-warn-surface px-lg py-sm text-warn">
        Looking at the app as <b>{viewingAs}</b>. Your own account is unchanged.
        <button type="button" data-testid={tid.shell.viewAsEnd} className="inline-flex min-h-touch items-center underline" onClick={onEndViewAs}>Return to my account</button></div>}
      {stripTabs.length > 0 && <TabStrip tabs={stripTabs} pathname={pathname} />}
      <main className="flex-1 p-lg">
        <Routes>
          {nav.flatMap(g => g.tabs).map(t => {
            const Page = BUILT[t.view];
            return <Route key={t.path} path={t.path} element={Page ? <Page /> : <NotBuilt tab={t} />} />;
          })}
          <Route path="*" element={first ? <Navigate to={first.path} replace /> : <NothingAvailable />} />
        </Routes>
      </main>
      {stripTabs.length > 0 && <BottomBar tabs={stripTabs} pathname={pathname} />}
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

/* Setup is not one flat strip: at the index there is nothing to show below
   the header (SetupIndex itself shows the section cards), and inside a
   section the strip shows only that section's pages, plus a way back
   (ported from the prototype's SETUP_SECTIONS drill and its "‹ All setup"
   tab, qnipay-workforce-v15.html:4075). Work and My Team are unaffected:
   their strip is just the group's tabs, as it always was. */
export function stripTabsFor(current: NavGroup | undefined, pathname: string): NavTab[] {
  if (!current) return [];
  if (current.key !== 'setup') return current.tabs;
  const index = current.tabs.find(t => t.view === 'asetup');
  const active = current.tabs.find(t => t.path === pathname);
  const section = active?.section;
  if (!section) return [];
  const back: NavTab = { view: 'asetup', label: '‹ All setup', path: index?.path ?? '/setup/asetup', built: true };
  return [back, ...current.tabs.filter(t => t.section === section)];
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

function menuKey(r: { group?: string; groupKey?: string }): string {
  if (!r.groupKey) throw new Error(`nav group "${r.group ?? '(none)'}" has no stable key`);
  return r.groupKey;
}

function TabStrip({ tabs, pathname }: { tabs: NavTab[]; pathname: string }) {
  const runs: { group?: string; groupKey?: string; tabs: NavTab[] }[] = [];
  tabs.forEach(t => { const last = runs[runs.length - 1]; if (t.group && last?.group === t.group) last.tabs.push(t); else runs.push({ group: t.group, groupKey: t.groupKey, tabs: [t] }); });
  const link = (t: NavTab) => <NavLink key={t.view} to={t.path} testId={tid.nav.tab(t.view)} aria-current={pathname === t.path ? 'page' : undefined}
    className={`inline-flex min-h-touch shrink-0 items-center whitespace-nowrap px-md py-sm ${pathname === t.path ? 'border-b-2 border-brand font-semibold' : ''}`}>{t.label}</NavLink>;
  return (
    <nav aria-label="Pages" className="hidden gap-xs overflow-x-auto border-b border-border bg-surface-card px-lg md:flex">
      {runs.map(r => !r.group ? r.tabs.map(link) : (
        <DropdownMenu key={r.group}>
          <DropdownMenuTrigger data-testid={tid.nav.menu(menuKey(r))} className={`inline-flex min-h-touch shrink-0 items-center whitespace-nowrap px-md py-sm ${r.tabs.some(t => t.path === pathname) ? 'font-semibold' : ''}`}>{r.group} <span aria-hidden="true">▾</span></DropdownMenuTrigger>
          <DropdownMenuContent>{r.tabs.map(t => <DropdownMenuItem key={t.view} asChild>{link(t)}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>))}
    </nav>);
}

/* Prototype render() (html:10214-10230, more-tabs handler html:12072-12081):
   at most five destinations, plus More for the rest, painted from the same
   array the strip uses (`tabs` here is Shell's `stripTabs`, so setup already
   arrives section-scoped with its "back to setup" entry at index 0 — nothing
   setup-specific needed here). Shown below 768px, the same width the strip
   above hides at (prototype .tabs{display:none}/.btabs{display:flex} pair,
   html:791-818). More opens a Dialog (Radix traps and restores focus, per
   Modal.tsx) rather than a dropdown: closer to the prototype's own "Go to"
   box than an anchored menu would be. Each destination there closes it on
   selection (prototype: `data-tab data-close` on the same button), so it
   never blocks reopening it for the next one. */
function BottomBar({ tabs, pathname }: { tabs: NavTab[]; pathname: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const destinations = tabs.slice(0, 5);
  const remaining = tabs.slice(5);
  if (!destinations.length) return null;
  return (
    <nav aria-label="Quick pages" className="flex border-t border-border bg-surface-card md:hidden">
      {destinations.map(t => <NavLink key={t.view} to={t.path} testId={tid.nav.bottom(t.view)}
        aria-current={pathname === t.path ? 'page' : undefined}
        className={`flex min-h-touch flex-1 flex-col items-center justify-center px-sm py-sm text-xs ${pathname === t.path ? 'font-semibold text-brand' : 'text-text-secondary'}`}>{t.label}</NavLink>)}
      {remaining.length > 0 && <>
        <button type="button" data-testid={tid.nav.more} aria-haspopup="dialog" onClick={() => setMoreOpen(true)}
          className="flex min-h-touch flex-1 flex-col items-center justify-center px-sm py-sm text-xs text-text-secondary">More</button>
        <Modal open={moreOpen} onOpenChange={setMoreOpen} title="More pages">
          <ul className="flex flex-col gap-xs">
            {remaining.map(t => <li key={t.view}>
              <NavLink to={t.path} testId={tid.nav.bottom(t.view)} onClick={() => setMoreOpen(false)}
                aria-current={pathname === t.path ? 'page' : undefined}
                className={`flex min-h-touch items-center rounded-control px-md ${pathname === t.path ? 'font-semibold text-brand' : ''}`}>{t.label}</NavLink>
            </li>)}
          </ul>
        </Modal>
      </>}
    </nav>);
}

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Sun, TriangleAlert } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import type { NavGroup, NavTab } from '@/domain/nav';
import type { Session } from '@/contract/session';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { buttonVariants } from '@/ui/shadcn/button';
import { Modal, NavLink, Page, PageHead, Card, toastInfo } from '@/ui';
import { AccountMenu, type MenuAccount } from './AccountMenu';
import { TopBar } from './TopBar';
import { NotificationBell, type InboxState } from './Inbox';
import { useMarkAllRead, useMarkRead, useMyNotifications } from '@/api/notifications';
import { useShellData, ShellLoading, ShellError } from './shellData';
import { NotBuilt } from '@/features/not-built/NotBuilt';
import { PageUnavailable } from '@/features/not-built/PageUnavailable';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { SetupIndex } from '@/features/setup/SetupIndex';
import { PermissionsPage } from '@/features/access/PermissionsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { AdminPeoplePage } from '@/features/people/AdminPeoplePage';
import { TeamPeoplePage } from '@/features/people/TeamPeoplePage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { DimensionsPage } from '@/features/dimensions/DimensionsPage';
import { ContractsPage } from '@/features/dimensions/ContractsPage';
import { EmployeeTypesPage } from '@/features/employee-types/EmployeeTypesPage';
import { TimesheetPage } from '@/features/timesheet/TimesheetPage';
import { TeamTimesheetsPage } from '@/features/timesheet/TeamTimesheetsPage';
import { TimesheetSetupPage } from '@/features/timesheet/TimesheetSetupPage';
import { RotaPage } from '@/features/rota/RotaPage';
import { ShiftsPage } from '@/features/rota/ShiftsPage';
import { PatternsPage } from '@/features/rota/PatternsPage';
import { CoverPage } from '@/features/rota/CoverPage';
import { MyShiftsPage } from '@/features/rota/MyShiftsPage';
import { RotaSetupPage } from '@/features/rota/RotaSetupPage';
import { LeavePage } from '@/features/leave/LeavePage';
import { TeamLeavePage } from '@/features/leave/TeamLeavePage';
import { SicknessPage } from '@/features/leave/SicknessPage';
import { LeaveSetupPage } from '@/features/leave/LeaveSetupPage';
import { ModulesPage } from '@/features/modules/ModulesPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { OrganisationPage } from '@/features/organisation/OrganisationPage';
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage';
import { NoticesPage } from '@/features/notices/NoticesPage';
import { TeamNoticesPage } from '@/features/notices/TeamNoticesPage';
import { HomePage } from '@/features/home/HomePage';
import { TeamHomePage } from '@/features/home/TeamHomePage';
import { DocumentsPage } from '@/features/home/DocumentsPage';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';
import { TeamOnboardingPage } from '@/features/onboarding/TeamOnboardingPage';
import { moduleBy } from '@/domain/modules';

const BUILT: Record<string, ComponentType> = { asetup: SetupIndex, aperm: PermissionsPage, iaudit: AuditPage,
  apeople: AdminPeoplePage, tpeople: TeamPeoplePage, profile: ProfilePage,
  aloc: DimensionsPage, acon: ContractsPage, atypes: EmployeeTypesPage, ts: TimesheetPage, tteam: TeamTimesheetsPage,
  mts: TimesheetSetupPage, trota: RotaPage, tshifts: ShiftsPage, tpat: PatternsPage,
  tcover: CoverPage, shifts: MyShiftsPage, mrota: RotaSetupPage, leave: LeavePage, tleave: TeamLeavePage, tsick: SicknessPage, mleave: LeaveSetupPage,
  amods: ModulesPage, acal: CalendarPage, aorg: OrganisationPage, anotif: NotificationsPage, aappr: ApprovalsPage, notices: NoticesPage, tnotices: TeamNoticesPage,
  home: HomePage, thome: TeamHomePage, docs: DocumentsPage, onb: OnboardingPage, tonb: TeamOnboardingPage };
const THEME_KEY = 'qnipay.theme';

/* Avoids a non-null assertion on role[0]: charAt(0) is always defined, even
   for an empty string, so this needs no unsafe indexing. */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* The role pill's text: the user type's display name (D11), so a renamed
   role shows its new name; while viewing as someone, the viewed person's. */
export function roleLabelOf(session: Pick<Session, 'account' | 'viewingAs'>): string {
  const on = session.viewingAs ?? session.account;
  return on.roleName || capitalise(on.userType);
}

export function Shell() {
  const data = useShellData();
  if (data.kind === 'loading') return <ShellLoading />;
  if (data.kind === 'error') return <ShellError onRetry={data.onRetry} onSignOut={data.onSignOut} />;
  const { session } = data;
  return <ShellView nav={data.nav} roleLabel={roleLabelOf(session)} viewingAs={session.viewingAs?.name ?? null}
    account={session.account} canViewAs={session.capabilities.includes('perm_cfg')}
    who={`${session.account.email}|${session.viewingAs?.personCode ?? ''}`}
    onSignOut={data.onSignOut} onViewAs={data.onViewAs} onEndViewAs={data.onEndViewAs} />;
}

/* The bell's inbox (D9): the reader's own items from the server. Opening one
   marks it read (not while looking at the app as someone else, which changes
   nothing) and goes where it points; the dot and the count change only once
   the server has answered. */
function useInbox(readOnly: boolean): InboxState {
  const q = useMyNotifications(), markRead = useMarkRead(), markAll = useMarkAllRead();
  return {
    status: q.isPending ? 'loading' : q.isError ? 'error' : 'ready', items: q.data?.items ?? [], unread: q.data?.unread ?? 0,
    readOnly, markAllPending: markAll.isPending('notifications/all'),
    onOpen: n => {
      if (!n.read && !readOnly) markRead.mutate({ id: n.id });
      toastInfo(`Opened from your notifications: ${n.title}.`);
    },
    onMarkAll: () => { if (!readOnly) markAll.mutate(null); },
  };
}

/* The shell chrome is shared: a module never restyles it. Top bar, then the
   tab strip (desktop) or the bottom bar (phone), both painted from the same
   array, then the routed page inside its own Page frame. */
export function ShellView({ nav, roleLabel, viewingAs, account, canViewAs = false, inbox, who, onSignOut, onViewAs = () => {}, onEndViewAs }: {
  nav: NavGroup[]; roleLabel: string; viewingAs: string | null; account: MenuAccount; canViewAs?: boolean;
  /* the bell's inbox; read from the server when not given */
  inbox?: InboxState;
  /* who the app is showing: the account, and whoever it is viewing as */
  who?: string;
  onSignOut(): void; onViewAs?(personCode: string): void; onEndViewAs(): void;
}) {
  const { pathname, search } = useLocation();
  useHomeOnSwitch(who, nav, pathname);
  const [theme, toggleTheme] = useTheme();
  const current = nav.find(g => pathname.startsWith(`/${g.key}/`)) ?? nav[0];
  const first = nav[0]?.tabs[0];
  const stripTabs = stripTabsFor(current, pathname, search);
  const here = pathname + search;
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar>
        <nav aria-label="Areas" className="flex min-w-0 gap-[2px] md:flex-wrap max-md:flex-1 max-md:flex-nowrap max-md:overflow-x-auto max-md:[scrollbar-width:none]">
          {nav.map(g => <AreaLink key={g.key} group={g} current={g === current} />)}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-md max-md:gap-[2px]">
          {/* .rolepill (v15:303-306): the role on screen, in the accent, in
              capitals. Dashed while looking at the app as someone else. */}
          <span data-testid={tid.shell.rolePill} data-caps
            className={cn('hidden shrink-0 items-center rounded-pill border border-accent-line px-[11px] py-xs text-xs font-bold tracking-[.05em] text-brand-accent uppercase md:inline-flex', viewingAs && 'border-dashed opacity-85')}
            title={viewingAs ? `Looking at the app as ${viewingAs} · your account is ${account.name}` : undefined}>{roleLabel}</span>
          <IconButton testId={tid.shell.theme} label={`${theme === 'dark' ? 'Light' : 'Dark'} theme`} onClick={toggleTheme}><Sun aria-hidden="true" /></IconButton>
          {inbox ? <NotificationBell inbox={inbox} /> : <ServerBell readOnly={viewingAs !== null} />}
          <AccountMenu account={account} viewingAs={viewingAs} canViewAs={canViewAs} onSignOut={onSignOut} onViewAs={onViewAs} onEndViewAs={onEndViewAs} />
        </div>
      </TopBar>
      {viewingAs && <div role="status" className="flex flex-wrap items-center gap-md border-b border-warn bg-warn-surface px-xl py-sm text-sm text-warn max-lg:px-md">
        <span>Looking at the app as <b>{viewingAs}</b>. Your own account is unchanged.</span>
        <button type="button" data-testid={tid.shell.viewAsEnd} className="inline-flex min-h-touch items-center font-semibold underline" onClick={onEndViewAs}>Return to my account</button></div>}
      {stripTabs.length > 0 && <TabStrip tabs={stripTabs} here={here} />}
      {/* the page reserves what the bottom bar occupies, home indicator included (v15:815-816) */}
      <main className={cn('flex-1 md:pb-10', stripTabs.length > 0 && 'max-md:pb-[calc(72px+env(safe-area-inset-bottom,0px))]')}>
        <Routes>
          {nav.flatMap(g => g.tabs).map(t => {
            const Built = BUILT[t.view];
            return <Route key={t.path} path={t.path} element={Built ? <Built /> : <NotBuilt tab={t} />} />;
          })}
          <Route path="/" element={first ? <Navigate to={first.path} replace /> : <NothingAvailable />} />
          <Route path="*" element={first ? <PageUnavailable path={pathname} home={first} /> : <NothingAvailable />} />
        </Routes>
      </main>
      {stripTabs.length > 0 && <BottomBar tabs={stripTabs} here={here} />}
    </div>);
}

function ServerBell({ readOnly }: { readOnly: boolean }) {
  return <NotificationBell inbox={useInbox(readOnly)} />;
}

/* Switching account or who you view as starts from that person's first page
   when the page on screen is not theirs; a link opened on purpose to a page
   you cannot reach says so instead (PageUnavailable). */
function useHomeOnSwitch(who: string | undefined, nav: NavGroup[], pathname: string) {
  const navigate = useNavigate(), last = useRef(who);
  useEffect(() => {
    if (last.current === who) return;
    last.current = who;
    const first = nav[0]?.tabs[0];
    if (first && !nav.some(g => g.tabs.some(t => t.path === pathname))) void navigate(first.path, { replace: true });
  }, [who, nav, pathname, navigate]);
}

/* .modsw button (v15:287-301, 1527, 1560-1561): 14px/500 in the muted shell
   green, 7px 14px, a white lift on hover; the current area in the accent at
   600. The link itself is the 44px touch target; the pill is drawn inside
   it, so the bar keeps the prototype's 34px pill. */
function AreaLink({ group, current }: { group: NavGroup; current: boolean }) {
  return (
    <NavLink to={firstTabPath(group)} testId={tid.nav.group(group.key)} aria-current={current ? 'true' : undefined}
      className="group inline-flex min-h-touch shrink-0 items-center rounded-pill focus-visible:shadow-none">
      <span className={cn('rounded-pill px-[14px] py-[7px] text-sm whitespace-nowrap transition-colors duration-(--qp-duration-fast) ease-qp group-focus-visible:shadow-focus max-lg:px-[9px] max-lg:py-[6px] max-lg:text-xs max-md:px-[11px]',
        current ? 'bg-brand-accent font-semibold text-text-on-accent' : 'font-medium text-shell-ink-muted group-hover:bg-shell-hover group-hover:text-text-on-brand')}>{group.label}</span>
    </NavLink>);
}

/* .iconbtn (v15:307-315, 1549): a 34px round button in the pale shell ink
   with an 18px stroked icon, 44px on a phone. */
function IconButton({ testId, label, onClick, children }: { testId: string; label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" data-testid={testId} aria-label={label} onClick={onClick}
      className="relative grid size-[34px] shrink-0 place-items-center rounded-pill text-shell-ink transition-colors duration-(--qp-duration-fast) hover:bg-shell-hover max-md:size-11 [&>svg]:size-[18px]">
      {children}
    </button>);
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

/* Setup is not one flat strip. At the index the strip holds the index's own
   tab alone, selected, as the prototype's does ("Qnipay setup"); inside a
   section it shows only that section's pages, plus a way back (ported from
   the prototype's SETUP_SECTIONS drill and its "‹ All setup" tab,
   qnipay-workforce-v15.html:4075). Work and My Team are unaffected: their
   strip is just the group's tabs, as it always was. Inside Modules, opening
   a module (/setup/amods?m=<code>) drills in once more, as the prototype's
   NAV() does (v15:4059-4076): a way back to the module list, the module's
   features, and its setup page when this person can reach it. A module's
   setup page (mts, mrota, mleave) sits inside that drill-in, never on the
   Modules section's own strip (suite ADMIN LAYOUT: "‹ All modules |
   Timesheet features | Timesheet setup"). */
export function stripTabsFor(current: NavGroup | undefined, pathname: string, search = ''): NavTab[] {
  if (!current) return [];
  if (current.key !== 'setup') return current.tabs;
  const index = current.tabs.find(t => t.view === 'asetup');
  const active = current.tabs.find(t => t.path === pathname);
  const section = active?.section;
  if (!section) return index && active === index ? [index] : [];
  const m = moduleBy(active.module ?? (active.view === 'amods' ? new URLSearchParams(search).get('m') ?? '' : ''));
  const amods = current.tabs.find(t => t.view === 'amods');
  if (m && amods) {
    const own = current.tabs.find(t => t.view === m.setup);
    return [
      { view: 'amods', label: '‹ All modules', path: amods.path, built: true, back: true },
      { view: 'mfeat', label: `${m.name} features`, path: `${amods.path}?m=${m.code}`, built: true },
      ...(own && m.setupLabel ? [{ ...own, label: m.setupLabel }] : []),
    ];
  }
  const back: NavTab = { view: 'asetup', label: '‹ All setup', path: index?.path ?? '/setup/asetup', built: true, back: true };
  return [back, ...current.tabs.filter(t => t.section === section && !t.module)];
}
/* Whether a strip tab is the page on screen. A tab whose path carries a query
   (a module's features) matches only with that query; any other matches its
   path whatever the query, and a way back never does. */
export const isHere = (t: NavTab, here: string) => !t.back && (t.path.includes('?') ? here === t.path : here.split('?')[0] === t.path);

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
    <Page testId={tid.page('none')} narrow>
      <PageHead title="Nothing available" />
      <Card><p className="text-text-secondary">Your account has no access to open here. Ask an administrator to grant a capability on Qnipay setup &rarr; Permissions.</p></Card>
    </Page>);
}

function menuKey(r: { group?: string; groupKey?: string }): string {
  if (!r.groupKey) throw new Error(`nav group "${r.group ?? '(none)'}" has no stable key`);
  return r.groupKey;
}

/* .tabs (v15:338-351, 1523): the 44px card-surface strip, sticky under the
   top bar, 24px side padding (16px below 1024px). A tab is 14px/500 in
   secondary ink, 0 13px, 43px tall over a 2px rule; hover lifts it onto the
   tint; selected is brand ink at 600 with the rule in brand (the accent in
   dark). A heading's menu (.tabgrp, .tabmenu; v15:352-384) marks the page
   you are on with a fill and an inset bar, never colour alone. */
const TAB = 'relative inline-flex h-[43px] shrink-0 items-center border-b-2 border-transparent px-[13px] text-sm font-medium whitespace-nowrap text-text-secondary transition-colors duration-(--qp-duration-fast) hover:bg-surface-tint hover:text-text-primary';
const TAB_ON = 'border-brand font-semibold text-brand hover:bg-transparent hover:text-brand dark:border-brand-accent dark:text-brand-accent dark:hover:text-brand-accent';
function TabStrip({ tabs, here }: { tabs: NavTab[]; here: string }) {
  const runs: { group?: string; groupKey?: string; tabs: NavTab[] }[] = [];
  tabs.forEach(t => { const last = runs[runs.length - 1]; if (t.group && last?.group === t.group) last.tabs.push(t); else runs.push({ group: t.group, groupKey: t.groupKey, tabs: [t] }); });
  const link = (t: NavTab) => <NavLink key={t.view} to={t.path} testId={tid.nav.tab(t.view)} aria-current={isHere(t, here) ? 'page' : undefined}
    className={cn(TAB, isHere(t, here) && TAB_ON)}>{t.label}</NavLink>;
  return (
    <nav aria-label="Pages" className="sticky top-14 z-[60] hidden min-h-11 flex-wrap items-stretch gap-y-[2px] border-b bg-surface-card px-xl max-lg:px-md md:flex">
      {runs.map(r => !r.group ? r.tabs.map(link) : (
        <DropdownMenu key={r.group}>
          <DropdownMenuTrigger data-testid={tid.nav.menu(menuKey(r))}
            className={cn(TAB, 'data-[state=open]:bg-surface-tint data-[state=open]:text-text-primary', r.tabs.some(t => isHere(t, here)) && TAB_ON)}>
            {r.group}<span aria-hidden="true" className="ml-[5px] text-xs leading-none opacity-55">▾</span></DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={-1} className="min-w-[212px] p-[5px] shadow-md">
            {r.tabs.map(t => <DropdownMenuItem key={t.view} asChild
              className={cn('h-9 px-[10px] py-0 font-medium whitespace-nowrap text-text-secondary focus:text-text-primary',
                isHere(t, here) && 'bg-brand-subtle font-semibold text-brand shadow-[inset_2px_0_0_var(--qp-color-brand-primary)] focus:bg-brand-subtle focus:text-brand dark:text-brand-accent dark:shadow-[inset_2px_0_0_var(--qp-color-brand-accent)] dark:focus:text-brand-accent')}>
              <NavLink to={t.path} testId={tid.nav.tab(t.view)} aria-current={isHere(t, here) ? 'page' : undefined}>{t.label}</NavLink>
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>))}
    </nav>);
}

/* The prototype's bottom bar glyphs (TAB_GLYPH, v15:10648-10653). The two
   that are emoji code points (a sun, a warning sign) come from the shared
   icon set instead, at the same 14px. Anything unlisted takes the dot. */
const GLYPH: Record<string, ReactNode> = {
  home: '⌂', ts: '◷', shifts: '▦', leave: <Sun />, hours: '◴', profile: '○', docs: '▤', onb: '◱', notices: '⚑', tnotices: '⚑',
  thome: '⌂', tteam: '◷', thours: '◴', trota: '▦', tcover: '◈', tleave: <Sun />, tsick: '⊕', tpeople: '○', tonb: '◱', texc: <TriangleAlert />,
  tshifts: '▥', tpat: '▧',
};
const BAR_ITEM = 'flex min-h-[52px] min-w-0 flex-1 flex-col items-center gap-[3px] px-[2px] pt-[9px] pb-[10px] text-xs leading-[1.25] font-semibold';
const barGlyph = (g: ReactNode) => <span aria-hidden="true" className="text-sm leading-none [&_svg]:size-[14px]">{g}</span>;
/* The first word of a tab's name, as the prototype shows it; the link's
   accessible name stays the whole name. */
const shortLabel = (label: string) => label.split(' ')[0] ?? label;

/* .btabs (v15:796-817): fixed to the foot of a phone screen above the page
   (80) and below any sheet (100+), the home-indicator inset added once, by
   the bar. Each destination is a 52px column: a glyph over a 12px/600 short
   label in muted ink, the one you are on in brand (the accent in dark). At
   most five items: five destinations, or four and More for the rest, from
   the same array the strip uses (v15:10654-10661; `tabs` here is Shell's
   `stripTabs`, so setup already arrives section-scoped with its "back to
   setup" entry first). More is lit while the page on screen is one the bar
   has no room for, and opens the Go to sheet listing every page (GoToSheet):
   a Dialog (Radix traps and restores focus, per Modal.tsx), a sheet from the
   bottom on a phone, closed by choosing a page. */
function BottomBar({ tabs, here }: { tabs: NavTab[]; here: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const overflow = tabs.length > 5;
  const destinations = overflow ? tabs.slice(0, 4) : tabs;
  const remaining = overflow ? tabs.slice(4) : [];
  if (!destinations.length) return null;
  const on = (active: boolean) => active ? 'text-brand dark:text-brand-accent' : 'text-text-muted';
  return (
    <nav aria-label="Quick pages" className="fixed inset-x-0 bottom-0 z-[80] flex border-t bg-surface-card pb-[env(safe-area-inset-bottom,0px)] md:hidden">
      {destinations.map(t => <NavLink key={t.view} to={t.path} testId={tid.nav.bottom(t.view)} aria-label={t.label}
        aria-current={isHere(t, here) ? 'page' : undefined} className={cn(BAR_ITEM, on(isHere(t, here)))}>
        {barGlyph(GLYPH[t.view] ?? '●')}<span className="max-w-full truncate">{shortLabel(t.label)}</span></NavLink>)}
      {remaining.length > 0 && <>
        <button type="button" data-testid={tid.nav.more} aria-haspopup="dialog" aria-label="More sections" onClick={() => setMoreOpen(true)}
          className={cn(BAR_ITEM, on(remaining.some(t => isHere(t, here))))}>{barGlyph('⋯')}<span>More</span></button>
        <GoToSheet tabs={tabs} here={here} open={moreOpen} onOpenChange={setMoreOpen} />
      </>}
    </nav>);
}

/* The prototype's more-tabs sheet (v15:12072-12080): "Go to", every page of
   the strip in its order, one .att row each (the name, then on the right
   Current for the page you are on, Open for the rest). Choosing one goes
   there and closes the sheet. */
function GoToSheet({ tabs, here, open, onOpenChange }: { tabs: NavTab[]; here: string; open: boolean; onOpenChange(o: boolean): void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Go to">
      <ul data-testid={tid.nav.goToList} className="overflow-hidden rounded-card border bg-surface-card">
        {tabs.map(t => {
          const current = isHere(t, here);
          return (
            <li key={t.view} className="flex items-center gap-md border-b px-md py-[10px] text-sm last:border-b-0">
              <span className="min-w-0">{t.label}</span>
              <NavLink to={t.path} testId={tid.nav.goTo(t.view)} onClick={() => onOpenChange(false)}
                aria-current={current ? 'page' : undefined} aria-label={current ? `Current: ${t.label}` : `Open ${t.label}`}
                className={cn(buttonVariants({ variant: current ? 'secondary' : 'ghost', size: 'sm' }), 'ml-auto shrink-0')}>
                {current ? 'Current' : 'Open'}</NavLink>
            </li>);
        })}
      </ul>
    </Modal>);
}

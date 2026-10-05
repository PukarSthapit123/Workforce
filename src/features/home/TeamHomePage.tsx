import type { ReactNode } from 'react';
import type { NavTab } from '@/domain/nav';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { NavLink, Page, PageHead } from '@/ui';
import { useShellData, ShellLoading, ShellError } from '@/shell/shellData';
import { useApprovalQueue } from '@/api/timesheets';
import { useSicknessBoard, useTeamLeave } from '@/api/leave';
import { useCoverBoard } from '@/api/rota';
import { usePostedNotices } from '@/api/notices';

/* Team Home: the prototype's mgrTeamHome (qnipay-workforce-v15.html:
   10551-10568). It owns no data: one card per My Team page this person can
   reach, each with the count that page's own read returns, and a card with
   nothing waiting says so rather than showing a bare zero. A page with no
   count reads "Open"; a page not built yet says so. The location picker is
   not here: every manager manages one location, the one on their record, and
   the crumb names it where the prototype's lede did. */
export function TeamHomePage() {
  const data = useShellData();
  if (data.kind === 'loading') return <ShellLoading />;
  if (data.kind === 'error') return <ShellError onRetry={data.onRetry} onSignOut={data.onSignOut} />;
  const tabs = data.nav.find(g => g.key === 'team')?.tabs.filter(t => t.view !== 'thome') ?? [];
  return (
    <Page testId={tid.page('thome')}>
      <PageHead title="Team Home" crumb={`My Team · Team Home · ${data.session.account.locationName}`} tipTestId={tid.thome.tip}
        tip="Everything waiting on you. Each card opens the page that owns it, and its count is the one that page shows." />
      <div data-testid={tid.thome.grid} className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-md">
        {tabs.map(t => <TeamCard key={t.view} tab={t} />)}
      </div>
    </Page>);
}

/* Each counted page asks its own read, so only the cards on screen read anything. */
function TeamCard({ tab }: { tab: NavTab }) {
  if (!tab.built) return <Card tab={tab} text="Not built yet" />;
  switch (tab.view) {
    case 'tteam': return <ApprovalsCard tab={tab} />;
    case 'tleave': return <RequestsCard tab={tab} />;
    case 'tsick': return <SicknessCard tab={tab} />;
    case 'tcover': return <CoverCard tab={tab} />;
    case 'tnotices': return <NoticesCard tab={tab} />;
    default: return <Card tab={tab} text="Open" />;
  }
}
const waiting = (n: number | undefined, unit = 'waiting') => (n === undefined ? null : n === 0 ? 'Nothing waiting' : `${n} ${unit}`);
function ApprovalsCard({ tab }: { tab: NavTab }) {
  const c = useApprovalQueue({ status: 'pend' }).data?.counts;
  return <Card tab={tab} text={waiting(c ? c.pend + c.resub : undefined)} has={Boolean(c && c.pend + c.resub)} />;
}
function RequestsCard({ tab }: { tab: NavTab }) {
  const n = useTeamLeave().data?.counts.pending;
  return <Card tab={tab} text={waiting(n)} has={Boolean(n)} />;
}
function SicknessCard({ tab }: { tab: NavTab }) {
  const n = useSicknessBoard().data?.counts.triggered;
  return <Card tab={tab} text={waiting(n)} has={Boolean(n)} />;
}
function CoverCard({ tab }: { tab: NavTab }) {
  const n = useCoverBoard('all').data?.counts.all;
  return <Card tab={tab} text={waiting(n)} has={Boolean(n)} />;
}
/* the notices live now: nothing is waiting on the poster, so the count is not a warning */
function NoticesCard({ tab }: { tab: NavTab }) {
  const n = usePostedNotices('all').data?.counts.current;
  return <Card tab={tab} text={n === undefined ? null : n === 0 ? 'Nothing live' : `${n} live`} />;
}

/* .th-card, .th-t and .th-c (v15:378-389) */
function Card({ tab, text, has }: { tab: NavTab; text: ReactNode; has?: boolean }) {
  return (
    <NavLink testId={tid.thome.card(tab.view)} to={tab.path}
      className="flex min-h-[84px] flex-col items-start gap-[6px] rounded-card border bg-surface-card p-lg text-left transition-colors duration-(--qp-duration-fast) ease-qp hover:border-border-strong hover:bg-surface-tint">
      <span className="text-sm font-semibold text-text-primary">{tab.label}</span>
      <span data-testid={tid.thome.count(tab.view)} className={cn('text-xs text-text-muted', has && 'font-semibold text-warn')}>{text ?? '…'}</span>
    </NavLink>);
}

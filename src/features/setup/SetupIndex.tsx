import type { ReactNode } from 'react';
import { Blocks, Building, Plug, ShieldCheck, Users, LayoutGrid } from 'lucide-react';
import type { NavTab } from '@/domain/nav';
import { tid } from '@/testids';
import { Caution, IconTile, NavLink, Page, PageHead } from '@/ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/shadcn/tooltip';
import { useShellData, ShellLoading, ShellError } from '@/shell/shellData';

interface Section { key: string; label: string; description: string; pages: NavTab[] }

/* The prototype's icon for each section (SETUP_SECTIONS[].ic, v15:3975-3991),
   from the shared icon set. */
const ICON: Record<string, ReactNode> = { org: <Building />, mods: <Blocks />, people: <Users />, gov: <ShieldCheck />, int: <Plug /> };

/* Ported from the prototype's admSetupIndex and SETUP_SECTIONS
   (qnipay-workforce-v15.html:9271-9281, 3975-3991): an administrator has one
   place called setup, sectioned by what it configures, not a single strip of
   a dozen-plus tabs. Each card opens the section's first reachable page; the
   tab strip then shows the rest of that section plus a way back (Shell.tsx's
   stripTabsFor). A card is the prototype's .setupcard (v15:1406-1432): a 34px
   icon tile, the section in 16px/600, the pages it holds named in 12px/600
   brand ink, and their count in a pill top right. What a section configures
   sits behind hover and focus rather than printed under every title. */
export function SetupIndex() {
  const data = useShellData();
  if (data.kind === 'loading') return <ShellLoading />;
  if (data.kind === 'error') return <ShellError onRetry={data.onRetry} onSignOut={data.onSignOut} />;
  const setup = data.nav.find(g => g.key === 'setup');
  /* a module's own setup page is reached through its module, not listed here */
  const pages = setup ? setup.tabs.filter(t => t.view !== 'asetup' && !t.module) : [];
  const sections: Section[] = [];
  pages.forEach(t => {
    if (!t.sectionKey || !t.section) return; // every setup page except asetup itself carries a section
    let s = sections.find(x => x.key === t.sectionKey);
    if (!s) { s = { key: t.sectionKey, label: t.section, description: t.sectionDescription ?? '', pages: [] }; sections.push(s); }
    s.pages.push(t);
  });
  return (
    <Page testId={tid.page('asetup')}>
      <PageHead title="Qnipay setup" tip="Everything that decides how this workforce runs, grouped by what it decides." tipTestId={tid.head.tip('asetup')}
        actions={<Caution testId={tid.head.caution('asetup')} text="Changes here apply immediately, to everyone. There is no draft, no approval and no scheduled release in this build. A setting is live for the whole organisation the moment it is changed, and the change is recorded in the audit log." />} />
      <TooltipProvider delayDuration={400}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-md">
          {sections.map(s => {
            const first = s.pages[0];
            if (!first) return null;
            const descId = tid.setup.cardDescription(s.key);
            const n = s.pages.length;
            /* The description is a sibling of the link, not inside it, so it
               describes the card without becoming part of its name. */
            return (
              <div key={s.key} className="contents">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <NavLink to={first.path} testId={tid.setup.card(s.key)} aria-describedby={descId}
                      className="flex items-start gap-md rounded-card border bg-surface-card p-lg text-left transition-[border-color,box-shadow] duration-(--qp-duration-fast) ease-qp hover:border-brand hover:shadow-sm dark:hover:border-brand-accent">
                      <IconTile>{ICON[s.key] ?? <LayoutGrid />}</IconTile>
                      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <span className="text-base leading-[normal] font-semibold text-text-primary">{s.label}</span>{' '}
                        <span className="mt-xs text-xs leading-[normal] font-semibold text-brand dark:text-brand-accent">{s.pages.map(p => p.label).join(' · ')}</span>
                      </span>{' '}
                      <span className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-pill bg-surface-tint px-xs text-xs font-bold text-text-muted">
                        <span aria-hidden="true">{n}</span><span className="sr-only">{n} page{n === 1 ? '' : 's'}</span></span>
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent>{s.description}</TooltipContent>
                </Tooltip>
                <span id={descId} data-testid={descId} className="sr-only">{s.description}</span>
              </div>);
          })}
        </div>
      </TooltipProvider>
    </Page>);
}

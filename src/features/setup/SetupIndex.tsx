import { Link } from 'react-router';
import type { NavTab } from '@/domain/nav';
import { tid } from '@/testids';
import { useShellData, ShellLoading, ShellError } from '@/shell/shellData';

interface Section { key: string; label: string; pages: NavTab[] }

/* Ported from the prototype's SETUP_SECTIONS (qnipay-workforce-v15.html:3975-3991):
   an administrator has one place called setup, sectioned by what it configures,
   not a single strip of a dozen-plus tabs. Each card opens the section's first
   reachable page; the tab strip then shows the rest of that section plus a way
   back (Shell.tsx's stripTabsFor). */
export function SetupIndex() {
  const data = useShellData();
  if (data.kind === 'loading') return <ShellLoading />;
  if (data.kind === 'error') return <ShellError onRetry={data.onRetry} onSignOut={data.onSignOut} />;
  const setup = data.nav.find(g => g.key === 'setup');
  const pages = setup ? setup.tabs.filter(t => t.view !== 'asetup') : [];
  const sections: Section[] = [];
  pages.forEach(t => {
    if (!t.sectionKey || !t.section) return; // every setup page except asetup itself carries a section
    let s = sections.find(x => x.key === t.sectionKey);
    if (!s) { s = { key: t.sectionKey, label: t.section, pages: [] }; sections.push(s); }
    s.pages.push(t);
  });
  return (
    <section data-testid={tid.page('asetup')} className="flex flex-col gap-lg">
      <div>
        <h1 className="text-[length:var(--qp-text-20)] font-semibold">Qnipay setup</h1>
        <p className="text-text-secondary">Configuration for how this workforce operates.</p>
      </div>
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
        {sections.map(s => {
          const first = s.pages[0];
          if (!first) return null;
          return (
            <Link key={s.key} to={first.path} data-testid={tid.setup.card(s.key)}
              className="rounded-card border border-border bg-surface-card p-lg hover:border-brand">
              <h2 className="font-semibold">{s.label}</h2>
              <p className="text-text-secondary">{s.pages.length} page{s.pages.length === 1 ? '' : 's'}</p>
            </Link>);
        })}
      </div>
    </section>);
}

import type { NavTab } from '@/domain/nav';
import { tid } from '@/testids';

/* Say what is not built. A stub is labelled as a stub. */
export function NotBuilt({ tab }: { tab: NavTab }) {
  return (
    <section data-testid={tid.page(tab.view)} className="mx-auto max-w-xl rounded-card border border-border bg-surface-card p-xl">
      <div data-testid={tid.notBuilt.root}>
        <h1 className="text-[length:var(--qp-text-20)] font-semibold">{tab.label}</h1>
        <p className="text-text-secondary">Not built in this build. It arrives with <b data-testid={tid.notBuilt.subProject}>{tab.subProject}</b>.</p>
      </div>
    </section>);
}

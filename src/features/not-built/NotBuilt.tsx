import type { NavTab } from '@/domain/nav';
import { tid } from '@/testids';
import { Card, Page, PageHead } from '@/ui';

/* Say what is not built. A stub is labelled as a stub, in the same page
   frame and head as every built page. */
export function NotBuilt({ tab }: { tab: NavTab }) {
  return (
    <Page testId={tid.page(tab.view)}>
      <div data-testid={tid.notBuilt.root}>
        <PageHead title={tab.label} crumb={tab.section ? `Qnipay setup · ${tab.label}` : undefined} />
        <Card className="max-w-[520px]">
          <p className="text-text-secondary">Not built in this build. It arrives with <b data-testid={tid.notBuilt.subProject} className="text-text-primary">{tab.subProject}</b>.</p>
        </Card>
      </div>
    </Page>);
}

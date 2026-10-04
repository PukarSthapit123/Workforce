import { everyTab, type NavTab } from '@/domain/nav';
import { tid } from '@/testids';
import { Card, NavLink, Page, PageHead } from '@/ui';

/* A link to a page that does not exist, or to one this person cannot open
   (brief D9; the prototype's applyHash refusals, v15 "Unknown link" and "That
   view is not available to this persona"). Said in the page frame, with a
   way home, never by quietly sending the person somewhere else. */
export function PageUnavailable({ path, home }: { path: string; home: NavTab | undefined }) {
  const known = everyTab().find(t => t.path === path);
  return (
    <Page testId={tid.page('unavailable')} narrow>
      <div data-testid={tid.unavailable.root} data-known={known ? 'true' : 'false'}>
        <PageHead title={known ? 'Page not available' : 'Page not found'} />
        <Card>
          {known
            ? <p className="text-text-secondary"><b className="text-text-primary">{known.label}</b> is not available to you. Your access, or a module or feature that is switched off, keeps it from you. Ask an administrator if you need it.</p>
            : <p className="text-text-secondary">There is no page at <b className="text-text-primary break-all">{path}</b>. The link may be mistyped or out of date.</p>}
          {home && <p className="mt-md"><NavLink to={home.path} testId={tid.unavailable.home} className="font-semibold text-brand underline dark:text-brand-accent">Go to {home.label}</NavLink></p>}
        </Card>
      </div>
    </Page>);
}

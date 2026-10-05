import type { ComponentType } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tid } from '@/testids';
import { GUIDES } from '@/ui';
import { renderPage, withFakeServer } from '@/test/render-page';
import { resetTo, signInAs, type Persona } from '@/test/api-helpers';
import { AdminPeoplePage } from '@/features/people/AdminPeoplePage';
import { TeamPeoplePage } from '@/features/people/TeamPeoplePage';
import { DimensionsPage } from '@/features/dimensions/DimensionsPage';
import { ContractsPage } from '@/features/dimensions/ContractsPage';
import { PermissionsPage } from '@/features/access/PermissionsPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { DocumentsPage } from '@/features/home/DocumentsPage';
import { HomePage } from '@/features/home/HomePage';
import { TeamHomePage } from '@/features/home/TeamHomePage';
import { ModulesPage } from '@/features/modules/ModulesPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { OrganisationPage } from '@/features/organisation/OrganisationPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage';
import { EmployeeTypesPage } from '@/features/employee-types/EmployeeTypesPage';
import { SicknessPage } from '@/features/leave/SicknessPage';

/* Suite GUIDES (S:1210-1243) and GUIDE AFFORDANCE (S:938-963): the
   explanation a page used to print lives behind its `?`, one structured
   guide per page the prototype gives one (GUIDES, v15:9930-10058), and a page
   with no registered guide shows no `?` at all, never a hollow one. */
withFakeServer();
beforeEach(() => resetTo('social'));

type Case = [view: string, persona: Persona, Page: ComponentType, path: string];
const GUIDED: Case[] = [
  ['apeople', 'admin', AdminPeoplePage, '/setup/apeople'],
  ['aloc', 'admin', DimensionsPage, '/setup/aloc'],
  ['acon', 'admin', ContractsPage, '/setup/acon'],
  ['aperm', 'admin', PermissionsPage, '/setup/aperm'],
  ['profile', 'employee', ProfilePage, '/work/profile'],
  ['docs', 'employee', DocumentsPage, '/work/docs'],
];

test.each(GUIDED)('the %s page offers a ? that opens its guide, section by section', async (view, persona, Page, path) => {
  const guide = GUIDES[view];
  if (!guide) throw new Error(`no guide registered for ${view}`);
  await signInAs(persona);
  renderPage(<Page />, path);
  const open = await screen.findByTestId(tid.guide.open(view));
  expect(open.tagName).toBe('BUTTON');
  expect(open).toHaveAccessibleName(guide.label);
  await userEvent.click(open);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByTestId(tid.modal.title)).toHaveTextContent(guide.title);
  expect(guide.sections.length).toBeGreaterThanOrEqual(2);
  for (const [h, b] of guide.sections) {
    expect(within(dialog).getByRole('heading', { name: h })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(b);
  }
  await userEvent.click(within(dialog).getByTestId(tid.guide.close));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('the permissions guide keeps the security caveat, and the guides read as sentences, not dashed asides', () => {
  expect(GUIDES.aperm?.sections.map(([h]) => h)).toContain('UI visibility is not security');
  for (const g of ['apeople', 'aloc', 'acon', 'aperm', 'profile', 'docs']) {
    for (const [h, b] of GUIDES[g]?.sections ?? []) expect(`${h} ${b}`).not.toMatch(/ — | – /);
  }
});

const UNGUIDED: Case[] = [
  ['tpeople', 'manager', TeamPeoplePage, '/team/tpeople'],
  ['home', 'employee', HomePage, '/work/home'],
  ['thome', 'manager', TeamHomePage, '/team/thome'],
  ['tsick', 'manager', SicknessPage, '/team/tsick'],
  ['amods', 'admin', ModulesPage, '/setup/amods'],
  ['acal', 'admin', CalendarPage, '/setup/acal'],
  ['aorg', 'admin', OrganisationPage, '/setup/aorg'],
  ['anotif', 'admin', NotificationsPage, '/setup/anotif'],
  ['aappr', 'admin', ApprovalsPage, '/setup/aappr'],
  ['atypes', 'admin', EmployeeTypesPage, '/setup/atypes'],
];

test.each(UNGUIDED)('the %s page has no guide in the prototype, so it shows no ?', async (view, persona, Page, path) => {
  expect(GUIDES[view]).toBeUndefined();
  await signInAs(persona);
  renderPage(<Page />, path);
  await screen.findByTestId(tid.page(view));
  await waitFor(() => expect(screen.queryByText(/^Loading/)).toBeNull());
  expect(screen.queryAllByTestId(/^guide-open/)).toHaveLength(0);
});

/* Suite GUIDES: "Its explainer banner is gone from the page" (People,
   Dimensions, Contracts, Permissions) and "Its read-only-pay banner is gone"
   (Profile): what the guide explains is not printed on the page as well, and
   the page carries no explainer banner. */
test.each(GUIDED)('the %s page prints none of what its guide explains, and has no explainer banner', async (view, persona, Page, path) => {
  await signInAs(persona);
  renderPage(<Page />, path);
  const page = await screen.findByTestId(tid.page(view));
  await waitFor(() => expect(screen.queryByText(/^Loading/)).toBeNull());
  /* the standing caution keeps its own words, as a note, not a banner */
  const CAUTION = '[data-testid^="head-caution"], [data-testid="access-caution"]';
  const shown = page.cloneNode(true) as HTMLElement;
  shown.querySelectorAll(CAUTION).forEach(n => n.remove());
  const text = shown.textContent ?? '';
  for (const [h, b] of GUIDES[view]?.sections ?? []) {
    expect(text, h).not.toContain(h);
    expect(text, h).not.toContain(b);
  }
  expect(text).not.toMatch(/read-only outputs/);
  expect([...page.querySelectorAll('[role="note"]')].filter(n => !n.matches(CAUTION))).toEqual([]);
});

/* Suite GUIDES: "But its live state pill stayed on the page": Permissions
   keeps saying how far the matrix is from the defaults, and says it again
   once a cell has changed. */
test('Permissions keeps its live state pill on the page: at defaults, then one changed from default', async () => {
  await signInAs('admin');
  renderPage(<PermissionsPage />, '/setup/aperm');
  expect(await screen.findByTestId(tid.accessState.pill)).toHaveTextContent('At defaults');
  await userEvent.click(screen.getByTestId(tid.access.cell('proxy', 'employee')));
  await waitFor(() => expect(screen.getByTestId(tid.accessState.pill)).toHaveTextContent('1 changed from default'));
  expect(screen.getByTestId(tid.accessState.pill)).toHaveAttribute('data-tone', 'warn');
});

/* Suite GUIDES: "State banners stay on the page — simulation is still
   declared". The explainers moved behind ?, but a banner stating what this
   build does not do stays where it applies: Notifications says Email and SMS
   are not connected. */
test('a state banner declaring what is simulated stays on its page', async () => {
  await signInAs('admin');
  renderPage(<NotificationsPage />, '/setup/anotif');
  expect(await screen.findByTestId(tid.anotif.notConnected)).toHaveTextContent('Email and SMS are not connected yet.');
});

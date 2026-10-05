import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { tid } from '@/testids';
import { LIFECYCLE } from '@/domain/lifecycle';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { caller, personOf, resetTo, signInAs } from '@/test/api-helpers';
import { AdminPeoplePage } from './AdminPeoplePage';
import { TeamPeoplePage } from './TeamPeoplePage';

withFakeServer();
beforeEach(() => resetTo('social'));

describe('Qnipay setup · People, as an admin', () => {
  beforeEach(async () => { await signInAs('admin'); });
  test('CR Every row shows a lifecycle state, and the page has full test id coverage', async () => {
    renderPage(<AdminPeoplePage />);
    const rows = within(await screen.findByTestId(tid.people.table)).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.querySelector('[data-tone]')).not.toBeNull();
    expectTestIdCoverage(document.body);
  });
  test('CR An Add control replaces the old stub, and rows offer Edit', async () => {
    renderPage(<AdminPeoplePage />);
    await screen.findByTestId(tid.people.table);
    expect(screen.getByTestId(tid.people.add)).toHaveTextContent('Add person');
    expect(screen.getByTestId(tid.people.edit('CP-1042'))).toHaveTextContent('Edit');
  });
  test('PC People lists who somebody is, not what they are contracted to, and does not repeat the employee type as a job profile', async () => {
    renderPage(<AdminPeoplePage />);
    const headers = within(await screen.findByTestId(tid.people.table)).getAllByRole('columnheader').map(h => h.textContent ?? '');
    expect(headers).not.toContain('Contracted');
    expect(headers).not.toContain('Max');
    expect(headers.filter(h => /type|profile/i.test(h))).toEqual(['Employee type']);
  });
  test('CR A state filter is offered: a leaver drops out of the default list, but is reachable through the state filter', async () => {
    renderPage(<AdminPeoplePage />);
    await screen.findByTestId(tid.people.table);
    expect(screen.queryByTestId(tid.people.row('CP-1288'))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.people.stateFilter));
    await userEvent.click(await screen.findByTestId(`${tid.people.stateFilter}-option-all`));
    expect(await screen.findByTestId(tid.people.row('CP-1288'))).toBeInTheDocument();
  });
  test('PC The contract is reached through the person, and their record carries the contract detail, with full test id coverage', async () => {
    renderPage(<AdminPeoplePage />);
    await userEvent.click(await screen.findByTestId(tid.people.open('CP-1042')));
    expect(await screen.findByTestId(tid.person.fact('contractedHours'))).toHaveTextContent('37.5 h per week');
    expectTestIdCoverage(document.body);
  });
  test('the record shows its field history, newest first', async () => {
    const p = personOf('CP-1042');
    await caller(await signInAs('admin'))('PATCH', `/api/v1/people/${p.id}`, { contractedHours: 30 }, p.version);
    renderPage(<AdminPeoplePage />);
    await userEvent.click(await screen.findByTestId(tid.people.open('CP-1042')));
    const history = await screen.findByTestId(tid.person.history);
    expect(await within(history).findByText('Contracted hours: 37.5 → 30')).toBeInTheDocument();
  });
  test('a failed load says so, and shows no table as current', async () => {
    server.use(http.get('/api/v1/people', () => HttpResponse.json({ code: 'fault', message: 'x', next: 'y' }, { status: 500 })));
    renderPage(<AdminPeoplePage />);
    expect(await screen.findByTestId(tid.people.error)).toHaveTextContent('could not be loaded');
    expect(screen.queryByTestId(tid.people.table)).toBeNull();
  });
});

describe('My team · People, as a manager', () => {
  beforeEach(async () => { await signInAs('manager'); });
  test('the page has full test id coverage and shows only the manager\'s location', async () => {
    renderPage(<TeamPeoplePage />);
    await screen.findByTestId(tid.people.table);
    expect(screen.getByTestId(tid.people.row('CP-1042'))).toBeInTheDocument();
    expect(screen.queryByTestId(tid.people.row('EMP-2044'))).toBeNull();
    expectTestIdCoverage(document.body);
  });
  test('each state pill carries what the state means, reachable from the keyboard and by a screen reader', async () => {
    renderPage(<TeamPeoplePage />);
    const pill = await screen.findByTestId(tid.people.state('CP-1042'));
    expect(pill).toHaveAttribute('tabindex', '0');
    expect(pill).toHaveTextContent(LIFECYCLE.active.note);
  });
});

/* Suite ITEM 4: "A person deep link opens the record" (the prototype's
   #/people/<id>; here ?person=<employee ID>). Closing it drops the link, so
   the record does not open again. */
test('a person deep link opens their record, and closing it drops the link', async () => {
  await signInAs('admin');
  const p = personOf('CP-1042') as { name?: unknown };
  renderPage(<AdminPeoplePage />, '/setup/apeople?person=CP-1042');
  const box = await screen.findByTestId(tid.modal.root);
  await waitFor(() => expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent(String(p.name)));
  expect(await within(box).findByTestId(tid.person.fact('contractedHours'))).toHaveTextContent('37.5 h per week');
  await userEvent.click(within(box).getByTestId(tid.modal.close));
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  await new Promise(r => setTimeout(r, 50));
  expect(screen.queryByTestId(tid.modal.root)).toBeNull();
});

/* Suite REVIEW RUN: "People is a record list" and "... and a leading icon
   column is not treated as the title": on My team · People each row is a
   record whose title is the person's name (their initials sit inside it, not
   in a column of their own), and every other cell but the actions is labelled
   for its phone card. */
test('My team · People is a record list whose title is the name, not the avatar', async () => {
  await signInAs('manager');
  renderPage(<TeamPeoplePage />);
  const table = await screen.findByTestId(tid.people.table);
  expect(table).toHaveAttribute('data-variant', 'records');
  const row = within(table).getAllByRole('row')[1];
  if (!row) throw new Error('no row');
  const cells = [...row.querySelectorAll('td')];
  const title = cells[0];
  expect(title?.getAttribute('data-l')).toBeNull();
  expect(title?.querySelector('strong')?.textContent).toMatch(/^[A-Z][a-z]+ [A-Z]/);
  expect(cells.slice(1, -1).every(c => c.getAttribute('data-l'))).toBe(true);
});

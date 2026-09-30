import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { tid } from '@/testids';
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
});

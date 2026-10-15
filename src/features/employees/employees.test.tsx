import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { tid } from '@/testids';
import { LIFECYCLE } from '@/domain/lifecycle';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { caller, employeeOf, resetTo, signInAs } from '@/test/api-helpers';
import { AdminEmployeesPage } from './AdminEmployeesPage';
import { TeamEmployeesPage } from './TeamEmployeesPage';

withFakeServer();
beforeEach(() => resetTo('social'));

describe('Qnipay setup · Employees, as an admin', () => {
  beforeEach(async () => { await signInAs('admin'); });
  test('CR Every row shows a lifecycle state, and the page has full test id coverage', async () => {
    renderPage(<AdminEmployeesPage />);
    const rows = within(await screen.findByTestId(tid.employees.table)).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.querySelector('[data-tone]')).not.toBeNull();
    expectTestIdCoverage(document.body);
  });
  test('CR An Add control replaces the old stub, and rows offer Edit', async () => {
    renderPage(<AdminEmployeesPage />);
    await screen.findByTestId(tid.employees.table);
    expect(screen.getByTestId(tid.employees.add)).toHaveTextContent('Add employee');
    expect(screen.getByTestId(tid.employees.edit('CP-1042'))).toHaveTextContent('Edit');
  });
  test('PC Employees lists who somebody is, not what they are contracted to, and does not repeat the employee type as a job profile', async () => {
    renderPage(<AdminEmployeesPage />);
    const headers = within(await screen.findByTestId(tid.employees.table)).getAllByRole('columnheader').map(h => h.textContent ?? '');
    expect(headers).not.toContain('Contracted');
    expect(headers).not.toContain('Max');
    expect(headers.filter(h => /type|profile/i.test(h))).toEqual(['Employee type']);
  });
  test('CR A state filter is offered: a leaver drops out of the default list, but is reachable through the state filter', async () => {
    renderPage(<AdminEmployeesPage />);
    await screen.findByTestId(tid.employees.table);
    expect(screen.queryByTestId(tid.employees.row('CP-1288'))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.employees.stateFilter));
    await userEvent.click(await screen.findByTestId(`${tid.employees.stateFilter}-option-all`));
    expect(await screen.findByTestId(tid.employees.row('CP-1288'))).toBeInTheDocument();
  });
  test('PC The contract is reached through the employee, and their record carries the contract detail, with full test id coverage', async () => {
    renderPage(<AdminEmployeesPage />);
    await userEvent.click(await screen.findByTestId(tid.employees.open('CP-1042')));
    expect(await screen.findByTestId(tid.employee.fact('contractedHours'))).toHaveTextContent('37.5 h per week');
    expectTestIdCoverage(document.body);
  });
  test('the record shows its field history, newest first', async () => {
    const p = employeeOf('CP-1042');
    await caller(await signInAs('admin'))('PATCH', `/api/v1/employees/${p.id}`, { contractedHours: 30 }, p.version);
    renderPage(<AdminEmployeesPage />);
    await userEvent.click(await screen.findByTestId(tid.employees.open('CP-1042')));
    const history = await screen.findByTestId(tid.employee.history);
    expect(await within(history).findByText('Contracted hours: 37.5 → 30')).toBeInTheDocument();
  });
  test('a failed load says so, and shows no table as current', async () => {
    server.use(http.get('/api/v1/employees', () => HttpResponse.json({ code: 'fault', message: 'x', next: 'y' }, { status: 500 })));
    renderPage(<AdminEmployeesPage />);
    expect(await screen.findByTestId(tid.employees.error)).toHaveTextContent('could not be loaded');
    expect(screen.queryByTestId(tid.employees.table)).toBeNull();
  });
});

describe('My team · Employees, as a manager', () => {
  beforeEach(async () => { await signInAs('manager'); });
  test('the page has full test id coverage and shows only the manager\'s location', async () => {
    renderPage(<TeamEmployeesPage />);
    await screen.findByTestId(tid.employees.table);
    expect(screen.getByTestId(tid.employees.row('CP-1042'))).toBeInTheDocument();
    expect(screen.queryByTestId(tid.employees.row('EMP-2044'))).toBeNull();
    expectTestIdCoverage(document.body);
  });
  test('each state pill carries what the state means, reachable from the keyboard and by a screen reader', async () => {
    renderPage(<TeamEmployeesPage />);
    const pill = await screen.findByTestId(tid.employees.state('CP-1042'));
    expect(pill).toHaveAttribute('tabindex', '0');
    expect(pill).toHaveTextContent(LIFECYCLE.active.note);
  });
});

/* Suite ITEM 4: "An employee deep link opens the record" (the prototype's
   #/employees/<id>; here ?employee=<employee ID>). Closing it drops the link, so
   the record does not open again. */
test('an employee deep link opens their record, and closing it drops the link', async () => {
  await signInAs('admin');
  const p = employeeOf('CP-1042') as { name?: unknown };
  renderPage(<AdminEmployeesPage />, '/setup/aemployees?employee=CP-1042');
  const box = await screen.findByTestId(tid.modal.root);
  await waitFor(() => expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent(String(p.name)));
  expect(await within(box).findByTestId(tid.employee.fact('contractedHours'))).toHaveTextContent('37.5 h per week');
  await userEvent.click(within(box).getByTestId(tid.modal.close));
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  await new Promise(r => setTimeout(r, 50));
  expect(screen.queryByTestId(tid.modal.root)).toBeNull();
});

/* Suite REVIEW RUN: "Employees is a record list" and "... and a leading icon
   column is not treated as the title": on My team · Employees each row is a
   record whose title is the employee's name (their initials sit inside it, not
   in a column of their own), and every other cell but the actions is labelled
   for its phone card. */
test('My team · Employees is a record list whose title is the name, not the avatar', async () => {
  await signInAs('manager');
  renderPage(<TeamEmployeesPage />);
  const table = await screen.findByTestId(tid.employees.table);
  expect(table).toHaveAttribute('data-variant', 'records');
  const row = within(table).getAllByRole('row')[1];
  if (!row) throw new Error('no row');
  const cells = [...row.querySelectorAll('td')];
  const title = cells[0];
  expect(title?.getAttribute('data-l')).toBeNull();
  expect(title?.querySelector('strong')?.textContent).toMatch(/^[A-Z][a-z]+ [A-Z]/);
  expect(cells.slice(1, -1).every(c => c.getAttribute('data-l'))).toBe(true);
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { NotificationsPage } from './NotificationsPage';

/* Notifications (anotif) on the social seed: every module on, GEOFENCE off,
   FLEXMON on, the matrix at the catalogue's defaults. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const matrix = () => store.coll<{ version: number; events: Record<string, Record<string, string | null>> }>('notifMatrix').notifMatrix;
const open = async () => { renderPage(<NotificationsPage />); await screen.findByTestId(tid.anotif.table); };

test('the matrix groups events by module, marks email and SMS not connected, shows the evidence, with full test id coverage', async () => {
  await open();
  for (const m of ['Timesheet', 'Rota', 'Leave', 'Workforce']) expect(screen.getByTestId(tid.anotif.group(m))).toHaveTextContent(`${m} events`);
  expect(screen.queryByTestId(tid.anotif.row('ts_geo'))).toBeNull();
  expect(screen.getByTestId(tid.anotif.cell('lv_ok', 'employee'))).toHaveValue('In-app + email');
  expect(within(screen.getByTestId(tid.anotif.cell('lv_ok', 'employee'))).getAllByRole('option').map(o => o.textContent))
    .toEqual(['Off', 'In-app', 'Email (not connected)', 'In-app + email (not connected)', 'In-app + email + SMS (not connected)']);
  expect(screen.getByTestId(tid.anotif.never('cfg', 'employee'))).toBeInTheDocument();
  expect(screen.getByTestId(tid.anotif.notConnected)).toHaveTextContent('Only in-app notifications are delivered');
  expect(screen.getByTestId(tid.anotif.evidenceRow('AWR-9-CP1310-0807'))).toHaveTextContent('Ellie Warren');
  expect(screen.getByTestId(tid.anotif.evidenceRow('AWR-9-CP1310-0807'))).toHaveTextContent('07/08/2026 06:00');
  expect(screen.getByTestId(tid.anotif.evidence)).toHaveTextContent('In-app, email not connected.');
  expect(screen.getByTestId(tid.anotif.save)).toBeDisabled();
  expectTestIdCoverage(document.body);
});

test('changes are held until Save, then saved together with one audit row; Cancel puts them back', async () => {
  await open();
  fireEvent.change(screen.getByTestId(tid.anotif.cell('rt_pub', 'manager')), { target: { value: 'Off' } });
  await userEvent.click(screen.getByTestId(tid.anotif.cancel));
  expect(screen.getByTestId(tid.anotif.cell('rt_pub', 'manager'))).toHaveValue('In-app');
  fireEvent.change(screen.getByTestId(tid.anotif.cell('lv_ok', 'employee')), { target: { value: 'Off' } });
  expect(matrix()).toBeUndefined();
  await userEvent.click(screen.getByTestId(tid.anotif.save));
  expect(await screen.findByText('Leave approved for Employee: off.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId(tid.anotif.save)).toBeDisabled());
  expect(screen.getByTestId(tid.anotif.cell('lv_ok', 'employee'))).toHaveValue('Off');
  expect(matrix()?.version).toBe(1);
  expect(matrix()?.events.lv_ok?.employee).toBe('Off');
  expect(audits().filter(a => a.act === 'Notification settings changed')).toHaveLength(1);
});

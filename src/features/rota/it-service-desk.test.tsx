import { screen, within } from '@testing-library/react';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { caller, resetTo, signInAs } from '@/test/api-helpers';
import { ItServiceDeskPage } from './ItServiceDeskPage';

/* The social seed: ITACCESS is on and no access request has been raised yet.
   fil_1 (Ellie Warren, Sat 15 Aug early at Willow House) waits to be
   confirmed; confirming it on the day raises ITR-1007. */
withFakeServer();
beforeEach(() => resetTo('social'));
const open = () => renderPage(<ItServiceDeskPage />, '/setup/iit');

describe('IT service desk', () => {
  test('with nothing raised it shows the banner and says how to raise one', async () => {
    await signInAs('admin');
    open();
    expect(await screen.findByTestId(tid.iit.empty)).toHaveTextContent('No access requests yet. Confirm a filled shift on Cover requests to raise one.');
    const banner = screen.getByTestId(tid.iit.banner);
    expect(banner).toHaveTextContent('Simulated integration');
    expect(banner).toHaveTextContent('does not send it to a service desk');
    expect(banner).toHaveTextContent('Qnipay setup → Modules → Rota → Rota setup');
    expect(screen.getByTestId(tid.head.tip('iit'))).toBeInTheDocument();
  });

  test('a confirmed filled shift is listed with what IT needs, with full test id coverage', async () => {
    store.setClock('2026-08-15T09:00:00.000Z');
    const manager = caller(await signInAs('manager'));
    expect((await manager('POST', '/api/v1/rota/filled/fil_1/confirm', undefined, 1)).status).toBe(200);
    await signInAs('admin');
    const { container } = open();
    const row = await screen.findByTestId(tid.iit.row('ITR-1007'));
    for (const text of ['ITR-1007', 'Ellie Warren', 'CP-1310', 'Willow House', 'Sat 15 Aug', 'Bank', '15/08/2026 10:00'])
      expect(row).toHaveTextContent(text);
    expect(within(row).getByTestId(tid.iit.status('ITR-1007'))).toHaveTextContent('Raised');
    expect(screen.queryByTestId(tid.iit.empty)).not.toBeInTheDocument();
    expectTestIdCoverage(container);
  });
});

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { HOURS_CSV_HEADER } from '@/domain/hours';
import { TeamHoursPage } from './TeamHoursPage';

/* social at the frozen clock (Thursday 13/08/2026): Rachel Hussain manages
   Willow House, whose published week of 10 August has ten colleagues on its
   roster. Amara Okafor is under contracted with two nights; Ellie Warren
   (CP-1310) is bank. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('manager'); });

const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const open = async () => {
  renderPage(<TeamHoursPage />, '/team/thours');
  return screen.findByTestId(tid.thours.table);
};

describe('Hours position', () => {
  test('the tiles, a row per colleague with both variances and the flags, a bank worker, search, with full test id coverage', async () => {
    await open();
    expect(screen.getByTestId(tid.thours.location)).toHaveTextContent('Willow House');
    expect(screen.getByTestId(tid.thours.contracted).parentElement).toHaveTextContent('contracted colleagues');
    expect(screen.getByTestId(tid.thours.discrepancies)).not.toBeEmptyDOMElement();
    const amara = screen.getByTestId(tid.thours.row('CP-1042'));
    expect(amara).toHaveTextContent('Amara Okafor');
    expect(amara).toHaveTextContent('CP-1042 · Contracted');
    expect(screen.getByTestId(tid.thours.rotaVar('CP-1042'))).toHaveTextContent('-4.5h');
    expect(screen.getByTestId(tid.thours.workVar('CP-1042'))).toHaveTextContent('-30h');
    expect(screen.getByTestId(tid.thours.flags('CP-1042'))).toHaveTextContent('Under contracted2 nights');
    /* bank: no contracted figure, no rota variance, the worked hours as the worked variance, and clear */
    const ellie = screen.getByTestId(tid.thours.row('CP-1310'));
    expect(ellie).toHaveTextContent('CP-1310 · Bank');
    expect(screen.getByTestId(tid.thours.rotaVar('CP-1310'))).toHaveTextContent('—');
    expect(screen.getByTestId(tid.thours.workVar('CP-1310'))).toHaveTextContent('0h');
    expect(screen.getByTestId(tid.thours.flags('CP-1310'))).toHaveTextContent('Clear');
    expectTestIdCoverage(document.body);

    await userEvent.type(screen.getByTestId(tid.thours.search), 'ellie');
    expect(screen.queryByTestId(tid.thours.row('CP-1042'))).toBeNull();
    /* the tiles follow the rows on screen */
    expect(screen.getByTestId(tid.thours.contracted)).toHaveTextContent('0h');
    expect(screen.getByTestId(tid.thours.rotad)).toHaveTextContent('7.5h');
    expect(screen.getByTestId(tid.thours.discrepancies)).toHaveTextContent('0');
    await userEvent.type(screen.getByTestId(tid.thours.search), 'zzz');
    expect(screen.getByTestId(tid.thours.empty)).toHaveTextContent('Nothing matches that search');
  });

  test('Export saves a real CSV file, toasts its row count, and is audited once', async () => {
    await open();
    const blobs: Blob[] = [], names: string[] = [];
    const was = URL.createObjectURL, wasRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (b: Blob | MediaSource) => { if (b instanceof Blob) blobs.push(b); return 'blob:hours'; };
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    try {
      await userEvent.click(screen.getByTestId(tid.thours.export));
      await waitFor(() => expect(toasts()).toContain('Exported · 10 rows · qnipay-hours-position-WH-10-08-2026.csv'));
      expect(names).toEqual(['qnipay-hours-position-WH-10-08-2026.csv']);
      const lines = ((await blobs[0]?.text()) ?? '').split('\r\n');
      expect(lines).toHaveLength(11);
      expect(lines[0]).toBe(HOURS_CSV_HEADER.join(','));
      expect(lines[1]).toBe('CP-1042,Amara Okafor,Willow House,Support Worker,37.5,33,7.5,-4.5,-30,Under contracted; 2 nights');
      expect(audits().filter(a => a.act === 'Export')).toHaveLength(1);
    } finally {
      click.mockRestore();
      URL.createObjectURL = was; URL.revokeObjectURL = wasRevoke;
    }
  });

  test('a browser that blocks the file is told so, and nothing claims an export', async () => {
    await open();
    const was = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error('blocked'); };
    try {
      await userEvent.click(screen.getByTestId(tid.thours.export));
      await waitFor(() => expect(toasts(tid.toast.error)).toContain('Download blocked by the browser. No file was produced.'));
      expect(toasts()).not.toContain('Exported');
    } finally { URL.createObjectURL = was; }
  });
});

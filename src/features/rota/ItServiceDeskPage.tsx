import { Clock } from 'lucide-react';
import { tid } from '@/testids';
import { Banner, Empty, Page, PageHead, Pill, Row } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useItRequests } from '@/api/rota';
import { formatDateTime } from '@/lib/format';
import { formatDay } from '@/domain/time';

const LEDE = 'A fulfilled shift raises an access request carrying the details IT needs';
const EMPTY = 'No access requests yet. Confirm a filled shift on Cover requests to raise one.';

/* Ported from the prototype's admIT (qnipay-workforce-v15.html:9689-9703): the
   heading with its lede behind an i-tip (ui-fidelity rule 3), the Simulated
   integration banner (.banner.d, the info surface), then one row per access
   request: Reference and Employee ID in tabular figures (the prototype's
   .mono), the employee in bold, the status a warn pill, Shift and date and
   Raised at 12px muted (.sm). Read only, so nothing here writes. On a
   phone the list is a record list (table.rec), each request a card headed by
   its reference with Raised at its foot, as the prototype's card has it. */
export function ItServiceDeskPage() {
  const list = useItRequests();
  return (
    <Page testId={tid.page('iit')}>
      <PageHead title="IT service desk" crumb="Qnipay setup · IT service desk" tip={LEDE} tipTestId={tid.head.tip('iit')} />

      <Banner testId={tid.iit.banner} tone="info" title="Simulated integration">
        Confirming a filled shift raises a real access request with the details below. This build keeps it here and does not send it to a
        service desk. To stop raising requests, switch off IT access requests in Qnipay setup → Modules → Rota → Rota setup.
      </Banner>

      {list.isPending && <p data-testid={tid.iit.loading} className="text-text-secondary">Loading the access requests&hellip;</p>}

      {list.isError && (
        <p data-testid={tid.iit.error} className="text-err">
          The access requests could not be loaded. Nothing on screen has changed. Reload the page to try again.
        </p>
      )}

      {list.isSuccess && (
        <Table data-testid={tid.iit.table} variant="records">
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Employee ID</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Shift and date</TableHead>
              <TableHead>Worker type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Raised</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.items.length === 0 && <Row testId={tid.iit.empty}><TableCell colSpan={8}><Empty>{EMPTY}</Empty></TableCell></Row>}
            {list.data.items.map(r => (
              <Row key={r.id} testId={tid.iit.row(r.ref)}>
                <TableCell kind="title" className="tabular-nums">{r.ref}</TableCell>
                <TableCell label="Employee" className="font-bold">{r.name}</TableCell>
                <TableCell label="Employee ID" className="tabular-nums">{r.personCode}</TableCell>
                <TableCell label="Location">{r.location}</TableCell>
                <TableCell label="Shift and date" className="text-xs text-text-muted">{r.shift} · {formatDay(r.date)}</TableCell>
                <TableCell label="Worker type">{r.worker}</TableCell>
                <TableCell label="Status"><Pill testId={tid.iit.status(r.ref)} tone="warn" glyph={<Clock />}>{r.status}</Pill></TableCell>
                <TableCell kind="foot" className="text-xs whitespace-nowrap text-text-muted tabular-nums">{formatDateTime(r.raisedAt)}</TableCell>
              </Row>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>);
}

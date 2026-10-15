/* Module 6 group 5: Business Central (ibc). The posting log reads the stored
   integrationAttempts and resolves nothing (P2). The dispatcher is
   timesheets' dispatch(), the only thing that resolves a queued record; the
   screen asks for it after P's delay, as P's timer does, and it writes one
   audit row when it resolved anything. A retry stays the existing endpoint
   (./timesheets). No money (P1). */
import { store } from './store';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { dispatch } from './timesheets';
import { elementMapping } from './pay-codes';
import { postingsThisPeriod } from './payroll';
import { dispatchPostings, getPostingLog, type PostingRow } from '@/contract/integration';
import type { IntegrationAttempt } from '@/contract/timesheets';
import { byNewest, dispatchAuditText, integrationIdOf, postingCounts } from '@/domain/integration';

const rowOf = (a: IntegrationAttempt): PostingRow => ({ ...a, integrationId: integrationIdOf(a.id) });

export const integrationHandlers = [
  serve(getPostingLog, () => {
    const all = Object.values(store.coll<IntegrationAttempt>('integrationAttempts')), mapping = elementMapping();
    return { attempts: [...all].sort(byNewest).map(rowOf), tiles: postingCounts(all, postingsThisPeriod(), mapping), mapping };
  }),

  serve(dispatchPostings, ({ session }) => {
    const resolved = dispatch().sort(byNewest).map(rowOf);
    if (!resolved.length) return { resolved, auditId: null };
    const auditId = writeAudit({ who: actor(session), act: 'Postings dispatched', entity: 'integrationAttempt',
      entityId: resolved.map(a => a.id).join(', '),
      before: { state: 'queued' },
      after: { detail: dispatchAuditText(resolved), resolved: resolved.map(a => ({ id: a.integrationId, ref: a.ref, state: a.state, attempt: a.attempt, ...(a.reason ? { reason: a.reason } : {}) })) } });
    return { resolved, auditId };
  }),
];

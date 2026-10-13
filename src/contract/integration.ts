/* Module 6 group 5: Business Central (ibc), integration, as the prototype's
   SETUP_NEED gates ibc. The posting log is the stored integrationAttempts,
   newest first, each with P's integration id; the tiles are P's four; the
   mapping is every pay code and allowance code with its Business Central
   element, read only here. No money (P1): a summary is a work type and its
   hours. Business Central stays simulated (P2): reading the log resolves
   nothing. The dispatcher, which stands in for the posting worker, is the
   only thing that moves a queued record to posted or failed, and a retry
   (contract/timesheets.ts) only re-queues and counts. */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IntegrationAttempt } from './timesheets';
import { PAY_CODE_BASES } from '@/domain/pay-codes';

export const PostingRow = IntegrationAttempt.extend({ integrationId: z.string() });
export type PostingRow = z.infer<typeof PostingRow>;
/* posted: this pay period's; queued and failed: every record's; mapped: codes with an element, out of codes */
export const PostingTiles = z.object({
  posted: z.number().int().nonnegative(), queued: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  mapped: z.number().int().nonnegative(), codes: z.number().int().nonnegative(),
});
export const ElementMapping = z.object({ code: z.string(), label: z.string(), basis: z.enum(PAY_CODE_BASES), element: z.string(), allowance: z.boolean() });
export type ElementMapping = z.infer<typeof ElementMapping>;
export const PostingLog = z.object({ attempts: z.array(PostingRow), tiles: PostingTiles, mapping: z.array(ElementMapping) });
export type PostingLog = z.infer<typeof PostingLog>;
export const Dispatched = z.object({ resolved: z.array(PostingRow), auditId: z.string().nullable() });
export type Dispatched = z.infer<typeof Dispatched>;

const CAP = 'integration';
export const getPostingLog = defineEndpoint({ method: 'GET', path: '/api/v1/integration/attempts', response: PostingLog, capability: CAP,
  summary: 'The posting log, newest first: each attempt\'s integration id, reference, summary (work type and hours, no amount), state, attempt number and time; the Posted, Queued and Failed counts and how many pay codes have a Business Central element; and each code\'s element, read only. Reading resolves nothing.' });
export const dispatchPostings = defineEndpoint({ method: 'POST', path: '/api/v1/integration/dispatch', response: Dispatched, capability: CAP,
  summary: 'Run the simulated dispatcher, which stands in for the posting worker: every queued attempt resolves to posted (simulated) or, while its cause is unresolved, failed. Returns what it resolved. One audit row when anything resolved, none otherwise.' });

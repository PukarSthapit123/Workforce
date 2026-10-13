/* Module 6 group 5: Business Central. The posting log is read as it is
   stored. A retry (sent with the attempt's version) and the simulated
   dispatcher are writes through useRecordMutation, so a record changes on
   screen only once the server has answered and the log has been read again.
   Each can change Payroll readiness's postings and the approver's posting
   dots, so those are read again too. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { payrollKeys } from './payroll';
import { timesheetKeys } from './timesheets';
import { dispatchPostings, getPostingLog, type Dispatched, type PostingLog, type PostingRow } from '@/contract/integration';
import { retryIntegrationAttempt } from '@/contract/timesheets';

export const integrationKeys = { log: ['integration', 'log'] as const };
export const usePostingLog = () => useQuery({ queryKey: integrationKeys.log, queryFn: () => api(getPostingLog) });

const AFTER = [integrationKeys.log, payrollKeys.readiness, timesheetKeys.all] as const;
export const useRetryPosting = () => useRecordMutation({
  mutationFn: (a: Pick<PostingRow, 'id' | 'version'>) => api(retryIntegrationAttempt, { params: { id: a.id }, ifMatch: a.version }),
  recordKey: a => `posting/${a.id}`, invalidates: AFTER,
});
export const useDispatchPostings = () => useRecordMutation({
  mutationFn: (): Promise<Dispatched> => api(dispatchPostings), recordKey: () => 'posting/dispatch', invalidates: AFTER,
});

export type { Dispatched, PostingLog, PostingRow };

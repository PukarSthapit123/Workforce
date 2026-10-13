/* Module 6 group 4: Payroll readiness. The readiness is the server's
   derivation for the current period; each move on the period's run is its
   own endpoint, sent with the run's version (0 before anyone has acted on
   it) through useRecordMutation. The export's file is built from the rows
   the server returns. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import {
  exportPayroll, getPayrollReadiness, reconcilePayroll, reopenPayroll, type PayrollExported, type PayrollReadiness, type RunMoved,
} from '@/contract/payroll';

export const payrollKeys = { readiness: ['payroll', 'readiness'] as const };
export const usePayrollReadiness = () => useQuery({ queryKey: payrollKeys.readiness, queryFn: () => api(getPayrollReadiness) });

interface RunVars { id: string; ifMatch: number }
const recordKey = (v: RunVars) => `payroll/${v.id}`;
export const useExportPayroll = () => useRecordMutation({
  mutationFn: (v: RunVars): Promise<PayrollExported> => api(exportPayroll, { params: { id: v.id }, ifMatch: v.ifMatch }),
  recordKey, invalidates: [payrollKeys.readiness],
});
export const useReconcilePayroll = () => useRecordMutation({
  mutationFn: (v: RunVars): Promise<RunMoved> => api(reconcilePayroll, { params: { id: v.id }, ifMatch: v.ifMatch }),
  recordKey, invalidates: [payrollKeys.readiness],
});
export const useReopenPayroll = () => useRecordMutation({
  mutationFn: (v: RunVars & { reason: string }): Promise<RunMoved> =>
    api(reopenPayroll, { params: { id: v.id }, ifMatch: v.ifMatch, body: { reason: v.reason } }),
  recordKey, invalidates: [payrollKeys.readiness],
});

export type { PayrollReadiness };

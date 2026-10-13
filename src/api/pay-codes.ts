/* Module 6 group 3: Pay codes (mpay). Each write is sent with the code's
   version through useRecordMutation; nothing changes on screen until the
   server has answered. A code is a rate type option on the timesheet and a
   pick in Timesheet setup's pay rules, so those are read again too. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { timesheetKeys } from './timesheets';
import {
  createPayCode, listPayCodes, removePayCode, updatePayCode,
  type AllowanceCodeRow, type CreatePayCode, type PayCodeList, type PayCodeRow, type UpdatePayCode,
} from '@/contract/pay-codes';

export const payCodeKeys = { all: ['pay-codes'] as const };
export const usePayCodes = () => useQuery({ queryKey: payCodeKeys.all, queryFn: () => api(listPayCodes) });

const AFTER = [payCodeKeys.all, timesheetKeys.all, timesheetKeys.config] as const;
export const useCreatePayCode = () => useRecordMutation({
  mutationFn: (body: CreatePayCode) => api(createPayCode, { body }), recordKey: () => 'pay-code/new', invalidates: AFTER,
});
export const useUpdatePayCode = () => useRecordMutation({
  mutationFn: (v: { row: PayCodeRow; body: UpdatePayCode }) => api(updatePayCode, { params: { id: v.row.id }, body: v.body, ifMatch: v.row.version }),
  recordKey: v => `pay-code/${v.row.id}`, invalidates: AFTER,
});
export const useRemovePayCode = () => useRecordMutation({
  mutationFn: (row: PayCodeRow) => api(removePayCode, { params: { id: row.id }, ifMatch: row.version }),
  recordKey: row => `pay-code/${row.id}`, invalidates: AFTER,
});

export type { AllowanceCodeRow, PayCodeList, PayCodeRow };

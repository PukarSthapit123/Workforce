/* 1c group 5: approval chains and delegations (D8). Writes go through
   useRecordMutation, so the table changes only once the server has answered
   and the chains or delegations have been read again. A chain is saved whole
   with If-Match: the version it was read at. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import {
  createDelegation, getApprovalSetup, listDelegations, listMyDelegations, removeDelegation, saveApprovalChain,
  type ApprovalChain, type ApprovalSetup, type ChainLayer, type ChainModule, type ChainSaved, type CreateDelegation, type Delegation, type DelegationSaved,
  type Delegations, type SignOff,
} from '@/contract/approvals';

export const approvalKeys = { all: ['approvals'] as const, setup: ['approvals', 'chains'] as const, delegations: ['approvals', 'delegations'] as const,
  mine: ['approvals', 'delegations', 'mine'] as const };
export const useApprovalSetup = () => useQuery({ queryKey: approvalKeys.setup, queryFn: () => api(getApprovalSetup) });
export const useDelegations = () => useQuery({ queryKey: approvalKeys.delegations, queryFn: () => api(listDelegations) });
export const useMyDelegations = (enabled = true) => useQuery({ queryKey: approvalKeys.mine, queryFn: () => api(listMyDelegations), enabled });

export function useSaveChain() {
  return useRecordMutation<{ module: ChainModule; steps: ChainLayer[]; ifMatch: number }, ChainSaved>({
    mutationFn: v => api(saveApprovalChain, { params: { module: v.module }, body: { steps: v.steps }, ifMatch: v.ifMatch }),
    recordKey: v => `chain/${v.module}`, invalidates: [approvalKeys.setup],
  });
}
export function useCreateDelegation() {
  return useRecordMutation<CreateDelegation, DelegationSaved>({
    mutationFn: body => api(createDelegation, { body }), recordKey: () => 'delegations/new', invalidates: [approvalKeys.delegations],
  });
}
export function useRemoveDelegation() {
  return useRecordMutation<{ id: string; ifMatch: number }, { auditId: string; message: string }>({
    mutationFn: v => api(removeDelegation, { params: { id: v.id }, ifMatch: v.ifMatch }), recordKey: v => `delegation/${v.id}`, invalidates: [approvalKeys.delegations],
  });
}
export type { ApprovalChain, ApprovalSetup, ChainLayer, ChainModule, ChainSaved, CreateDelegation, Delegation, DelegationSaved, Delegations, SignOff };

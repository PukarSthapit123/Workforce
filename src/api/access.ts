import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import { toastRefusal } from '@/ui';
import {
  listCapabilities, listCapabilityGroups, listUserTypes, listUsers, setTemplateCapability, addException, removeException,
  type Capability, type CapabilityGroup, type UserType, type UserAccess,
} from '@/contract/access';

export const useCapabilities = () => useQuery({ queryKey: ['capabilities'], queryFn: () => api(listCapabilities) });
export const useCapabilityGroups = () => useQuery({ queryKey: ['capability-groups'], queryFn: () => api(listCapabilityGroups) });
export const useUserTypes = () => useQuery({ queryKey: ['user-types'], queryFn: () => api(listUserTypes) });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api(listUsers) });

/* Shared by every write below: the cache is only ever updated from a real
   response (onSuccess), a refusal is always toasted, and a stale-version
   refusal (412) also invalidates so the next attempt uses the fresh record. */
function onErrorToastAndRefetch(qc: ReturnType<typeof useQueryClient>, queryKey: readonly unknown[]) {
  return (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    toastRefusal(error.refusal);
    if (error.status === 412) void qc.invalidateQueries({ queryKey });
  };
}

export function useSetTemplateCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; cap: string; granted: boolean; ifMatch: number }) =>
      api(setTemplateCapability, { params: { id: vars.id, cap: vars.cap }, body: { granted: vars.granted }, ifMatch: vars.ifMatch }),
    onSuccess: data => {
      qc.setQueryData<UserType[]>(['user-types'], old => old?.map(t => (t.id === data.record.id ? data.record : t)));
    },
    onError: onErrorToastAndRefetch(qc, ['user-types']),
  });
}

export function useAddException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; capability: string; mode: 'grant' | 'revoke'; reason: string; ifMatch: number }) =>
      api(addException, { params: { email: vars.email }, body: { capability: vars.capability, mode: vars.mode, reason: vars.reason }, ifMatch: vars.ifMatch }),
    onSuccess: data => {
      qc.setQueryData<UserAccess[]>(['users'], old => old?.map(u => (u.email === data.record.email ? data.record : u)));
    },
    onError: onErrorToastAndRefetch(qc, ['users']),
  });
}

export function useRemoveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; cap: string; ifMatch: number }) =>
      api(removeException, { params: { email: vars.email, cap: vars.cap }, ifMatch: vars.ifMatch }),
    onSuccess: data => {
      qc.setQueryData<UserAccess[]>(['users'], old => old?.map(u => (u.email === data.record.email ? data.record : u)));
    },
    onError: onErrorToastAndRefetch(qc, ['users']),
  });
}

export type { Capability, CapabilityGroup, UserType, UserAccess };

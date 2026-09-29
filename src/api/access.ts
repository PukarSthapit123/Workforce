import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import {
  listCapabilities, listCapabilityGroups, listUserTypes, listUsers, setTemplateCapability, addException, removeException,
  type Capability, type CapabilityGroup, type UserType, type UserAccess,
} from '@/contract/access';

export const useCapabilities = () => useQuery({ queryKey: ['capabilities'], queryFn: () => api(listCapabilities) });
export const useCapabilityGroups = () => useQuery({ queryKey: ['capability-groups'], queryFn: () => api(listCapabilityGroups) });
export const useUserTypes = () => useQuery({ queryKey: ['user-types'], queryFn: () => api(listUserTypes) });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api(listUsers) });

/* Who is making the change, so a write to their own template or their own
   account re-reads the session (their capabilities, and so their nav). */
export interface Self { userType: string; email: string }

/* Pending per template: every cell in a template's column sends the same
   If-Match, so the column waits while one of its cells is saving. */
export function useSetTemplateCapability(self: Self | null) {
  return useRecordMutation({
    mutationFn: (vars: { id: string; cap: string; granted: boolean; ifMatch: number }) =>
      api(setTemplateCapability, { params: { id: vars.id, capability: vars.cap }, body: { granted: vars.granted }, ifMatch: vars.ifMatch }),
    recordKey: vars => vars.id,
    invalidates: [['user-types']],
    refreshesSession: vars => vars.id === self?.userType,
  });
}

/* Adding and removing an exception write the same account record, so they
   share one hook and one pending key per email. */
export type ExceptionWrite =
  | { kind: 'add'; email: string; capability: string; mode: 'grant' | 'revoke'; reason: string; ifMatch: number }
  | { kind: 'remove'; email: string; capability: string; ifMatch: number };
export function useExceptionWrite(self: Self | null) {
  return useRecordMutation({
    mutationFn: (vars: ExceptionWrite) => vars.kind === 'add'
      ? api(addException, { params: { email: vars.email }, body: { capability: vars.capability, mode: vars.mode, reason: vars.reason }, ifMatch: vars.ifMatch })
      : api(removeException, { params: { email: vars.email, capability: vars.capability }, ifMatch: vars.ifMatch }),
    recordKey: vars => vars.email.toLowerCase(),
    invalidates: [['users']],
    refreshesSession: vars => vars.email.toLowerCase() === self?.email.toLowerCase(),
  });
}

export type { Capability, CapabilityGroup, UserType, UserAccess };

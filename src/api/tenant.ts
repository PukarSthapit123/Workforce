/* 1c: the tenant record and its switches. Every module reader (the nav, the
   module setup pages, every feature gate) reads the one ['tenant'] query, so a
   switch re-reads it and every screen follows. Writes go through
   useRecordMutation, so nothing changes on screen until the server has
   answered and the queries below have been read again. Every write sends the
   tenant's version as last read (Tenant.version). */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { rotaKeys } from './rota';
import { timesheetKeys } from './timesheets';
import { leaveKeys } from './leave';
import {
  getTenant, setFlag, setModule, updateTenantSettings,
  type FlagChanged, type ModuleSwitched, type SetFlag, type Tenant, type UpdateTenantSettings,
} from '@/contract/tenant';
import { renameUserType, type UserType } from '@/contract/access';
import type { Mutation } from '@/contract/common';

export const tenantKeys = { all: ['tenant'] as const };
/* The tenant's settings, from the one cached query the shell itself reads. */
export const useTenant = () => useQuery({ queryKey: tenantKeys.all, queryFn: () => api(getTenant) });

/* All three writes change the same record, so they share one pending key. */
const TENANT_KEY = () => 'tenant';
/* A module switch can hide or bring back any module's data: Rota off sets its
   shifts aside, Sites off changes employee types, Leave and Timesheet reads
   refuse while off. Everything those screens read is read again. */
const MODULE_READS = [tenantKeys.all, rotaKeys.all, timesheetKeys.all, timesheetKeys.config, leaveKeys.all, ['employee-types']] as const;

export function useSetModule() {
  return useRecordMutation<{ code: string; on: boolean; ifMatch: number }, ModuleSwitched>({
    mutationFn: vars => api(setModule, { params: { code: vars.code }, body: { on: vars.on }, ifMatch: vars.ifMatch }),
    recordKey: TENANT_KEY,
    invalidates: MODULE_READS,
  });
}
/* A feature switch, its extras, or both. The weekly grid's capture and layout
   are written through to Timesheet setup, so its queries are read again too. */
export function useSetFlag() {
  return useRecordMutation<{ code: string; change: SetFlag; ifMatch: number }, FlagChanged>({
    mutationFn: vars => api(setFlag, { params: { code: vars.code }, body: vars.change, ifMatch: vars.ifMatch }),
    recordKey: TENANT_KEY,
    invalidates: MODULE_READS,
  });
}
/* The rota horizon (written through to Rota setup), the name and company details. */
export function useUpdateTenantSettings() {
  return useRecordMutation<{ change: UpdateTenantSettings; ifMatch: number }, Mutation<Tenant>>({
    mutationFn: vars => api(updateTenantSettings, { body: vars.change, ifMatch: vars.ifMatch }),
    recordKey: TENANT_KEY,
    invalidates: [tenantKeys.all, rotaKeys.all],
  });
}
/* Configurable role names (D11). Renaming your own user type re-reads the
   session, so the role pill and switcher show the new name. */
export function useRenameUserType(self: { userType: string } | null) {
  return useRecordMutation<{ id: string; name: string; ifMatch: number }, Mutation<UserType>>({
    mutationFn: vars => api(renameUserType, { params: { id: vars.id }, body: { name: vars.name }, ifMatch: vars.ifMatch }),
    recordKey: vars => vars.id,
    invalidates: [['user-types'], ['view-as-people']],
    refreshesSession: vars => vars.id === self?.userType,
  });
}

export type { Tenant, ModuleSwitched, FlagChanged, SetFlag, UpdateTenantSettings };

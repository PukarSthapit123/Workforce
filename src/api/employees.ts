import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import {
  createEmployee, getNextCode, getEmployee, listHistory, listEmployees, transitionEmployee, updateEmployee,
  type CreateEmployee, type Employee, type UpdateEmployee,
} from '@/contract/employees';

type StateFilter = 'here' | 'all' | Employee['state'];
export const employeesKeys = {
  all: ['employees'] as const,
  list: (state: string, q: string) => ['employees', 'list', state, q] as const,
  one: (id: string) => ['employees', 'one', id] as const,
  history: (id: string) => ['employees', 'history', id] as const,
  next: ['employees', 'next-code'] as const,
};
/* The previous page of results stays on screen while a new search is read,
   so typing in the search box does not blank the table between keystrokes. */
export const useEmployees = (state: StateFilter, q: string) =>
  useQuery({ queryKey: employeesKeys.list(state, q), queryFn: () => api(listEmployees, { query: { state, q } }), placeholderData: keepPreviousData });
export const useEmployee = (id: string) =>
  useQuery({ queryKey: employeesKeys.one(id), queryFn: () => api(getEmployee, { params: { id } }) });
export const useHistory = (id: string) =>
  useQuery({ queryKey: employeesKeys.history(id), queryFn: () => api(listHistory, { params: { id } }) });
export const useNextCode = (enabled: boolean) =>
  useQuery({ queryKey: employeesKeys.next, queryFn: () => api(getNextCode), enabled, staleTime: 0 });

/* An employee's writes change the in-use counts of the dimensions and types, and
   who is onboarding (a starter has a case, D1). The onboarding key is written
   out rather than imported, since src/api/onboarding.ts imports from here. */
const AFTER_EMPLOYEE = [employeesKeys.all, ['dims'], ['employee-types'], ['onboarding']] as const;

export const useCreateEmployee = () => useRecordMutation({
  mutationFn: (body: CreateEmployee) => api(createEmployee, { body }),
  recordKey: () => 'new-employee',
  invalidates: AFTER_EMPLOYEE,
});
/* Every edit of one employee shares one pending key, so a second save waits
   for the first and always sends the fresh version. */
export const useUpdateEmployee = () => useRecordMutation({
  mutationFn: (v: { employee: Employee; body: UpdateEmployee }) =>
    api(updateEmployee, { params: { id: v.employee.id }, body: v.body, ifMatch: v.employee.version }),
  recordKey: v => v.employee.id,
  invalidates: AFTER_EMPLOYEE,
});
export const useMoveEmployee = () => useRecordMutation({
  mutationFn: (v: { employee: Employee; to: string; reason: string }) =>
    api(transitionEmployee, { params: { id: v.employee.id }, body: { to: v.to, reason: v.reason }, ifMatch: v.employee.version }),
  recordKey: v => v.employee.id,
  invalidates: [employeesKeys.all, ['onboarding']],
});
export type { StateFilter };

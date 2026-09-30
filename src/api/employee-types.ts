import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { peopleKeys } from './people';
import { typesKey } from './reference';
import {
  createEmployeeType, getTypeLibrary, removeEmployeeType, updateEmployeeType,
  type CreateEmployeeType, type EmployeeType, type UpdateEmployeeType,
} from '@/contract/employee-types';

export const useTypeLibrary = () => useQuery({ queryKey: ['employee-types', 'library'], queryFn: () => api(getTypeLibrary), staleTime: Infinity });
/* the people screens show a type by name */
const AFTER = [typesKey, peopleKeys.all] as const;
export const useCreateType = () => useRecordMutation({
  mutationFn: (body: CreateEmployeeType) => api(createEmployeeType, { body }),
  recordKey: () => 'new-type',
  invalidates: AFTER,
});
export const useUpdateType = () => useRecordMutation({
  mutationFn: (v: { type: EmployeeType; body: UpdateEmployeeType }) => api(updateEmployeeType, { params: { id: v.type.id }, body: v.body, ifMatch: v.type.version }),
  recordKey: v => v.type.id,
  invalidates: AFTER,
});
export const useRemoveType = () => useRecordMutation({
  mutationFn: (t: EmployeeType) => api(removeEmployeeType, { params: { id: t.id }, ifMatch: t.version }),
  recordKey: t => t.id,
  invalidates: AFTER,
});

import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { listViewAsEmployees, type ViewAsEmployee } from '@/contract/session';

/* Fetched only while the account menu is open for someone who may view as
   others, so an employee's menu never asks for it. */
export const useViewAsEmployees = (enabled: boolean) =>
  useQuery({ queryKey: ['view-as-employees'], queryFn: () => api(listViewAsEmployees), enabled });

export type { ViewAsEmployee };

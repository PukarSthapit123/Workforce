import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { listViewAsPeople, type ViewAsPerson } from '@/contract/session';

/* Fetched only while the account menu is open for someone who may view as
   others, so an employee's menu never asks for it. */
export const useViewAsPeople = (enabled: boolean) =>
  useQuery({ queryKey: ['view-as-people'], queryFn: () => api(listViewAsPeople), enabled });

export type { ViewAsPerson };

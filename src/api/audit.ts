import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { listAudit, type AuditEntry } from '@/contract/audit';

export function useAudit(filters: { entity?: string; who?: string; q?: string }) {
  return useQuery({
    queryKey: ['audit', filters.entity, filters.who, filters.q],
    queryFn: () => api(listAudit, { query: { entity: filters.entity, who: filters.who, q: filters.q } }),
  });
}

export type { AuditEntry };

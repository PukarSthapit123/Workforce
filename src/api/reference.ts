/* Reference data every people screen shows by name: the dimensions and the employee types. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { DIMENSIONS, type DimensionKind, type DimensionRow } from '@/contract/dimensions';
import { listEmployeeTypes } from '@/contract/employee-types';
import { listSupportLevels } from '@/contract/rota';

export type InUseRow = DimensionRow & { inUse: number };
export const dimensionKey = (kind: DimensionKind) => ['dims', kind] as const;
export const typesKey = ['employee-types'] as const;
export const useDimension = (kind: DimensionKind) =>
  useQuery({ queryKey: dimensionKey(kind), queryFn: async (): Promise<InUseRow[]> => (await api(DIMENSIONS[kind].api.list)) as InUseRow[] });
export const useEmployeeTypes = () => useQuery({ queryKey: typesKey, queryFn: () => api(listEmployeeTypes) });

/* Each lookup turns a code into its display name, the code itself when it
   is not (or not yet) known, and a dash when there is none. */
export function useNames() {
  const loc = useDimension('locations'), dep = useDimension('departments'), job = useDimension('job-profiles'), types = useEmployeeTypes();
  const by = (rows: readonly { code: string; name: string }[] | undefined) =>
    (code: string) => (code ? rows?.find(r => r.code === code)?.name ?? code : '—');
  return { location: by(loc.data), department: by(dep.data), job: by(job.data), type: by(types.data) };
}
/* The support levels a location can carry, with the people per shift Rota setup gives each (under the rota keys, so a Rota setup save reads them again). */
export const useSupportLevels = () => useQuery({ queryKey: ['rota', 'support-levels'] as const, queryFn: async () => (await api(listSupportLevels)).items });

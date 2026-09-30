import { api } from './client';
import { useRecordMutation } from './mutation';
import { peopleKeys } from './people';
import type { InUseRow } from './reference';
import { DIMENSIONS, type DimensionKind, type DimensionRow } from '@/contract/dimensions';

/* The five kinds share one shape of API (contract/dimensions.ts's crud), so
   the bodies are the kind's own and serve() checks them on the way in. */
type Body = Record<string, unknown>;
type Saved = { record: DimensionRow; auditId: string | null; changed?: string[] };
/* A dimension's writes change what the people screens show by name. */
const AFTER = [['dims'], peopleKeys.all] as const;

export const useCreateDimension = (kind: DimensionKind) => useRecordMutation({
  mutationFn: async (body: Body): Promise<Saved> => (await api(DIMENSIONS[kind].api.create, { body: body as never })) as Saved,
  recordKey: () => `new-${kind}`,
  invalidates: AFTER,
});
export const useUpdateDimension = (kind: DimensionKind) => useRecordMutation({
  mutationFn: async (v: { row: InUseRow; body: Body }): Promise<Saved> =>
    (await api(DIMENSIONS[kind].api.update, { params: { id: v.row.id }, body: v.body as never, ifMatch: v.row.version })) as Saved,
  recordKey: v => v.row.id,
  invalidates: AFTER,
});
export const useRemoveDimension = (kind: DimensionKind) => useRecordMutation({
  mutationFn: (row: InUseRow) => api(DIMENSIONS[kind].api.remove, { params: { id: row.id }, ifMatch: row.version }),
  recordKey: row => row.id,
  invalidates: AFTER,
});

import { z } from 'zod';

export const IsoDateTime = z.iso.datetime();
export const RecordMeta = z.object({ id: z.string(), version: z.number().int().nonnegative(), updatedAt: IsoDateTime });
export type RecordMeta = z.infer<typeof RecordMeta>;

export const Refusal = z.object({
  code: z.string(), message: z.string(), next: z.string(), field: z.string().optional(),
  usedBy: z.array(z.object({ kind: z.string(), count: z.number().int(), examples: z.array(z.string()) })).optional(),
});
export type Refusal = z.infer<typeof Refusal>;

/* auditId is null when the write changed nothing (a no-op, such as granting
   what is already granted), so no audit row was written. */
export const mutation = <T extends z.ZodType>(record: T) => z.object({ record, auditId: z.string().nullable() });
export type Mutation<T> = { record: T; auditId: string | null };

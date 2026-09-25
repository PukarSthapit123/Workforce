import { z } from 'zod';
export const Refusal = z.object({
  code: z.string(), message: z.string(), next: z.string(), field: z.string().optional(),
  usedBy: z.array(z.object({ kind: z.string(), count: z.number().int(), examples: z.array(z.string()) })).optional(),
});
export type Refusal = z.infer<typeof Refusal>;

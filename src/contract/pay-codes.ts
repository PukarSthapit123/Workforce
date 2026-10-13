/* Module 6 group 3: Pay codes (mpay), the prototype's admPayCodes and
   payCodeBox (qnipay-workforce-v15.html:9554-9633). A base code is created,
   edited and removed here; an allowance code is listed read only, as it is
   kept with the allowances in Timesheet setup.
   No money (brief P1): a value is a multiplier (1, 1.5, 2) or a unit count,
   never an amount or a rate, and no field carries a currency. A flat code
   has no value here (the amount is set in Business Central), and a units
   code posts as a marker with no value. Reads need mod_cfg and writes
   master_data, as the prototype gates the page (SETUP_NEED mpay) and pc-save
   and pc-del. Writes are versioned with one audit row each (module 8 D1); a
   code in use is not removed, and the refusal names what uses it (D2). */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta } from './common';
import { PAY_CODE_BASES, PAY_VALUE, isValued } from '@/domain/pay-codes';

export const PayCodeBasis = z.enum(PAY_CODE_BASES);
/* A multiplier or a unit count, or blank for a basis that posts no value. A
   currency symbol, a negative or anything that is not a plain number is refused. */
export const PayCodeValue = z.string().max(5).refine(v => v === '' || PAY_VALUE.test(v),
  'A value is a multiplier such as 1.5 or a count such as 1. Money is set in Business Central, not here.');
const FIELDS = {
  code: z.string(), label: z.string(), basis: PayCodeBasis, value: PayCodeValue, element: z.string(), workType: z.boolean(),
};
/* A multiplier, hours or days code has its value; a flat or units code has none. */
const consistent = (r: { basis: string; value: string }, ctx: z.core.$RefinementCtx) => {
  if (isValued(r.basis) !== (r.value !== '')) ctx.addIssue({ code: 'custom', path: ['value'], message: `A ${r.basis} code ${isValued(r.basis) ? 'needs' : 'has no'} value.` });
};
export const PayCodeShape = z.object(FIELDS).superRefine(consistent);
export const PayCodeRecord = RecordMeta.extend(FIELDS).superRefine(consistent);
export type PayCodeRecord = z.infer<typeof PayCodeRecord>;

const UsedByRow = z.object({ kind: z.string(), count: z.number().int().nonnegative(), examples: z.array(z.string()) });
const Claimant = z.object({ code: z.string(), name: z.string() });
export const PayCodeRow = RecordMeta.extend({
  ...FIELDS,
  /* the employee types that claim it (P's Claimed by) */
  claimedBy: z.array(Claimant),
  /* everything that uses it; empty when it can be removed */
  usedBy: z.array(UsedByRow),
}).superRefine(consistent);
export type PayCodeRow = z.infer<typeof PayCodeRow>;
/* An allowance code, read only here: it is kept with the allowances in Timesheet setup. Flat, with no value. */
export const AllowanceCodeRow = z.object({ code: z.string(), label: z.string(), element: z.string(), claimedBy: z.array(Claimant) });
export type AllowanceCodeRow = z.infer<typeof AllowanceCodeRow>;
export const PayCodeList = z.object({ codes: z.array(PayCodeRow), allowances: z.array(AllowanceCodeRow) });
export type PayCodeList = z.infer<typeof PayCodeList>;

/* Strict, so a body sent with an amount, a rate or a currency is refused rather than stored. */
export const CreatePayCode = z.strictObject({
  code: z.string().max(40), label: z.string().max(80), basis: PayCodeBasis, value: PayCodeValue, element: z.string().max(40), workType: z.boolean(),
});
export type CreatePayCode = z.infer<typeof CreatePayCode>;
/* The code may be sent unchanged; a different code is refused, as it cannot change once it exists. */
export const UpdatePayCode = CreatePayCode.partial();
export type UpdatePayCode = z.infer<typeof UpdatePayCode>;

const IdParams = z.object({ id: z.string().min(1).max(40) });
export const listPayCodes = defineEndpoint({ method: 'GET', path: '/api/v1/pay-codes', response: PayCodeList, capability: 'mod_cfg',
  summary: 'Every base pay code with who claims it and what uses it, then the allowance codes (read only here). No money: a value is a multiplier or a unit count.' });
export const createPayCode = defineEndpoint({ method: 'POST', path: '/api/v1/pay-codes', request: CreatePayCode,
  response: z.object({ record: PayCodeRecord, auditId: z.string() }), capability: 'master_data',
  summary: 'Create a pay code. The code is unique (Business Central matches on it) and one element maps to one code; a multiplier, hours or days code needs its value. One audit row with the basis and element.' });
export const updatePayCode = defineEndpoint({ method: 'PATCH', path: '/api/v1/pay-codes/:id', params: IdParams, request: UpdatePayCode,
  response: z.object({ record: PayCodeRecord, auditId: z.string().nullable(), changed: z.array(z.string()) }), capability: 'master_data', versioned: true, errors: [404],
  summary: 'Edit a pay code (If-Match). The code cannot change. Says which fields changed; one audit row with the diff, none when nothing changed.' });
export const removePayCode = defineEndpoint({ method: 'DELETE', path: '/api/v1/pay-codes/:id', params: IdParams,
  response: z.object({ auditId: z.string() }), capability: 'master_data', versioned: true, errors: [404, 409],
  summary: 'Remove a pay code (If-Match). 409 with usedBy while an employee type, a capture field or a timesheet day uses it. One audit row.' });

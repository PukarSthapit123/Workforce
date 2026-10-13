/* Module 6 group 3: pay codes (mpay). Ported from the prototype's pc-save and
   pc-del handlers and payCodeUsage (qnipay-workforce-v15.html:12858-12913,
   3103-3116). A code is what Business Central matches on, so it is unique
   and never changes once it exists; one code maps to one pay element.
   No money (brief P1): a code's value is a multiplier or a unit count, a flat
   code has no value here (the amount is set in Business Central), and a units
   code posts as a marker with no value. */
import type { Problem } from './codes';
import type { UsedBy } from './usage';

export const PAY_CODE_BASES = ['multiplier', 'flat', 'hours', 'days', 'units'] as const;
export type PayCodeBasis = (typeof PAY_CODE_BASES)[number];
/* The bases whose value is posted; the others carry none. */
export const VALUED: readonly PayCodeBasis[] = ['multiplier', 'hours', 'days'];
export const isValued = (b: string) => (VALUED as readonly string[]).includes(b);

/* P's code pattern: a letter, then 1 to 11 capitals, digits, dashes or underscores. */
export const PAY_CODE = /^[A-Z][A-Z0-9_-]{1,11}$/;
export const PAY_ELEMENT = /^[A-Z0-9][A-Z0-9_.-]{0,19}$/;
/* A multiplier (1, 1.5, 2) or a unit count (1, 0.5): up to two digits each side of the point. */
export const PAY_VALUE = /^\d{1,2}(\.\d{1,2})?$/;
export const normalisePayCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '-');
export const normaliseElement = (s: string) => s.trim().toUpperCase();

export interface PayCodeInput { code: string; label: string; basis: string; value: string; element: string; workType: boolean }
export interface PayCodeWorld {
  /* every base code as stored, and every allowance code, which a new code may not reuse either */
  codes: readonly PayCodeInput[]; allowances: readonly string[];
}

const BASIS_NAME: Record<PayCodeBasis, string> = {
  multiplier: 'multiplier on base rate', flat: 'flat amount per occurrence', hours: 'number of hours at base rate', days: 'number of day units', units: 'units code',
};

/* The checks in P's order: the code, the name and the element must be there,
   then identity (P: "being told the code already exists is more use than
   being told to fill in one more field"), then the element clash, then the
   value. `editing` is the stored code an edit is to; a new code has none. */
export function payCodeProblem(input: PayCodeInput, w: PayCodeWorld, editing?: string): Problem | null {
  const code = editing ?? normalisePayCode(input.code), element = normaliseElement(input.element), value = input.value.trim();
  if (!code) return { field: 'code', message: 'A code is required.' };
  if (!editing && !PAY_CODE.test(code))
    return { field: 'code', message: 'A code is 2 to 12 characters: a letter first, then letters, digits, dashes or underscores, like OT-BH.' };
  if (!input.label.trim()) return { field: 'label', message: 'A name is required. The code alone is not readable.' };
  if (!element) return { field: 'element', message: 'A Business Central pay element is required. One code maps to one element.' };
  if (!PAY_ELEMENT.test(element)) return { field: 'element', message: 'A pay element is letters, digits, a dash, a dot or an underscore, with no spaces.' };
  if (!editing && (w.codes.some(c => c.code.toUpperCase() === code) || w.allowances.some(a => a.toUpperCase() === code)))
    return { field: 'code', message: `${code} already exists. Codes must be unique because Business Central matches on them.` };
  const clash = w.codes.find(c => c.element.toUpperCase() === element && c.code !== code);
  if (clash) return { field: 'element', message: `${element} is already mapped to ${clash.code}. One element, one code.` };
  const basis = input.basis as PayCodeBasis;
  if (isValued(basis)) {
    if (!value) return { field: 'value', message: `A value is required for a ${BASIS_NAME[basis]}.` };
    if (!PAY_VALUE.test(value) || Number(value) <= 0)
      return { field: 'value', message: 'A value is a multiplier such as 1.5 or a count such as 1, above 0.' };
  } else if (value) {
    return { field: 'value', message: basis === 'flat'
      ? 'A flat code has no value here. The amount is set in Business Central.'
      : 'A units code posts as a marker, so it has no value.' };
  }
  return null;
}

/* The stored form of a valid input: the code and element in capitals, the name trimmed. */
export const payCodeOf = <T extends PayCodeInput>(input: T): T => ({
  ...input, code: normalisePayCode(input.code), label: input.label.trim(), value: input.value.trim(), element: normaliseElement(input.element),
});

export const EDITABLE = ['label', 'basis', 'value', 'element', 'workType'] as const;
/* Which fields an edit changes, in P's order. */
export const payCodeChanges = (before: PayCodeInput, after: PayCodeInput) => EDITABLE.filter(k => String(before[k]) !== String(after[k]));

/* ------------------------------------------------------------------ usage */
export interface UsageType { code: string; name: string; uom: string; allowances: readonly string[]; ruleCodes: readonly string[] }
export interface PayUsageWorld {
  types: readonly UsageType[];
  /* the capture field catalogue's labels and the pay code each posts */
  fields: readonly { label: string; pay?: string }[];
  /* the work type of every timesheet day */
  dayWorkTypes: readonly string[];
}

/* P's Claimed by: the employee types whose allowances or automatic rules name
   the code. Standard time and the day rate are claimed by every type paid by
   the hour or by the day. */
export function claimedBy(code: string, w: PayUsageWorld): UsageType[] {
  if (code === 'STD' || code === 'DAY_RATE') return w.types.filter(t => t.uom === (code === 'STD' ? 'hour' : 'day'));
  return w.types.filter(t => t.allowances.includes(code) || t.ruleCodes.includes(code));
}

/* What uses a code, so it cannot be removed from under it (D2): the employee
   types that claim it, the capture fields that post it, and the timesheet
   days recorded at it. */
export function payCodeUsage(code: string, w: PayUsageWorld): UsedBy[] {
  const out: UsedBy[] = [];
  const types = claimedBy(code, w);
  if (types.length) out.push({ kind: 'employee-types', count: types.length, examples: types.slice(0, 3).map(t => t.name) });
  const fields = w.fields.filter(f => f.pay === code);
  if (fields.length) out.push({ kind: 'fields', count: fields.length, examples: fields.slice(0, 3).map(f => f.label) });
  const days = w.dayWorkTypes.filter(x => x === code).length;
  if (days) out.push({ kind: 'timesheet-days', count: days, examples: [] });
  return out;
}

const NOUN: Record<string, [string, string]> = {
  'employee-types': ['employee type', 'employee types'], fields: ['capture field', 'capture fields'], 'timesheet-days': ['timesheet day', 'timesheet days'],
};
export const usagePhrase = (u: readonly UsedBy[]) => u.map(x => {
  const [one, many] = NOUN[x.kind] ?? [x.kind, x.kind];
  return `${x.count} ${x.count === 1 ? one : many}`;
}).join(', ').replace(/, ([^,]*)$/, ' and $1');

export function payCodeInUse(code: string, usedBy: readonly UsedBy[]): { message: string; next: string } {
  return {
    message: `${code} is used by ${usagePhrase(usedBy)}.`,
    next: 'Remove those references first. A rule pointing at a code that no longer exists would post nothing.',
  };
}

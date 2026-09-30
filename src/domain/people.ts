/* Rules for the one workforce record. Ported from the prototype's `emp-save`
   handler, in its order, so the first failing rule is the one reported. */
import { employeeCodeProblem, type Problem } from './codes';

export interface PersonDraft {
  code: string; name: string; email: string; contractedHours: number; maxHours: number;
  location: string; employeeType: string; department: string; jobProfile: string;
}
export interface PersonContext {
  people: readonly { code: string; name: string; email: string }[];
  locations: readonly string[]; departments: readonly string[]; jobProfiles: readonly string[]; employeeTypes: readonly string[];
}
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailProblem(raw: string, selfCode: string | null, ctx: PersonContext): Problem | null {
  const email = raw.trim().toLowerCase();
  if (!email) return { field: 'email', message: 'A work email address is required. It is how they sign in.' };
  if (!EMAIL.test(email)) return { field: 'email', message: 'That does not look like an email address.' };
  const clash = ctx.people.find(p => p.code !== selfCode && p.email.toLowerCase() === email);
  if (clash) return { field: 'email', message: `${email} is already used by ${clash.name}. One address, one account.` };
  return null;
}
function hoursProblem(con: number, max: number): Problem | null {
  if (!Number.isFinite(con) || con < 0 || con > 80) return { field: 'contractedHours', message: 'Contracted hours must be between 0 and 80.' };
  if (!Number.isFinite(max) || max < 0 || max > 80) return { field: 'maxHours', message: 'Maximum hours must be between 0 and 80.' };
  /* a zero maximum means none is set, as in the prototype's `if(max&&con>max)` */
  if (max > 0 && con > max) return { field: 'contractedHours', message: 'Contracted hours cannot exceed the maximum.' };
  return null;
}
const REFS = [
  ['location', 'locations', 'location'], ['employeeType', 'employeeTypes', 'employee type'],
  ['department', 'departments', 'department'], ['jobProfile', 'jobProfiles', 'job profile'],
] as const;
function refsProblem(d: Partial<PersonDraft>, ctx: PersonContext): Problem | null {
  for (const [field, list, noun] of REFS) {
    const v = d[field];
    if (v && !ctx[list].includes(v)) return { field, message: `There is no ${noun} with the code ${v}.` };
  }
  return null;
}

export function newPersonProblem(d: PersonDraft, ctx: PersonContext): Problem | null {
  if (!d.name.trim()) return { field: 'name', message: 'A full name is required.' };
  const example = ctx.people.find(p => /^[A-Z]/.test(p.code))?.code ?? 'EMP001';
  return employeeCodeProblem(d.code, ctx.people.map(p => p.code), example)
    ?? emailProblem(d.email, null, ctx)
    ?? hoursProblem(d.contractedHours, d.maxHours)
    ?? (d.location ? null : { field: 'location', message: 'A location is required.' })
    ?? (d.employeeType ? null : { field: 'employeeType', message: 'An employee type is required.' })
    ?? refsProblem(d, ctx);
}

/* On edit only what the patch touches is checked, and the email rules run only
   when the email actually changes: records exported from Business Central carry
   blank and shared addresses, and editing their hours must still work. */
export function personEditProblem(before: PersonDraft, patch: Partial<Omit<PersonDraft, 'code'>>, ctx: PersonContext): Problem | null {
  if (patch.name !== undefined && !patch.name.trim()) return { field: 'name', message: 'A full name is required.' };
  if (patch.email !== undefined && patch.email.trim().toLowerCase() !== before.email.toLowerCase()) {
    const p = emailProblem(patch.email, before.code, ctx);
    if (p) return p;
  }
  const hours = hoursProblem(patch.contractedHours ?? before.contractedHours, patch.maxHours ?? before.maxHours);
  if (hours) return hours;
  if (patch.location !== undefined && !patch.location) return { field: 'location', message: 'A location is required.' };
  if (patch.employeeType !== undefined && !patch.employeeType) return { field: 'employeeType', message: 'An employee type is required.' };
  return refsProblem(patch, ctx);
}

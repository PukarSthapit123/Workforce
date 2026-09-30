/* Codes are identity (CLAUDE.md): unique on create, immutable after, because
   Business Central and payroll map on them. Compared case-insensitively. */
export interface Problem { field: string; message: string }

export const EMPLOYEE_CODE = /^[A-Z][A-Z0-9_-]{1,15}$/;
export const DIMENSION_CODE = /^[A-Z0-9][A-Z0-9_.-]{0,19}$/;
export const TYPE_CODE = /^[a-z][a-z0-9_]{1,31}$/;
export const normaliseCode = (s: string) => s.trim().toUpperCase();
const taken = (code: string, existing: readonly string[]) => existing.some(e => e.toUpperCase() === code.toUpperCase());

/* Port of the prototype's nextEmpId: the next ID follows the scheme of the highest
   number already in use (its prefix upper-cased, as every employee ID is),
   so a roster numbered EMP001 carries on from its own top. */
export function nextEmployeeCode(codes: readonly string[]): string {
  const pat = /^([A-Za-z-]*?)(\d+)$/;
  let prefix = 'EMP', width = 3, top = 0;
  for (const c of codes) {
    const m = pat.exec(c);
    if (!m) continue;
    const n = Number(m[2]);
    if (n > top) { top = n; prefix = (m[1] ?? '').toUpperCase(); width = (m[2] ?? '').length; }
  }
  const make = (n: number) => prefix + String(n).padStart(width, '0');
  let n = top + 1;
  while (taken(make(n), codes)) n++;
  return make(n);
}

export function employeeCodeProblem(code: string, existing: readonly string[], example: string): Problem | null {
  const c = normaliseCode(code);
  if (!EMPLOYEE_CODE.test(c)) return { field: 'code', message: `An employee ID is letters, digits, a dash or an underscore, like ${example}.` };
  if (taken(c, existing)) return { field: 'code', message: `${c} is already in use. Employee IDs must be unique because payroll maps on them.` };
  return null;
}

export function dimensionCodeProblem(code: string, existing: readonly string[]): Problem | null {
  const c = normaliseCode(code);
  if (!c) return { field: 'code', message: 'Code is required.' };
  if (!DIMENSION_CODE.test(c)) return { field: 'code', message: 'A code is letters, digits, a dash, a dot or an underscore, with no spaces.' };
  if (taken(c, existing)) return { field: 'code', message: `${c} already exists. Codes must be unique because rota lines and timesheets reference them.` };
  return null;
}

export function typeCodeProblem(code: string, existing: readonly string[]): Problem | null {
  const c = code.trim();
  if (!TYPE_CODE.test(c)) return { field: 'code', message: 'A type code is lower-case letters, digits and underscores, like waking_night.' };
  if (existing.includes(c)) return { field: 'code', message: `${c} already exists. People reference a type by its code.` };
  return null;
}

/* A patch that carries a different code is refused, whatever else it changes. */
export function codeChangeProblem(field: string, label: string, before: string, patch: Record<string, unknown>): Problem | null {
  if (!(field in patch)) return null;
  const v = patch[field];
  if (typeof v === 'string' && v.trim().toUpperCase() === before.toUpperCase()) return null;
  return { field, message: `${label} cannot change once it exists. Existing records reference it.` };
}

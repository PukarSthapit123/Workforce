/* Nothing in use can be deleted, and the refusal names what uses it (CLAUDE.md).
   Ported from the `used` functions in the prototype's DIMS table, plus the
   projects at a location, which the prototype did not count. A project has no
   users until timesheet lines arrive in sub-project 2. */
export type UsageKind = 'locations' | 'departments' | 'cost-centres' | 'job-profiles' | 'projects' | 'employee-types';
export interface UsedBy { kind: string; count: number; examples: string[] }
interface P { code: string; name: string; location: string; department: string; jobProfile: string; employeeType: string }
interface L { code: string; name: string; department: string; costCentre: string }
interface J { code: string; name: string; costCentre: string; location: string }
export interface UsageWorld { people: readonly P[]; locations: readonly L[]; projects: readonly J[] }

function group(kind: string, hits: readonly { code: string; name: string }[]): UsedBy[] {
  return hits.length ? [{ kind, count: hits.length, examples: hits.slice(0, 3).map(h => `${h.name} (${h.code})`) }] : [];
}

export function usageOf(kind: UsageKind, code: string, w: UsageWorld): UsedBy[] {
  switch (kind) {
    case 'locations': return [...group('people', w.people.filter(p => p.location === code)), ...group('projects', w.projects.filter(p => p.location === code))];
    case 'departments': return [...group('locations', w.locations.filter(l => l.department === code)), ...group('people', w.people.filter(p => p.department === code))];
    case 'cost-centres': return [...group('locations', w.locations.filter(l => l.costCentre === code)), ...group('projects', w.projects.filter(p => p.costCentre === code))];
    case 'job-profiles': return group('people', w.people.filter(p => p.jobProfile === code));
    case 'employee-types': return group('people', w.people.filter(p => p.employeeType === code));
    case 'projects': return [];
  }
}
export const totalUses = (u: readonly UsedBy[]) => u.reduce((n, x) => n + x.count, 0);

const NOUN: Record<string, [string, string]> = { people: ['person', 'people'], locations: ['location', 'locations'], projects: ['project', 'projects'] };
const phrase = (u: UsedBy) => { const [one, many] = NOUN[u.kind] ?? [u.kind, u.kind]; return `${u.count} ${u.count === 1 ? one : many}`; };

export function inUseRefusal(code: string, usedBy: readonly UsedBy[]): { message: string; next: string } {
  return {
    message: `${code} is used by ${usedBy.map(phrase).join(' and ')}.`,
    next: 'Move those first. Removing it would leave them pointing at nothing.',
  };
}

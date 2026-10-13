import type { LeaveConfigRecord, LeaveTypeRecord } from '@/contract/leave';
import type { Refusal } from '@/contract/common';
import { typeLeaveFor, type TypeLeave } from '@/domain/leave';
import { personByCode } from './world';
import { store } from './store';

interface RequestUse { id: string; personCode: string; type: string }
interface LedgerUse { id: string; personCode: string; type: string; leaveType?: string }
interface EmployeeTypeUse { code: string; name: string }
interface EpisodeUse { personCode: string; reason: string }

const personLabel = (code: string) => {
  const person = personByCode(code);
  return person ? `${person.name} (${person.code})` : code;
};
const examples = (labels: readonly string[]) => [...new Set(labels)].slice(0, 3);

/* Module 8 group 3 (D2): a leave type or policy is known by its code, which is
   given when it is added and never changes. So a code the save no longer holds
   was removed, and a code it newly holds was added; nothing in between is a
   rename. A removal is refused while anything still uses it, naming what
   (usedBy). typeLeave is the merged per-employee-type policy after the save,
   and an employee type with no entry uses the default policy. A sickness
   reason is known by its words: one the save no longer holds is refused
   while recorded sickness uses it (review M1). */
export function leaveConfigChangeProblem(current: LeaveConfigRecord, types: readonly LeaveTypeRecord[], policies: LeaveConfigRecord['policies'],
  typeLeave: Readonly<Record<string, TypeLeave>>, sicknessReasons: readonly string[] = current.sicknessReasons): Refusal | null {
  const nextTypes = new Set(types.map(type => type.code));
  const requestRows = Object.values(store.coll<RequestUse>('leaveRequests'));
  const ledgerRows = Object.values(store.coll<LedgerUse>('leaveLedger'));
  for (const [i, old] of current.types.entries()) {
    if (nextTypes.has(old.code)) continue;
    const requests = requestRows.filter(row => row.type === old.code);
    const ledger = ledgerRows.filter(row => row.leaveType === old.code || row.type === old.code);
    const usedBy = [
      ...(requests.length ? [{ kind: 'leave requests', count: requests.length, examples: examples(requests.map(row => personLabel(row.personCode))) }] : []),
      ...(ledger.length ? [{ kind: 'leave ledger', count: ledger.length, examples: examples(ledger.map(row => personLabel(row.personCode))) }] : []),
    ];
    if (usedBy.length) return { code: 'in-use', field: `types.${i}`,
      message: `${old.name} is still in use by leave requests or ledger entries.`,
      next: 'Keep this leave type, or switch it off so nobody can choose it.', usedBy };
  }

  const nextPolicies = new Set(policies.map(policy => policy.code));
  const employeeTypes = Object.values(store.coll<EmployeeTypeUse>('employeeTypes'));
  for (const [i, old] of current.policies.entries()) {
    if (nextPolicies.has(old.code)) continue;
    const leaveTypes = types.filter(type => type.policy === old.code);
    const staffTypes = employeeTypes.filter(type => typeLeaveFor(typeLeave, type.code).policy === old.code);
    const usedBy = [
      ...(leaveTypes.length ? [{ kind: 'leave types', count: leaveTypes.length, examples: examples(leaveTypes.map(type => `${type.name} (${type.code})`)) }] : []),
      ...(staffTypes.length ? [{ kind: 'employee types', count: staffTypes.length, examples: examples(staffTypes.map(type => `${type.name} (${type.code})`)) }] : []),
    ];
    if (usedBy.length) return { code: 'in-use', field: `policies.${i}`, message: `${old.name} is still used by leave types or employee types.`,
      next: 'Move them to another policy before removing this one.', usedBy };
  }
  const episodes = Object.values(store.coll<EpisodeUse>('sickEpisodes'));
  for (const [i, old] of current.sicknessReasons.entries()) {
    if (sicknessReasons.includes(old)) continue;
    const using = episodes.filter(e => e.reason === old);
    if (using.length) return { code: 'in-use', field: `sicknessReasons.${i}`, message: `${old} is still the reason on recorded sickness.`,
      next: 'Keep this reason. Sickness already recorded with it needs it.',
      usedBy: [{ kind: 'sickness records', count: using.length, examples: examples(using.map(e => personLabel(e.personCode))) }] };
  }
  return null;
}

/* Module 6 group 3: Pay codes (mpay). The base codes are the `payCodes`
   collection; the allowance codes are the timesheet config's allowances,
   listed read only. Every write is versioned with one audit row (module 8
   D1), and a code in use is not removed (D2). No money (P1). */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { invalid } from './people';
import { recordAt } from './world';
import { FIELDS } from './timesheets';
import { createPayCode, listPayCodes, removePayCode, updatePayCode, type PayCodeRecord } from '@/contract/pay-codes';
import type { TimesheetConfig } from '@/contract/timesheets';
import type { ElementMapping } from '@/contract/integration';
import {
  claimedBy, normalisePayCode, payCodeChanges, payCodeInUse, payCodeOf, payCodeProblem, payCodeUsage, type PayUsageWorld,
} from '@/domain/pay-codes';
import { payElement } from '@/domain/timesheet';

interface StoredType { code: string; name: string; uom: string }
const codes = () => store.coll<PayCodeRecord>('payCodes');
function config(): TimesheetConfig {
  const c = recordAt(store.coll<TimesheetConfig>('timesheetConfig'), 'timesheetConfig');
  if (!c) throw new Error('the store has no timesheet config');
  return c;
}
const fieldsOf = (r: PayCodeRecord) =>
  ({ code: r.code, label: r.label, basis: r.basis, value: r.value, element: r.element, workType: r.workType });
const world = () => ({ codes: Object.values(codes()).map(fieldsOf), allowances: Object.keys(config().allowances) });
function usageWorld(): PayUsageWorld {
  const types = config().types;
  return {
    types: Object.values(store.coll<StoredType>('employeeTypes')).map(t => {
      const cap = recordAt(types, t.code);
      return { code: t.code, name: t.name, uom: t.uom, allowances: cap?.allowances ?? [], ruleCodes: (cap?.rules ?? []).map(r => r.code) };
    }),
    fields: FIELDS,
    dayWorkTypes: Object.values(store.coll<{ workType: string }>('timesheetDays')).map(d => d.workType),
  };
}
const claimants = (code: string, w: PayUsageWorld) => claimedBy(code, w).map(t => ({ code: t.code, name: t.name }));
const byId = (id: string) => recordAt(codes(), id)
  ?? refuse(404, { code: 'not-found', message: 'That pay code no longer exists.', next: 'Reload the page.' });

/* Every base code, then every allowance code, with its Business Central element (Business Central's mapping card). */
export function elementMapping(): ElementMapping[] {
  const c = config(), stored = Object.values(codes()).map(fieldsOf);
  return [...stored.map(r => ({ code: r.code, label: r.label, basis: r.basis, element: r.element, allowance: false })),
    ...Object.values(c.allowances).map(a => ({ code: a.code, label: a.label, basis: 'flat' as const, element: payElement(stored, c.allowances, a.code), allowance: true }))];
}

export const payCodeHandlers = [
  serve(listPayCodes, () => {
    const w = usageWorld(), c = config();
    const base = Object.values(codes()).map(r => ({ ...r, claimedBy: claimants(r.code, w), usedBy: payCodeUsage(r.code, w) }));
    const stored = base.map(fieldsOf);
    const allowances = Object.values(c.allowances).map(a => ({
      code: a.code, label: a.label, element: payElement(stored, c.allowances, a.code), claimedBy: claimants(a.code, w),
    }));
    return { codes: base, allowances };
  }),

  serve(createPayCode, ({ session, body }) => {
    const problem = payCodeProblem(body, world());
    if (problem) return invalid(problem);
    const v = payCodeOf(body);
    const rec: PayCodeRecord = { id: `pc_${v.code}`, version: 1, updatedAt: store.now(), ...v };
    codes()[rec.id] = rec;
    const auditId = writeAudit({ who: actor(session), act: 'Pay code created', entity: 'payCode', entityId: v.code, before: null, after: { ...v } });
    return { record: rec, auditId };
  }),

  serve(updatePayCode, ({ session, params, body, checkVersion }) => {
    const r = byId(params.id);
    checkVersion(r);
    /* the code may be sent unchanged; a different one is refused */
    if (body.code !== undefined && normalisePayCode(body.code) !== r.code)
      return invalid({ field: 'code', message: 'The code cannot change once it exists. Postings already reference it.' });
    const before = fieldsOf(r), next = { ...before, ...body, code: r.code };
    const problem = payCodeProblem(next, world(), r.code);
    if (problem) return invalid(problem);
    const after = payCodeOf(next);
    const changed = payCodeChanges(before, after);
    if (!changed.length) return { record: r, auditId: null, changed: [] };
    const saved = bump(r, { label: after.label, basis: after.basis, value: after.value, element: after.element, workType: after.workType });
    codes()[r.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Pay code edited', entity: 'payCode', entityId: r.code,
      before: Object.fromEntries(changed.map(k => [k, before[k]])), after: Object.fromEntries(changed.map(k => [k, after[k]])) });
    return { record: saved, auditId, changed: [...changed] };
  }),

  serve(removePayCode, ({ session, params, checkVersion }) => {
    const r = byId(params.id);
    checkVersion(r);
    const usedBy = payCodeUsage(r.code, usageWorld());
    if (usedBy.length) return refuse(409, { code: 'in-use', ...payCodeInUse(r.code, usedBy), usedBy });
    Reflect.deleteProperty(codes(), r.id);
    const auditId = writeAudit({ who: actor(session), act: 'Pay code removed', entity: 'payCode', entityId: r.code, before: fieldsOf(r), after: null });
    return { auditId };
  }),
];

import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { invalid } from './people';
import { recordAt, usageWorld } from './world';
import meta from './seed/meta.json';
import {
  listEmployeeTypes, getTypeLibrary, createEmployeeType, updateEmployeeType, removeEmployeeType,
  type EmployeeType, type TypeLibrary,
} from '@/contract/employee-types';
import { typeCodeProblem } from '@/domain/codes';
import { inUseRefusal, totalUses, usageOf } from '@/domain/usage';
import { diffFields } from '@/domain/history';

const types = () => store.coll<EmployeeType>('employeeTypes');
const byId = (id: string) => recordAt(types(), id) ?? refuse(404, { code: 'not-found', message: 'That employee type no longer exists.', next: 'Reload the page.' });
const FIELDS = ['name', 'category', 'mode', 'uom', 'capabilities'] as const;
const body = (t: EmployeeType) => ({ code: t.code, name: t.name, category: t.category, mode: t.mode, uom: t.uom, capabilities: t.capabilities });
/* serve() checks the response against the contract, so the seed's JSON types need not match exactly */
const LIBRARY = { archetypes: meta.typeArchetypes, capabilities: meta.typeCapabilities } as TypeLibrary;

export const employeeTypeHandlers = [
  /* before /employee-types/:id, so MSW matches it first */
  serve(getTypeLibrary, () => LIBRARY),
  serve(listEmployeeTypes, () => {
    const w = usageWorld();
    return Object.values(types()).sort((a, b) => a.name.localeCompare(b.name))
      .map(t => ({ ...t, inUse: totalUses(usageOf('employee-types', t.code, w)) }));
  }),
  serve(createEmployeeType, ({ session, body: { startedFrom, ...b } }) => {
    const code = b.code.trim();
    const problem = (b.name.trim() ? null : { field: 'name', message: 'A name is required.' })
      ?? typeCodeProblem(code, Object.values(types()).map(t => t.code));
    if (problem) return invalid(problem);
    const rec: EmployeeType = { ...b, code, name: b.name.trim(), id: `typ_${code}`, version: 1, updatedAt: store.now() };
    types()[rec.id] = rec;
    const auditId = writeAudit({ who: actor(session), act: 'Employee type created', entity: 'employeeType', entityId: code, before: null,
      after: { ...body(rec), startedFrom } });
    return { record: rec, auditId };
  }),
  serve(updateEmployeeType, ({ session, params, body: patch, checkVersion }) => {
    const t = byId(params.id);
    checkVersion(t);
    if (patch.name !== undefined) {
      if (!patch.name.trim()) return invalid({ field: 'name', message: 'A name is required.' });
      patch.name = patch.name.trim();
    }
    const changes = diffFields(t, { ...t, ...patch }, FIELDS);
    if (!changes.length) return { record: t, auditId: null, changed: [] };
    const saved = bump(t, patch);
    types()[t.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Employee type edited', entity: 'employeeType', entityId: t.code,
      before: Object.fromEntries(changes.map(c => [c.field, c.from])), after: Object.fromEntries(changes.map(c => [c.field, c.to])) });
    return { record: saved, auditId, changed: changes.map(c => c.field) };
  }),
  serve(removeEmployeeType, ({ session, params, checkVersion }) => {
    const t = byId(params.id);
    checkVersion(t);
    /* D12: people are never moved to another type behind anyone's back */
    const usedBy = usageOf('employee-types', t.code, usageWorld());
    if (usedBy.length) return refuse(409, { code: 'in-use', ...inUseRefusal(t.code, usedBy), usedBy });
    if (Object.keys(types()).length < 2)
      return refuse(409, { code: 'last-type', message: 'A tenant needs at least one employee type.', next: 'Create another type before removing this one.' });
    Reflect.deleteProperty(types(), t.id);
    const auditId = writeAudit({ who: actor(session), act: 'Employee type removed', entity: 'employeeType', entityId: t.code, before: body(t), after: null });
    return { auditId };
  }),
];

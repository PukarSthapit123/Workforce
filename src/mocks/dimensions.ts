import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { invalid } from './people';
import { codesOf, recordAt, usageWorld } from './world';
import { DIMENSIONS, type DimensionKind, type DimensionRow } from '@/contract/dimensions';
import { codeChangeProblem, dimensionCodeProblem, normaliseCode, type Problem } from '@/domain/codes';
import { inUseRefusal, totalUses, usageOf } from '@/domain/usage';
import { diffFields } from '@/domain/history';

interface Spec {
  kind: DimensionKind; collection: string; prefix: string; label: string; singular: string; entity: string;
  refs: readonly (readonly [field: string, collection: string, noun: string])[];
}
const SPECS: Spec[] = [
  { kind: 'locations', collection: 'locations', prefix: 'loc', label: 'Location', singular: 'location', entity: 'location',
    refs: [['department', 'departments', 'department'], ['costCentre', 'costCentres', 'cost centre']] },
  { kind: 'departments', collection: 'departments', prefix: 'dep', label: 'Department', singular: 'department', entity: 'department', refs: [] },
  { kind: 'cost-centres', collection: 'costCentres', prefix: 'cc', label: 'Cost centre', singular: 'cost centre', entity: 'costCentre', refs: [] },
  { kind: 'job-profiles', collection: 'jobProfiles', prefix: 'job', label: 'Job profile', singular: 'job profile', entity: 'jobProfile', refs: [] },
  { kind: 'projects', collection: 'projects', prefix: 'prj', label: 'Project', singular: 'project', entity: 'project',
    refs: [['costCentre', 'costCentres', 'cost centre'], ['location', 'locations', 'location']] },
];
const strip = (r: DimensionRow) => Object.fromEntries(Object.entries(r).filter(([k]) => !['id', 'version', 'updatedAt'].includes(k)));

/* One handler set serves all five kinds. The endpoints differ only in their
   record shape, which serve() checks against each kind's own contract, so the
   handler reads every kind through the narrowest one (cost centres: code and
   name) and treats the rest of a body as plain fields. */
type Api = (typeof DIMENSIONS)['cost-centres']['api'];

function handlersFor(spec: Spec) {
  const api = DIMENSIONS[spec.kind].api as unknown as Api;
  const coll = () => store.coll<DimensionRow>(spec.collection);
  const fields = Object.keys(DIMENSIONS[spec.kind].api.create.request.shape).filter(k => k !== 'code');
  const byId = (id: string) => recordAt(coll(), id) ?? refuse(404, { code: 'not-found', message: `That ${spec.singular} no longer exists.`, next: 'Reload the page.' });
  const refsProblem = (d: Record<string, unknown>): Problem | null => {
    for (const [field, c, noun] of spec.refs) {
      const v = d[field];
      if (typeof v === 'string' && v && !codesOf(c).includes(v)) return { field, message: `There is no ${noun} with the code ${v}.` };
    }
    return null;
  };
  const nameProblem = (name: unknown): Problem | null =>
    typeof name === 'string' && !name.trim() ? { field: 'name', message: `${spec.label} name is required.` } : null;
  return [
    serve(api.list, () => {
      const w = usageWorld();
      return Object.values(coll()).sort((a, b) => a.code.localeCompare(b.code))
        .map(r => ({ ...r, inUse: totalUses(usageOf(spec.kind, r.code, w)) }));
    }),
    serve(api.create, ({ session, body }) => {
      const b: Record<string, unknown> = body;
      const code = normaliseCode(body.code);
      const problem = dimensionCodeProblem(code, codesOf(spec.collection)) ?? nameProblem(body.name) ?? refsProblem(b);
      if (problem) return invalid(problem);
      const rec: DimensionRow = { ...b, code, name: body.name.trim(), id: `${spec.prefix}_${code}`, version: 1, updatedAt: store.now() };
      coll()[rec.id] = rec;
      const auditId = writeAudit({ who: actor(session), act: `${spec.label} created`, entity: spec.entity, entityId: code, before: null, after: strip(rec) });
      return { record: rec, auditId };
    }),
    serve(api.update, ({ session, params, body, checkVersion }) => {
      const r = byId(params.id);
      checkVersion(r);
      const codeProblem = codeChangeProblem('code', 'The code', r.code, body);
      if (codeProblem) return invalid(codeProblem);
      /* an unchanged code passed the check above; it is not a field to write */
      const { code: _same, ...patch } = body as Record<string, unknown>;
      void _same;
      if (typeof patch.name === 'string') patch.name = patch.name.trim();
      const problem = nameProblem(patch.name) ?? refsProblem(patch);
      if (problem) return invalid(problem);
      const changes = diffFields(r, { ...r, ...patch }, fields);
      if (!changes.length) return { record: r, auditId: null, changed: [] };
      const saved = bump(r, patch as Partial<DimensionRow>);
      coll()[r.id] = saved;
      const auditId = writeAudit({ who: actor(session), act: `${spec.label} edited`, entity: spec.entity, entityId: r.code,
        before: Object.fromEntries(changes.map(c => [c.field, r[c.field]])), after: Object.fromEntries(changes.map(c => [c.field, saved[c.field]])) });
      return { record: saved, auditId, changed: changes.map(c => c.field) };
    }),
    serve(api.remove, ({ session, params, checkVersion }) => {
      const r = byId(params.id);
      checkVersion(r);
      const usedBy = usageOf(spec.kind, r.code, usageWorld());
      if (usedBy.length) return refuse(409, { code: 'in-use', ...inUseRefusal(r.code, usedBy), usedBy });
      Reflect.deleteProperty(coll(), r.id);
      const auditId = writeAudit({ who: actor(session), act: `${spec.label} removed`, entity: spec.entity, entityId: r.code, before: strip(r), after: null });
      return { auditId };
    }),
  ];
}
export const dimensionHandlers = SPECS.flatMap(handlersFor);

import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, requireCapability } from './auth';
import { writeAudit } from './audit';
import { invalid } from './people';
import { effectiveCode, inScope, people, personByCode, personView, recordAt, writeHistory, type Signed, type StoredPerson } from './world';
import { getProfile, proposeChanges, listProfileChanges, decideProfileChange, type ProfileChange } from '@/contract/profile';
import {
  SELF_FIELDS, STAGE_CAPABILITY, afterDecision, maskBank, routeFor, selfField, type SelfFieldKey, type Stage,
} from '@/domain/selfService';

type StoredChange = Omit<ProfileChange, 'personName'>;
const changes = () => store.coll<StoredChange>('profileChanges');
const masked = (field: SelfFieldKey, v: string) => (field === 'bankAccount' ? maskBank(v) : v);
const view = (c: StoredChange): ProfileChange => ({ ...c, personName: personByCode(c.personCode)?.name ?? c.personCode,
  from: masked(c.field, c.from), to: masked(c.field, c.to) });
const selfEditOn = () => Boolean(store.coll<{ flags: Record<string, unknown> }>('tenant').tenant?.flags.SELF_EDIT);
function mine(s: Signed) {
  return personByCode(effectiveCode(s)) ?? refuse(404, { code: 'not-found', message: 'Your account has no person record.', next: 'Ask an administrator to link your account.' });
}
const valueOf = (p: StoredPerson, field: SelfFieldKey): string => p[field];
/* A counter one past the highest stored (the seed's own ids are pfc_9001 and
   pfc_9002), so ids stay unique across a reload and across tabs. */
function nextChangeId(): string {
  let max = 0;
  for (const id of Object.keys(changes())) max = Math.max(max, Number(/^pfc_(\d+)$/.exec(id)?.[1] ?? 0));
  return `pfc_${String(max + 1)}`;
}

export const profileHandlers = [
  serve(getProfile, ({ session }) => {
    const me = mine(session);
    const pending = Object.values(changes()).filter(c => c.personCode === me.code && c.status === 'pending').map(view);
    return { person: personView(me), fields: [...SELF_FIELDS], pending, selfEdit: selfEditOn() };
  }),
  serve(proposeChanges, ({ session, body: { changes: asked, note } }) => {
    if (!selfEditOn()) return refuse(409, { code: 'feature-off', message: 'Self-service profile changes are switched off for this organisation.',
      next: 'Ask an administrator to switch them on under Modules and features.' });
    const me = mine(session);
    const wanted = new Map<SelfFieldKey, string>();
    for (const c of asked) {
      const to = c.to.trim(), current = valueOf(me, c.field);
      /* the form shows the masked bank number, so sending it back unchanged is not a change */
      if (to === current || to === masked(c.field, current)) continue;
      wanted.set(c.field, to);
    }
    for (const field of wanted.keys()) {
      if (Object.values(changes()).some(c => c.personCode === me.code && c.field === field && c.status === 'pending'))
        return refuse(409, { code: 'pending', message: `A change to ${selfField(field).label} is already awaiting approval.`,
          next: 'Wait for a decision on it, or ask your manager to decline it first.' });
    }
    if (!wanted.size) return refuse(422, { code: 'unchanged', field: 'changes', message: 'Nothing has changed.', next: 'Change a value before sending it for approval.' });
    const records = [...wanted].map(([field, to]) => {
      const id = nextChangeId();
      const rec: StoredChange = { id, version: 1, updatedAt: store.now(), personCode: me.code, field, from: valueOf(me, field), to, note: note.trim(),
        raisedAt: store.now(), status: 'pending', stage: 'manager', route: routeFor(field), decisions: [] };
      changes()[id] = rec;
      return rec;
    });
    const auditId = writeAudit({ who: actor(session), act: 'Profile change requested', entity: 'person', entityId: me.code, before: null,
      after: { fields: records.map(r => selfField(r.field).label), ...(note.trim() ? { note: note.trim() } : {}) } });
    return { records: records.map(view), auditId };
  }),
  serve(listProfileChanges, ({ session }) => {
    const mgr = session.caps.includes('profile_appr'), pay = session.caps.includes('bank_verify');
    if (!mgr && !pay) requireCapability(session, 'profile_appr');
    const self = effectiveCode(session);
    return Object.values(changes()).filter(c => c.status === 'pending' && (
      (mgr && c.stage === 'manager' && c.personCode !== self && inScope(session, personByCode(c.personCode)?.location ?? '')) ||
      (pay && c.stage === 'payroll' && c.personCode !== self)))
      .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))
      .map(view);
  }),
  serve(decideProfileChange, ({ session, params, body: { decision, reason }, checkVersion }) => {
    const c = recordAt(changes(), params.id) ?? refuse(404, { code: 'not-found', message: 'That change no longer exists.', next: 'Reload the page.' });
    if (c.status !== 'pending' || c.stage === 'done')
      return refuse(409, { code: 'decided', message: 'This change has already been decided.', next: 'Reload the page to see its outcome.' });
    const stage: Stage = c.stage;
    requireCapability(session, STAGE_CAPABILITY[stage]);
    const person = personByCode(c.personCode) ?? refuse(404, { code: 'not-found', message: 'That person record no longer exists.', next: 'Decline the change.' });
    if (stage === 'manager' && !inScope(session, person.location))
      return refuse(403, { code: 'scope', message: 'This person is outside the people you look after.', next: 'Their own manager decides it.' });
    if (c.personCode === effectiveCode(session))
      return refuse(409, { code: 'own-change', message: 'You cannot decide a change to your own details.', next: 'Another approver decides it.' });
    checkVersion(c);
    const why = reason.trim();
    if (decision === 'decline' && !why) return invalid({ field: 'reason', message: 'Give a reason. The person is told why their change did not happen.' });
    const out = afterDecision(c, decision);
    const label = selfField(c.field).label;
    if (out.status === 'approved' && valueOf(person, c.field) !== c.from)
      return refuse(409, { code: 'changed-since', message: `${label} was changed on the record after this was proposed.`,
        next: 'Decline this change and ask for a new proposal.' });
    const who = actor(session);
    const saved = bump(c, { ...out, decisions: [...c.decisions, { stage, decision, by: { personCode: who.personCode, name: who.name }, at: store.now(), ...(why ? { reason: why } : {}) }] });
    changes()[c.id] = saved;
    let updated: StoredPerson | null = null;
    if (out.status === 'approved') {
      const patch: Partial<StoredPerson> = { [c.field]: c.to };
      updated = bump(person, patch);
      people()[person.id] = updated;
      writeHistory(person.code, who, 'profile-change', [{ field: c.field, from: masked(c.field, c.from), to: masked(c.field, c.to) }]);
    }
    const act = out.status === 'approved' ? 'Profile change approved' : out.status === 'declined' ? 'Profile change declined' : 'Profile change passed to payroll';
    const auditId = writeAudit({ who, act, entity: 'profileChange', entityId: c.id,
      before: { status: c.status, stage: c.stage, field: label }, after: { status: out.status, stage: out.stage }, ...(why ? { reason: why } : {}) });
    return { record: view(saved), person: updated ? personView(updated) : null, auditId };
  }),
];

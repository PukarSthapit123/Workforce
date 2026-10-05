import { server } from './node';
import { store } from './store';
import { Acknowledged, MyNotices, NoticeDeleted, NoticeSaved, NoticeTrack, PostedNotices, ScopeKind } from '@/contract/notices';
import { Refusal } from '@/contract/common';
import { SCOPE_KINDS } from '@/domain/notices';
import { audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';
import type { StoredNotice } from './notices';
import type { StoredNotification } from './notify';

/* The social seed: Amara Okafor (the first employee) and Rachel Hussain (the
   manager) work at Willow House (WH); Dee Fitzgerald (the admin) at Floating
   Support. NTC-0001 is for everyone, pinned, at v2; NTC-0002 is Willow
   House's urgent fire drill, acknowledged by two; NTC-0003 has expired;
   NTC-0004 is Willow House's draft. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const own = () => audits().filter(a => a.act !== 'Signed in');
const WRITES = ['notices', 'notifications', 'audit'];
const ntc = (id: string) => store.coll<StoredNotice>('notices')[id];
const told = () => Object.values(store.coll<StoredNotification>('notifications')).filter(n => n.event === 'notice_posted');
const WH = { kind: 'loc', code: 'WH', loc: 'WH' } as const;
const ALL = { kind: 'all', code: '', loc: '' } as const;
const NEW = { title: 'Hand hygiene audit next week', body: 'Every sink will be checked on Tuesday.', scope: WH, from: '', until: '', mustAck: true, pinned: false, urgent: false, post: true };
const activeAt = (loc: string) => Object.values(store.coll<{ code: string; location: string; state: string }>('people')).filter(p => p.state === 'active' && p.location === loc);
const boardOff = () => { (store.coll<{ flags: Record<string, unknown> }>('tenant').tenant ?? { flags: {} }).flags.NOTICES = false; };

test('the contract\'s scope kinds are the domain\'s', () => expect(ScopeKind.options).toEqual([...SCOPE_KINDS]));

describe('reading (own_notices)', () => {
  test('a colleague sees current and expired notices aimed at them, urgent first, with where they stand', async () => {
    const r = MyNotices.parse((await (await as('employee'))('GET', '/api/v1/notices/mine')).body);
    expect(r.items.map(n => [n.id, n.status, n.you])).toEqual([['NTC-0002', 'current', 'owed'], ['NTC-0001', 'current', 'acknowledged'], ['NTC-0003', 'expired', 'info']]);
    expect(r.counts).toEqual({ current: 2, expired: 1 });
    expect(r.owed).toBe(1);
    expect(r.items[0]).toMatchObject({ scopeLabel: 'Willow House', textVersion: 1, urgent: true });
  });
  test('an admin does not hold own_notices; an employee cannot manage notices', async () => {
    expect((await (await as('admin'))('GET', '/api/v1/notices/mine')).status).toBe(403);
    const emp = await as('employee'), before = snapshot(...WRITES);
    expect((await emp('GET', '/api/v1/notices')).status).toBe(403);
    expect((await emp('POST', '/api/v1/notices', NEW)).status).toBe(403);
    expect((await emp('DELETE', '/api/v1/notices/NTC-0004', undefined, 1)).status).toBe(403);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a draft, someone else\'s location or an unknown notice cannot be read', async () => {
    const emp = await as('employee');
    expect((await emp('GET', '/api/v1/notices/mine/NTC-0004')).status).toBe(404);
    expect((await emp('GET', '/api/v1/notices/mine/NTC-0002')).status).toBe(200);
    expect((await emp('GET', '/api/v1/notices/mine/NTC-9999')).status).toBe(404);
  });
});

describe('acknowledging (D10)', () => {
  test('one record at the textVersion read, one audit row; a repeat is ALREADY_ACKNOWLEDGED and adds nothing', async () => {
    const emp = await as('employee');
    const r = await emp('POST', '/api/v1/notices/NTC-0002/acknowledge', { textVersion: 1 });
    expect(r.status).toBe(200);
    const a = Acknowledged.parse(r.body);
    expect(a.record).toMatchObject({ you: 'acknowledged', owed: false, acknowledgedAt: '2026-08-13T14:30:00.000Z' });
    expect(a.message).toBe('Acknowledged. Fire drill on Thursday at 10:00 v1. Whoever posted it can see this.');
    expect(ntc('NTC-0002')?.acks.filter(x => x.personCode === 'CP-1042')).toEqual([{ personCode: 'CP-1042', textVersion: 1, at: '2026-08-13T14:30:00.000Z' }]);
    expect(own().map(x => [x.act, x.entityId])).toEqual([['Notice acknowledged', 'NTC-0002']]);
    const again = await emp('POST', '/api/v1/notices/NTC-0002/acknowledge', { textVersion: 1 });
    expect(again.status).toBe(409);
    expect(refusal(again)).toMatchObject({ code: 'ALREADY_ACKNOWLEDGED', message: 'Already acknowledged. You acknowledged v1.' });
    expect(ntc('NTC-0002')?.acks).toHaveLength(3);
    expect(own()).toHaveLength(1);
  });
  test('an expired notice, or one that does not ask, is not open', async () => {
    const emp = await as('employee');
    for (const id of ['NTC-0003', 'NTC-0004']) {
      const r = await emp('POST', `/api/v1/notices/${id}/acknowledge`, { textVersion: 1 });
      expect(r.status).toBe(409);
      expect(refusal(r)).toMatchObject({ code: 'CLOSED', message: 'That notice is no longer open for acknowledgement.' });
    }
  });
  test('a text edit in between is CHANGED; the new version asks again and the old acknowledgement stays', async () => {
    const mgr = await as('manager'), emp = await as('employee');
    const n = ntc('NTC-0002');
    const e = await mgr('PATCH', '/api/v1/notices/NTC-0002', { title: n?.title, body: 'Meet at the back car park.', from: n?.from, until: n?.until, mustAck: true, pinned: false, urgent: true }, 1);
    expect(e.status).toBe(200);
    expect(NoticeSaved.parse(e.body).message).toBe('Saved as v2. 11 people now need to acknowledge it.');
    const stale = await emp('POST', '/api/v1/notices/NTC-0002/acknowledge', { textVersion: 1 });
    expect(stale.status).toBe(409);
    expect(refusal(stale).code).toBe('CHANGED');
    expect((await emp('POST', '/api/v1/notices/NTC-0002/acknowledge', { textVersion: 2 })).status).toBe(200);
    /* Marcus acknowledged v1: asked again, his v1 record kept */
    expect(ntc('NTC-0002')?.acks.filter(x => x.personCode === 'CP-1088').map(x => x.textVersion)).toEqual([1]);
  });
});

describe('posting (notice_post, notice_org; Review Focus 1, 5)', () => {
  test('a manager posts to their location: live at v1, a new id, one audit row, and the audience told per the matrix', async () => {
    const r = await (await as('manager'))('POST', '/api/v1/notices', NEW);
    expect(r.status).toBe(200);
    const s = NoticeSaved.parse(r.body);
    const k = activeAt('WH').length;
    expect(s.message).toBe(`Posted. Hand hygiene audit next week. ${k} people in Willow House.`);
    expect(s.record).toMatchObject({ id: 'NTC-0005', state: 'live', status: 'current', textVersion: 1, version: 1, audience: k, acknowledged: 0, mine: true, by: 'Rachel Hussain' });
    expect(own().map(a => [a.act, a.entityId])).toEqual([['Notice posted', 'NTC-0005']]);
    expect(told().map(t => t.personId).sort()).toEqual(activeAt('WH').map(p => p.code).sort());
    expect(told().every(t => t.area === 'Notices' && t.ref === 'NTC-0005' && t.title === 'Notice: Hand hygiene audit next week' && t.channel === 'In-app')).toBe(true);
  });
  test('an admin posts to everyone; everyone in the audience is told in the Employee column, admins too (I3)', async () => {
    const r = await (await as('admin'))('POST', '/api/v1/notices', { ...NEW, scope: ALL, urgent: true });
    expect(r.status).toBe(200);
    const people = Object.values(store.coll<{ code: string; state: string }>('people')).filter(p => p.state === 'active');
    expect(told().some(t => t.personId === 'CP-1002')).toBe(true);
    expect(told()).toHaveLength(people.length);
    expect(told()[0]?.title).toBe('Urgent notice: Hand hygiene audit next week');
  });
  test('a manager cannot reach everyone or another location, even by forcing the scope; nothing is created', async () => {
    const mgr = await as('manager'), before = snapshot(...WRITES);
    const all = await mgr('POST', '/api/v1/notices', { ...NEW, scope: ALL });
    expect(all.status).toBe(403);
    expect(refusal(all)).toMatchObject({ code: 'scope', field: 'scope', message: 'You cannot post to Everyone. It needs Post notices to everyone in Permissions.' });
    expect((await mgr('POST', '/api/v1/notices', { ...NEW, scope: { kind: 'loc', code: 'BC', loc: 'BC' } })).status).toBe(403);
    expect((await mgr('POST', '/api/v1/notices', { ...NEW, scope: { kind: 'dept', code: 'CARE', loc: '' } })).status).toBe(403);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a manager may post to a department within their location', async () => {
    const r = await (await as('manager'))('POST', '/api/v1/notices', { ...NEW, scope: { kind: 'dept', code: 'CARE', loc: 'WH' } });
    expect(NoticeSaved.parse(r.body).record.scopeLabel).toBe('Care Services · Willow House');
  });
  test('the poster list: draft first, organisation notices read-only, counts per status and the scopes offered', async () => {
    const r = PostedNotices.parse((await (await as('manager'))('GET', '/api/v1/notices')).body);
    expect(r.items.map(n => [n.id, n.status, n.mine])).toEqual([['NTC-0004', 'draft', true], ['NTC-0002', 'current', true], ['NTC-0001', 'current', false], ['NTC-0003', 'expired', false]]);
    expect(r.counts).toEqual({ all: 4, draft: 1, current: 2, scheduled: 0, expired: 1, withdrawn: 0 });
    expect(r.scopes.map(s => s.label)).toEqual(['Willow House', 'Care Services · Willow House']);
    expect(r).toMatchObject({ org: false, location: 'Willow House' });
    const drafts = PostedNotices.parse((await (await as('manager'))('GET', '/api/v1/notices?status=draft')).body);
    expect(drafts.items.map(n => n.id)).toEqual(['NTC-0004']);
    const fire = r.items.find(n => n.id === 'NTC-0002');
    expect(fire).toMatchObject({ audience: activeAt('WH').length, acknowledged: 2 });
  });
  test('a draft is saved, nobody sees it, and posting it later tells the audience', async () => {
    const mgr = await as('manager');
    const d = NoticeSaved.parse((await mgr('POST', '/api/v1/notices', { ...NEW, post: false })).body);
    expect(d).toMatchObject({ message: 'Draft saved. Nobody sees it until you post it.', record: { state: 'draft' } });
    expect(told()).toEqual([]);
    const p = await mgr('POST', `/api/v1/notices/${d.record.id}/post`, undefined, 1);
    expect(NoticeSaved.parse(p.body).record.state).toBe('live');
    expect(told().length).toBe(activeAt('WH').length);
    expect((await mgr('POST', `/api/v1/notices/${d.record.id}/post`, undefined, 2)).status).toBe(409);
    expect(own().map(a => a.act)).toEqual(['Notice drafted', 'Notice posted']);
  });
  test('a title, the text and the dates are checked on their fields', async () => {
    const mgr = await as('manager');
    const r = await mgr('POST', '/api/v1/notices', { ...NEW, title: ' ' });
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ field: 'title', message: 'Give the notice a title. Nothing has been saved.' });
    expect(refusal(await mgr('POST', '/api/v1/notices', { ...NEW, from: '2026-08-20', until: '2026-08-19' }))).toMatchObject({ field: 'until' });
  });
});

describe('editing, pinning, deleting and withdrawing (D10)', () => {
  test('dates and pin change without a new version; the audience is fixed once live; a stale version is 412', async () => {
    const mgr = await as('manager'), n = ntc('NTC-0002');
    const base = { title: n?.title, body: n?.body, from: n?.from, until: '2026-08-25', mustAck: true, pinned: false, urgent: true };
    expect((await mgr('PATCH', '/api/v1/notices/NTC-0002', base, 0)).status).toBe(412);
    const moved = await mgr('PATCH', '/api/v1/notices/NTC-0002', { ...base, scope: { kind: 'dept', code: 'CARE', loc: 'WH' } }, 1);
    expect(moved.status).toBe(409);
    expect(refusal(moved)).toMatchObject({ code: 'AUDIENCE_FIXED', field: 'scope' });
    const r = NoticeSaved.parse((await mgr('PATCH', '/api/v1/notices/NTC-0002', base, 1)).body);
    expect(r.message).toBe('Saved. Ends 20/08/2026 → 25/08/2026.');
    expect(r.record).toMatchObject({ textVersion: 1, version: 2, acknowledged: 2 });
    expect(told()).toEqual([]);
    const pin = NoticeSaved.parse((await mgr('PUT', '/api/v1/notices/NTC-0002/pin', { pinned: true }, 2)).body);
    expect(pin).toMatchObject({ message: 'Pinned. It now sits at the top for everyone it reaches.', record: { pinned: true, textVersion: 1 } });
    expect(own().map(a => a.act)).toEqual(['Notice edited', 'Notice pinned']);
  });
  test('an organisation notice is outside a manager\'s scope', async () => {
    const r = await (await as('manager'))('PUT', '/api/v1/notices/NTC-0001/pin', { pinned: false }, 1);
    expect(r.status).toBe(403);
    expect(refusal(r).message).toBe('Updated lone working policy is outside your scope. It is for Everyone.');
  });
  test('only a draft can be deleted; a live one says to withdraw it instead', async () => {
    const mgr = await as('manager');
    const live = await mgr('DELETE', '/api/v1/notices/NTC-0002', undefined, 1);
    expect(live.status).toBe(409);
    expect(refusal(live)).toMatchObject({ code: 'NOT_DRAFT', message: 'Fire drill on Thursday at 10:00 cannot be deleted. It has been live and holds 2 acknowledgements.',
      next: 'Withdraw it instead.' });
    const d = NoticeDeleted.parse((await mgr('DELETE', '/api/v1/notices/NTC-0004', undefined, 1)).body);
    expect(d.message).toBe('Draft deleted. Nobody had seen it.');
    expect(ntc('NTC-0004')).toBeUndefined();
    expect(own().map(a => a.act)).toEqual(['Notice deleted']);
  });
  test('withdrawing needs a reason; it keeps the record and its acknowledgements, and colleagues stop seeing it', async () => {
    const mgr = await as('manager');
    const bare = await mgr('POST', '/api/v1/notices/NTC-0002/withdraw', { reason: '  ' }, 1);
    expect(bare.status).toBe(422);
    expect(refusal(bare)).toMatchObject({ field: 'reason', message: 'Give a reason. Colleagues who acknowledged keep their record.' });
    expect(ntc('NTC-0002')?.state).toBe('live');
    const w = NoticeSaved.parse((await mgr('POST', '/api/v1/notices/NTC-0002/withdraw', { reason: 'Drill moved to next month' }, 1)).body);
    expect(w.message).toBe('Withdrawn. Fire drill on Thursday at 10:00. Colleagues no longer see it. The record stays on My team → Notices.');
    expect(ntc('NTC-0002')).toMatchObject({ state: 'withdrawn', withdrawReason: 'Drill moved to next month' });
    expect(ntc('NTC-0002')?.acks).toHaveLength(2);
    const mine = MyNotices.parse((await (await as('employee'))('GET', '/api/v1/notices/mine')).body);
    expect(mine.items.map(n => n.id)).not.toContain('NTC-0002');
    expect(audits().find(a => a.act === 'Notice withdrawn')?.reason).toBe('Drill moved to next month');
  });
  test('the tracker: who acknowledged which version among the people the poster can see, and the trail', async () => {
    const mgr = await as('manager');
    await mgr('PUT', '/api/v1/notices/NTC-0002/pin', { pinned: true }, 1);
    const t = NoticeTrack.parse((await mgr('GET', '/api/v1/notices/NTC-0002/track')).body);
    expect(t.people.length).toBe(activeAt('WH').length);
    expect(t.people.find(p => p.code === 'CP-1088')).toMatchObject({ acknowledged: true, textVersion: 1, location: 'Willow House' });
    expect(t.people.find(p => p.code === 'CP-1042')).toMatchObject({ acknowledged: false, textVersion: null });
    expect(t.trail.map(x => [x.act, x.detail])).toEqual([['Notice pinned', 'pinned off → on']]);
    /* a manager sees only their own location in an organisation notice's audience */
    const org = NoticeTrack.parse((await mgr('GET', '/api/v1/notices/NTC-0001/track')).body);
    expect(org.people.every(p => p.location === 'Willow House')).toBe(true);
    const adm = NoticeTrack.parse((await (await as('admin'))('GET', '/api/v1/notices/NTC-0001/track')).body);
    expect(adm.people.length).toBeGreaterThan(org.people.length);
  });
});

describe('switched off, faults and rollback (Review Focus 7)', () => {
  test('with the notice board off every surface refuses with the prototype\'s words and the notices are kept', async () => {
    boardOff();
    const emp = await as('employee'), mgr = await as('manager'), before = snapshot(...WRITES);
    const r = await emp('GET', '/api/v1/notices/mine');
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'feature-off', message: 'The notice board is switched off for this tenant.', next: 'Turn it on in Qnipay setup → Modules and features.' });
    expect((await emp('POST', '/api/v1/notices/NTC-0002/acknowledge', { textVersion: 1 })).status).toBe(403);
    expect((await mgr('POST', '/api/v1/notices', NEW)).status).toBe(403);
    expect((await mgr('GET', '/api/v1/notices')).status).toBe(403);
    expect(snapshot(...WRITES)).toEqual(before);
    expect(Object.keys(store.coll('notices'))).toHaveLength(4);
  });
  const N2 = { title: 'Fire drill on Thursday at 10:00', body: 'x', from: '2026-08-12', until: '2026-08-20', mustAck: true, pinned: false, urgent: true };
  for (const [persona, method, path, body, v] of [
    ['manager', 'POST', '/api/v1/notices', NEW, undefined], ['manager', 'PATCH', '/api/v1/notices/NTC-0002', N2, 1],
    ['manager', 'PUT', '/api/v1/notices/NTC-0002/pin', { pinned: true }, 1], ['manager', 'POST', '/api/v1/notices/NTC-0004/post', undefined, 1],
    ['manager', 'POST', '/api/v1/notices/NTC-0002/withdraw', { reason: 'r' }, 1], ['manager', 'DELETE', '/api/v1/notices/NTC-0004', undefined, 1],
    ['employee', 'POST', '/api/v1/notices/NTC-0002/acknowledge', { textVersion: 1 }, undefined],
  ] as const) {
    test(`a fault on ${method} ${path} leaves no notice, notification or audit row`, async () => {
      const call = await as(persona), before = snapshot(...WRITES);
      await fault(method, path);
      expect((await call(method, path, body, v)).status).toBe(500);
      expect(snapshot(...WRITES)).toEqual(before);
    });
  }
  test('a throw after the notice and the notifications are written rolls both back', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    store.db.audit = Object.freeze({ ...store.db.audit });
    expect((await call('POST', '/api/v1/notices', NEW)).status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

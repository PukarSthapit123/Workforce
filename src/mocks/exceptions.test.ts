import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { ExceptionList, ExceptionMoved, type ExceptionItem } from '@/contract/exceptions';
import { accountOf, audits, caller, resetTo, tokenFor, type Persona } from '@/test/api-helpers';

/* social at the frozen clock (Thursday 13/08/2026). Rachel Hussain
   (CP-1001) manages Willow House (WH) and holds team_hours; the employee and
   the administrator do not. WH's published week of 10 August derives
   clearance, coverage, an escalated leave request, the failed batch posting
   (every location's), missed timesheet days and hours flags. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const handlings = () => Object.values(store.coll('exceptionHandling'));
const excAudits = () => audits().filter(a => a.entity === 'exception');
async function list(p: Persona = 'manager', q = '') {
  const r = await (await as(p))('GET', `/api/v1/exceptions${q}`);
  expect(r.status).toBe(200);
  return ExceptionList.parse(r.body);
}
const first = (l: ExceptionList, kind: string): ExceptionItem => {
  const x = l.items.find(i => i.kind === kind);
  if (!x) throw new Error(`no ${kind} exception`);
  return x;
};
const go = async (p: Persona, id: string, move: string, ifMatch?: number, body?: unknown) =>
  (await as(p))('POST', `/api/v1/exceptions/${id}/${move}`, body, ifMatch);

describe('the list (team_hours, derived on read)', () => {
  test('WH\'s exceptions, highest severity first, each open and unhandled, and reading writes nothing', async () => {
    const l = await list();
    expect([l.location, l.locations]).toEqual([{ code: 'WH', name: 'Willow House' }, [{ code: 'WH', name: 'Willow House' }]]);
    expect(l.items.map(i => i.severity)).toEqual([...l.items.map(i => i.severity)].sort((a, b) => b - a));
    expect(new Set(l.items.map(i => i.kind))).toEqual(new Set(['Clearance', 'Coverage', 'Leave', 'Business Central', 'Timesheet', 'Compliance', 'Hours', 'Qualification']));
    expect(first(l, 'Business Central')).toMatchObject({ location: null, source: 'ibc', subject: 'Batch WK32 · generic API',
      text: 'Posting failed · Line 2: unknown cost centre CC-991 · attempt 1' });
    expect(first(l, 'Leave')).toMatchObject({ subject: 'Priya Shah', text: 'Approval SLA breached. Escalated to Service Manager.' });
    expect(l.items.every(i => i.state === 'open' && i.version === 0 && i.owner === null && i.firstRecorded === null)).toBe(true);
    expect([handlings(), excAudits()]).toEqual([[], []]);
  });
  test('a session without team_hours is refused, and a location outside the manager\'s scope is refused with scope', async () => {
    for (const p of ['employee', 'admin'] as const) {
      const r = await (await as(p))('GET', '/api/v1/exceptions');
      expect([r.status, refusal(r).code]).toEqual([403, 'capability']);
    }
    const out = await (await as('manager'))('GET', '/api/v1/exceptions?location=LGW');
    expect(out.status).toBe(403);
    expect(refusal(out)).toEqual({ code: 'scope', message: 'You can see exceptions at Willow House only.', next: 'Ask an administrator if you need exceptions at another location.' });
  });
});

describe('the transitions', () => {
  test('take: in progress, owned by the caller, stored under the stable key, one audit row', async () => {
    const x = first(await list(), 'Timesheet');
    const r = await go('manager', x.id, 'take', 0);
    expect(r.status).toBe(200);
    const m = ExceptionMoved.parse(r.body);
    expect(m.message).toBe('Taken · you are now the owner');
    expect(m.record).toMatchObject({ id: x.id, key: x.key, version: 1, state: 'prog', owner: { personCode: 'CP-1001', name: 'Rachel Hussain' },
      firstRecorded: store.now(), history: [{ from: 'open', to: 'prog', by: { personCode: 'CP-1001' }, note: '' }] });
    expect(excAudits()).toEqual([expect.objectContaining({ id: m.auditId, act: 'Exception in progress', entityId: x.id,
      before: { state: 'open', owner: null }, after: expect.objectContaining({ state: 'prog', owner: 'Rachel Hussain' }) })]);
    /* a re-derive finds the same exception and its handling */
    expect((await list()).items.find(i => i.id === x.id)).toMatchObject({ state: 'prog', version: 1, owner: { name: 'Rachel Hussain' } });
  });
  test('resolve: refused without a note, then recorded with one; reopen brings it back', async () => {
    const x = first(await list(), 'Hours');
    await go('manager', x.id, 'take', 0);
    const bare = await go('manager', x.id, 'resolve', 1, { note: '   ' });
    expect(bare.status).toBe(422);
    expect(refusal(bare)).toEqual({ code: 'invalid', field: 'note', message: 'A resolution note is required.', next: 'Say what was done, then resolve it.' });
    expect(excAudits()).toHaveLength(1);
    const ok = ExceptionMoved.parse((await go('manager', x.id, 'resolve', 1, { note: 'Hours corrected with the colleague and resubmitted' })).body);
    expect([ok.record.state, ok.record.resolution, ok.record.version, ok.message]).toEqual(['resolved', 'Hours corrected with the colleague and resubmitted', 2,
      'Resolved · recorded against the exception']);
    expect(excAudits().at(-1)).toMatchObject({ act: 'Exception resolved',
      after: { detail: `Hours · ${x.subject} · "Hours corrected with the colleague and resubmitted"` } });
    const re = ExceptionMoved.parse((await go('manager', x.id, 'reopen', 2)).body);
    expect([re.record.state, re.record.history.map(h => h.to), re.message]).toEqual(['reopened', ['prog', 'resolved', 'reopened'], 'Reopened · it needs action again']);
    expect(excAudits().map(a => a.act)).toEqual(['Exception in progress', 'Exception resolved', 'Exception reopened']);
  });
  test('ignore: refused without a reason, then recorded; back to open clears the owner', async () => {
    const [a, b] = (await list()).items.filter(i => i.kind === 'Compliance');
    if (!a || !b) throw new Error('two compliance exceptions expected');
    const bare = await go('manager', a.id, 'ignore', 0, { reason: '' });
    expect([bare.status, refusal(bare).field]).toEqual([422, 'reason']);
    const ign = ExceptionMoved.parse((await go('manager', a.id, 'ignore', 0, { reason: 'Accepted for this period' })).body);
    expect([ign.record.state, ign.record.resolution, ign.record.owner]).toEqual(['ignored', 'Accepted for this period', null]);
    await go('manager', b.id, 'take', 0);
    const back = ExceptionMoved.parse((await go('manager', b.id, 'release', 1)).body);
    expect([back.record.state, back.record.owner, back.message]).toEqual(['open', null, 'Moved back to open']);
    expect(excAudits().map(x => x.act)).toEqual(['Exception ignored', 'Exception in progress', 'Exception open']);
  });
  test('an illegal transition is refused with what the state allows, and writes nothing', async () => {
    const x = first(await list(), 'Coverage');
    const r = await go('manager', x.id, 'resolve', 0, { note: 'Done' });
    expect(r.status).toBe(409);
    expect(refusal(r)).toEqual({ code: 'ILLEGAL_TRANSITION', message: 'An open exception cannot move to resolved.', next: 'It can be taken or ignored.' });
    for (const m of ['reopen', 'release']) expect((await go('manager', x.id, m, 0)).status).toBe(409);
    await go('manager', x.id, 'take', 0);
    expect(refusal(await go('manager', x.id, 'take', 1))).toMatchObject({ code: 'ILLEGAL_TRANSITION', message: 'An in progress exception cannot move to in progress.' });
    expect([excAudits().length, handlings().length]).toEqual([1, 1]);
  });
});

describe('capability, scope and version refusals', () => {
  test('without team_hours a transition is refused with capability', async () => {
    const x = first(await list(), 'Clearance');
    const r = await go('employee', x.id, 'take', 0);
    expect([r.status, refusal(r).code]).toEqual([403, 'capability']);
    expect(excAudits()).toEqual([]);
  });
  test('an exception at a location outside the manager\'s scope is refused with scope; one no longer detected is not found', async () => {
    const admin = Object.values(store.coll<{ email: string; grants: string[] }>('accounts')).find(a => a.email === accountOf('admin').email);
    if (!admin) throw new Error('no admin account');
    admin.grants = ['team_hours'];
    const there = (await list('admin', '?location=LGW')).items.find(i => i.location === 'LGW');
    if (!there) throw new Error('LGW has no exception of its own');
    const r = await go('manager', there.id, 'take', 0);
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'scope', message: 'That exception is at London Gateway, outside your scope.' });
    const gone = await go('manager', 'exc_0000000000000000', 'take', 0);
    expect([gone.status, refusal(gone).code]).toEqual([404, 'not-found']);
    expect(excAudits()).toEqual([]);
  });
  test('an exception about the caller is marked mine, and every move on it is refused with SELF_APPROVAL, while someone else can handle it', async () => {
    /* Rachel Hussain, WH's manager, is not cleared to work */
    store.coll<Record<string, unknown>>('rotaProfiles')['rp_CP-1001'] = { id: 'rp_CP-1001', version: 1, updatedAt: store.now(), personCode: 'CP-1001',
      cleared: false, dbsExpiry: '2026-07-31', qualifications: 'Care Certificate', favourite: false, preferredDays: [] };
    const l = await list();
    const own = l.items.find(i => i.kind === 'Clearance' && i.subject === 'Rachel Hussain');
    if (!own) throw new Error('no clearance exception about Rachel Hussain');
    expect(own.mine).toBe(true);
    expect(l.items.filter(i => i.mine).every(i => i.subject === 'Rachel Hussain')).toBe(true);
    expect(l.items.filter(i => !i.mine).length).toBeGreaterThan(0);
    const self = { code: 'SELF_APPROVAL', message: 'You cannot handle an exception about yourself.', next: 'Ask another manager at your location.' };
    const refusedAll = async (moves: string[], ifMatch: number) => {
      for (const mv of moves) {
        const r = await go('manager', own.id, mv, ifMatch, mv === 'resolve' ? { note: 'Renewed' } : mv === 'ignore' ? { reason: 'Agreed' } : undefined);
        expect([mv, r.status, refusal(r)]).toEqual([mv, 403, self]);
      }
    };
    await refusedAll(['take', 'ignore'], 0);
    /* an administrator holding team_hours handles it instead */
    const admin = Object.values(store.coll<{ email: string; grants: string[] }>('accounts')).find(a => a.email === accountOf('admin').email);
    if (!admin) throw new Error('no admin account');
    admin.grants = ['team_hours'];
    expect((await go('admin', own.id, 'take', 0)).status).toBe(200);
    await refusedAll(['release', 'resolve', 'ignore'], 1);
    expect((await go('admin', own.id, 'resolve', 1, { note: 'DBS renewal booked' })).status).toBe(200);
    await refusedAll(['reopen'], 2);
    expect(excAudits().map(a => a.act)).toEqual(['Exception in progress', 'Exception resolved']);
    expect((await list('admin', '?location=WH')).items.find(i => i.id === own.id)).toMatchObject({ state: 'resolved', mine: false });
  });
  test('a stale version is 412 and a missing one 428, and neither writes', async () => {
    const x = first(await list(), 'Qualification');
    expect((await go('manager', x.id, 'take', 0)).status).toBe(200);
    const stale = await go('manager', x.id, 'resolve', 0, { note: 'Renewed' });
    expect([stale.status, refusal(stale).code]).toEqual([412, 'stale']);
    const none = await go('manager', x.id, 'resolve', undefined, { note: 'Renewed' });
    expect(none.status).toBe(428);
    expect(excAudits()).toHaveLength(1);
    expect((await list()).items.find(i => i.id === x.id)?.state).toBe('prog');
  });
});

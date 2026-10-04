import {
  AUDIENCE_FIXED, CHANGED, NOT_OPEN, ackProblem, ackedEarlier, ackedNow, audienceOf, cannotPostTo, editedToast, fieldsProblem, myNotices, noticeFor,
  noticeOrder, noticeScopes, noticeStatus, notDraft, outsideScope, owes, planEdit, postedNotices, postedToast, posterOrder, readerState, scopeLabel,
  type Notice, type NoticePerson, type ScopeWorld,
} from './notices';

const TODAY = '2026-08-13';
const notice = (o: Partial<Notice> = {}): Notice => ({
  id: 'NTC-0001', textVersion: 1, title: 'Fire drill', body: 'Leave by the nearest exit.', scope: { kind: 'all', code: '', loc: '' },
  pinned: false, urgent: false, mustAck: true, from: '2026-08-10', until: '', state: 'live', by: 'Dee Fitzgerald', at: '2026-08-10T08:00:00.000Z',
  withdrawReason: '', acks: [], history: [], ...o });
const person = (code: string, location: string, department: string, active = true): NoticePerson => ({ code, location, department, active });
const PEOPLE = [person('A', 'WH', 'CARE'), person('B', 'WH', 'CARE'), person('C', 'WH', 'ADM'), person('D', 'BC', 'CARE'), person('E', 'WH', 'CARE', false)];
const world = (o: Partial<ScopeWorld> = {}): ScopeWorld => ({
  org: false, location: 'WH', people: PEOPLE,
  locations: [{ code: 'WH', name: 'Willow House', active: true }, { code: 'BC', name: 'Beacon Court', active: true }, { code: 'XX', name: 'Closed', active: false }],
  departments: [{ code: 'CARE', name: 'Care Services' }, { code: 'ADM', name: 'Administration' }], ...o });
const names = { location: (c: string) => ({ WH: 'Willow House', BC: 'Beacon Court' }[c] ?? c), department: (c: string) => ({ CARE: 'Care Services' }[c] ?? c) };

describe('status is read off the state and the dates', () => {
  test('draft and withdrawn are stored; expired, scheduled and current come from the dates', () => {
    expect(noticeStatus(notice({ state: 'draft', until: '2026-01-01' }), TODAY)).toBe('draft');
    expect(noticeStatus(notice({ state: 'withdrawn' }), TODAY)).toBe('withdrawn');
    expect(noticeStatus(notice({ until: '2026-08-12' }), TODAY)).toBe('expired');
    expect(noticeStatus(notice({ until: TODAY }), TODAY)).toBe('current');
    expect(noticeStatus(notice({ from: '2026-08-14' }), TODAY)).toBe('scheduled');
    expect(noticeStatus(notice({ from: TODAY }), TODAY)).toBe('current');
  });
});

describe('the audience is worked out from the record at read time', () => {
  test('everyone, a location, a department within a location or at every location; only active people count', () => {
    expect(audienceOf(notice(), PEOPLE).map(p => p.code)).toEqual(['A', 'B', 'C', 'D']);
    expect(audienceOf(notice({ scope: { kind: 'loc', code: 'WH', loc: 'WH' } }), PEOPLE).map(p => p.code)).toEqual(['A', 'B', 'C']);
    expect(audienceOf(notice({ scope: { kind: 'dept', code: 'CARE', loc: 'WH' } }), PEOPLE).map(p => p.code)).toEqual(['A', 'B']);
    expect(audienceOf(notice({ scope: { kind: 'dept', code: 'CARE', loc: '' } }), PEOPLE).map(p => p.code)).toEqual(['A', 'B', 'D']);
  });
  test('a mover sees what their new place sees, and the notice is untouched', () => {
    const n = notice({ scope: { kind: 'loc', code: 'WH', loc: 'WH' } }), before = JSON.stringify(n);
    expect(noticeFor(n, person('A', 'WH', 'CARE'))).toBe(true);
    expect(noticeFor(n, person('A', 'BC', 'CARE'))).toBe(false);
    expect(noticeFor(n, undefined)).toBe(false);
    expect(JSON.stringify(n)).toBe(before);
  });
  test('the reader sees current and expired notices aimed at them, never drafts, scheduled or withdrawn', () => {
    const list = [notice({ id: 'cur' }), notice({ id: 'exp', until: '2026-08-01' }), notice({ id: 'dr', state: 'draft' }),
      notice({ id: 'sch', from: '2026-09-01' }), notice({ id: 'wd', state: 'withdrawn' }), notice({ id: 'bc', scope: { kind: 'loc', code: 'BC', loc: 'BC' } })];
    expect(myNotices(list, person('A', 'WH', 'CARE'), TODAY).map(n => n.id)).toEqual(['cur', 'exp']);
  });
});

describe('order: urgent first, then pinned, then newest', () => {
  test('the reader order and the poster order', () => {
    const list = [notice({ id: 'old', from: '2026-08-01' }), notice({ id: 'new', from: '2026-08-12' }), notice({ id: 'pin', pinned: true, from: '2026-07-01' }),
      notice({ id: 'urg', urgent: true, from: '2026-06-01' })];
    expect([...list].sort(noticeOrder).map(n => n.id)).toEqual(['urg', 'pin', 'new', 'old']);
    const poster = [notice({ id: 'wd', state: 'withdrawn' }), notice({ id: 'exp', until: '2026-08-01' }), notice({ id: 'sch', from: '2026-09-01' }),
      notice({ id: 'cur' }), notice({ id: 'dr', state: 'draft' })];
    expect([...poster].sort(posterOrder(TODAY)).map(n => n.id)).toEqual(['dr', 'cur', 'sch', 'exp', 'wd']);
  });
});

describe('scopes: a manager posts within their own location; wider needs notice_org', () => {
  test('a manager gets their location and the departments of the people there', () => {
    expect(noticeScopes(world())).toEqual([{ kind: 'loc', code: 'WH', loc: 'WH' }, { kind: 'dept', code: 'CARE', loc: 'WH' }, { kind: 'dept', code: 'ADM', loc: 'WH' }]);
  });
  test('no location, nothing to post to', () => expect(noticeScopes(world({ location: '' }))).toEqual([]));
  test('notice_org reaches everyone, every active location and every department at every location', () => {
    expect(noticeScopes(world({ org: true }))).toEqual([{ kind: 'all', code: '', loc: '' }, { kind: 'loc', code: 'WH', loc: 'WH' }, { kind: 'loc', code: 'BC', loc: 'BC' },
      { kind: 'dept', code: 'CARE', loc: '' }, { kind: 'dept', code: 'ADM', loc: '' }]);
  });
  test('a poster manages what they can target, and sees organisation notices too', () => {
    const list = [notice({ id: 'all' }), notice({ id: 'wh', scope: { kind: 'loc', code: 'WH', loc: 'WH' } }), notice({ id: 'bc', scope: { kind: 'loc', code: 'BC', loc: 'BC' } })];
    expect(postedNotices(list, noticeScopes(world())).map(n => n.id)).toEqual(['all', 'wh']);
  });
  test('labels and the scope refusals read as sentences', () => {
    expect(scopeLabel({ kind: 'all', code: '', loc: '' }, names)).toBe('Everyone');
    expect(scopeLabel({ kind: 'loc', code: 'WH', loc: 'WH' }, names)).toBe('Willow House');
    expect(scopeLabel({ kind: 'dept', code: 'CARE', loc: 'WH' }, names)).toBe('Care Services · Willow House');
    expect(scopeLabel({ kind: 'dept', code: 'CARE', loc: '' }, names)).toBe('Care Services · every location');
    expect(cannotPostTo('Everyone')).toMatchObject({ status: 403, field: 'scope', message: 'You cannot post to Everyone. It needs Post notices to everyone in Permissions.' });
    expect(outsideScope('Summer social', 'Beacon Court').message).toBe('Summer social is outside your scope. It is for Beacon Court.');
  });
});

describe('fields', () => {
  const f = { title: 'Fire drill', body: 'Leave.', from: TODAY, until: '' };
  test('a title, the text, and an end on or after the start', () => {
    expect(fieldsProblem(f)).toBeNull();
    expect(fieldsProblem({ ...f, title: '  ' })).toMatchObject({ field: 'title', message: 'Give the notice a title. Nothing has been saved.' });
    expect(fieldsProblem({ ...f, body: '' })).toMatchObject({ field: 'body', message: 'Write the notice. Nothing has been saved.' });
    expect(fieldsProblem({ ...f, until: '2026-08-12' })).toMatchObject({ field: 'until', message: 'The end date is before the start date. Nothing has been saved.' });
    expect(fieldsProblem({ ...f, until: TODAY })).toBeNull();
  });
});

describe('versions (D10): only the words make a new version', () => {
  const base = notice({ acks: [{ personCode: 'A', textVersion: 1, at: '2026-08-11T09:00:00.000Z' }] });
  const fields = { title: base.title, body: base.body, from: base.from, until: base.until, mustAck: true, pinned: false, urgent: false };
  test('a text edit bumps the textVersion, keeps the old words in history and the old acknowledgement on record', () => {
    const plan = planEdit(base, { ...fields, body: 'Leave by the nearest exit and meet outside.' }, 'Rachel Hussain', '2026-08-13T14:30:00.000Z');
    expect(plan?.textChanged).toBe(true);
    expect(plan?.next).toMatchObject({ textVersion: 2, by: 'Rachel Hussain', history: [{ textVersion: 1, body: 'Leave by the nearest exit.' }] });
    expect(plan?.next.acks).toEqual(base.acks);
    expect(plan?.changes).toEqual(['v1 → v2']);
    const next = plan?.next ?? base;
    expect(ackedNow(next, 'A')).toBe(false);
    expect(ackedEarlier(next, 'A')).toBe(true);
    expect(readerState(next, 'A')).toBe('again');
    expect(plan && editedToast(plan, 4)).toBe('Saved as v2. 4 people now need to acknowledge it.');
  });
  test('dates, pin, urgency and must acknowledge change in place, each recorded before → after', () => {
    const plan = planEdit(base, { ...fields, pinned: true, urgent: true, mustAck: false, until: '2026-08-20', from: '2026-08-11' }, 'R', 'now');
    expect(plan?.textChanged).toBe(false);
    expect(plan?.next.textVersion).toBe(1);
    expect(plan?.next.history).toEqual([]);
    expect(plan?.changes).toEqual(['must acknowledge on → off', 'urgent off → on', 'pinned off → on', 'from 10/08/2026 → 11/08/2026', 'ends none → 20/08/2026']);
    expect(plan && editedToast(plan, 0)).toBe('Saved. Must acknowledge on → off, urgent off → on, pinned off → on, from 10/08/2026 → 11/08/2026, ends none → 20/08/2026.');
  });
  test('nothing changed is no edit', () => expect(planEdit(base, fields, 'R', 'now')).toBeNull());
  test('a draft is rewritten in place without a new version', () => {
    const plan = planEdit(notice({ state: 'draft' }), { ...fields, title: 'Fire drill moved' }, 'R', 'now');
    expect(plan?.next).toMatchObject({ textVersion: 1, title: 'Fire drill moved', history: [] });
  });
});

describe('acknowledging', () => {
  const me = person('A', 'WH', 'CARE');
  test('only a current notice that asks for it and reaches me, at the version I read', () => {
    expect(ackProblem(notice(), me, TODAY, 1)).toBeNull();
    expect(ackProblem(notice({ mustAck: false }), me, TODAY, 1)).toBe(NOT_OPEN);
    expect(ackProblem(notice({ until: '2026-08-01' }), me, TODAY, 1)).toBe(NOT_OPEN);
    expect(ackProblem(notice({ state: 'withdrawn' }), me, TODAY, 1)).toBe(NOT_OPEN);
    expect(ackProblem(notice({ scope: { kind: 'loc', code: 'BC', loc: 'BC' } }), me, TODAY, 1)).toBe(NOT_OPEN);
    expect(ackProblem(notice({ textVersion: 2 }), me, TODAY, 1)).toBe(CHANGED);
  });
  test('a repeat is refused, at whatever version was sent', () => {
    const n = notice({ textVersion: 2, acks: [{ personCode: 'A', textVersion: 2, at: 'x' }] });
    expect(ackProblem(n, me, TODAY, 2)).toMatchObject({ status: 409, code: 'ALREADY_ACKNOWLEDGED', message: 'Already acknowledged. You acknowledged v2.' });
    expect(ackProblem(n, me, TODAY, 1)?.code).toBe('ALREADY_ACKNOWLEDGED');
  });
  test('the reader states and what is owed', () => {
    expect(readerState(notice({ mustAck: false }), 'A')).toBe('info');
    expect(readerState(notice(), 'A')).toBe('owed');
    expect(readerState(notice({ acks: [{ personCode: 'A', textVersion: 1, at: 'x' }] }), 'A')).toBe('acknowledged');
    expect(owes(notice(), 'A', TODAY)).toBe(true);
    expect(owes(notice({ until: '2026-08-01' }), 'A', TODAY)).toBe(false);
  });
});

describe('delete and withdraw', () => {
  test('a notice that has been live cannot be deleted, and says how many acknowledged it', () => {
    expect(notDraft(notice({ title: 'Hand hygiene', acks: [{ personCode: 'A', textVersion: 1, at: 'x' }, { personCode: 'B', textVersion: 1, at: 'x' }] })))
      .toMatchObject({ status: 409, code: 'NOT_DRAFT', message: 'Hand hygiene cannot be deleted. It has been live and holds 2 acknowledgements.', next: 'Withdraw it instead.' });
    expect(notDraft(notice({ title: 'Hand hygiene' })).message).toBe('Hand hygiene cannot be deleted. It has been live.');
  });
  test('the audience is fixed once live; the posted toast names how many and where', () => {
    expect(AUDIENCE_FIXED).toMatchObject({ status: 409, field: 'scope' });
    expect(postedToast('Fire drill', 11, 'Willow House', null)).toBe('Posted. Fire drill. 11 people in Willow House.');
    expect(postedToast('Fire drill', 1, 'Everyone', '2026-08-18')).toBe('Posted. Fire drill. 1 person in Everyone. They see it from 18/08/2026.');
  });
});

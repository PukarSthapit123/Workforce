import {
  EXC_STATES, MOVE_TO, NOTE_REQUIRED, REASON_REQUIRED, SEVERITY, UNHANDLED, applyMove, changesText, deriveExceptions, exceptionId, exceptionKey,
  filterCounts, inFilter, matches, moveAuditAct, moveProblem, movesFrom, needsAction, severityTone, type ExceptionFacts, type PersonFacts,
} from './exceptions';

const person = (o: Partial<PersonFacts> = {}): PersonFacts => ({ code: 'CP-1042', name: 'Amara Okafor', location: 'WH', flags: [], missing: [],
  cleared: true, dbsExpiry: '2027-03-31', qualifications: 'All valid', ...o });
const facts = (o: Partial<ExceptionFacts> = {}): ExceptionFacts => ({ weekStart: '2026-08-10', people: [], gaps: [], leave: [], postings: [], ...o });
const ME = { personCode: 'CP-1001', name: 'Rachel Hussain' };

describe('deriving exceptions from the data', () => {
  test('every kind P detects, with its severity, highest first and otherwise in the order found', () => {
    const xs = deriveExceptions(facts({
      people: [
        person({ flags: [{ k: 'Under contracted', c: 'info' }, { k: '2 nights', c: 'neu' }, { k: 'Over maximum', c: 'err' }], missing: ['2026-08-10', '2026-08-11'] }),
        person({ code: 'CP-1153', name: 'Joseph Mensah', qualifications: 'First aid expires in 24 days' }),
        person({ code: 'CP-1501', name: 'New Starter', cleared: false, dbsExpiry: '' }),
        person({ code: 'CP-1502', name: 'Old Check', qualifications: 'DBS expired 30/06/2026', cleared: false, dbsExpiry: '2026-06-30' }),
      ],
      gaps: [{ location: 'WH', locationName: 'Willow House', date: '2026-08-15', onShift: 1, min: 2 }],
      leave: [{ id: 'lr_1', personCode: 'CP-1201', name: 'Daniel Price', location: 'WH', escalateTo: 'Service manager' }],
      postings: [{ id: 'int_a1f3', ref: 'Batch WK32 · generic API', attempt: 1, reason: 'Line 2: unknown cost centre CC-991', location: null }],
    }));
    expect(xs.map(x => [x.kind, x.severity, x.subject, x.text])).toEqual([
      ['Clearance', 4, 'New Starter', 'Not cleared to work. No DBS check recorded.'],
      ['Clearance', 4, 'Old Check', 'Not cleared to work. DBS expired 30/06/2026.'],
      ['Coverage', 4, 'Willow House', 'Sat 15/08 is 1 of 2'],
      ['Leave', 4, 'Daniel Price', 'Approval SLA breached. Escalated to Service manager.'],
      ['Business Central', 4, 'Batch WK32 · generic API', 'Posting failed · Line 2: unknown cost centre CC-991 · attempt 1'],
      ['Compliance', 3, 'Amara Okafor', 'Over maximum'],
      ['Timesheet', 3, 'Amara Okafor', '2 scheduled days with no hours recorded'],
      ['Hours', 2, 'Amara Okafor', 'Under contracted'],
      ['Qualification', 2, 'Joseph Mensah', 'First aid expires in 24 days'],
    ]);
    expect(xs.map(x => x.source)).toEqual(['tpeople', 'tpeople', 'trota', 'tleave', 'ibc', 'thours', 'tteam', 'thours', 'tpeople']);
    expect(xs.find(x => x.kind === 'Business Central')?.location).toBeNull();
    expect(xs.find(x => x.kind === 'Coverage')?.location).toBe('WH');
  });
  test('a note flag (nights) and an already expired qualification raise nothing', () => {
    expect(deriveExceptions(facts({ people: [person({ flags: [{ k: '1 night', c: 'neu' }], qualifications: 'First aid expired' })] }))).toEqual([]);
  });
  test('the order is P\'s: coverage and clearance first, then hours and qualifications', () => {
    expect(Object.entries(SEVERITY).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 2)).toEqual(['Clearance', 'Coverage']);
    expect([severityTone(4), severityTone(3), severityTone(2)]).toEqual(['err', 'warn', 'neu']);
  });
});

describe('stable keys', () => {
  const one = facts({ people: [person({ missing: ['2026-08-10'] })], postings: [{ id: 'int_a', ref: 'R', attempt: 1, reason: 'x', location: null }] });
  test('a re-derive over the same facts gives the same ids', () => {
    expect(deriveExceptions(one).map(x => x.id)).toEqual(deriveExceptions(structuredClone(one)).map(x => x.id));
    expect(deriveExceptions(one)[0]?.id).toMatch(/^exc_[0-9a-f]{16}$/);
  });
  test('the key survives unrelated change, and a display change, but not a change to the fact', () => {
    const [post, ts] = deriveExceptions(one);
    const more = deriveExceptions(facts({ ...one, people: [person({ missing: ['2026-08-10'] }), person({ code: 'CP-2', name: 'B', missing: ['2026-08-11'] })] }));
    expect(more.map(x => x.id)).toEqual(expect.arrayContaining([post?.id, ts?.id]));
    /* the posting fails again: a new attempt is a new exception, so resolving the first cannot mask it */
    const again = deriveExceptions(facts({ ...one, postings: [{ id: 'int_a', ref: 'R', attempt: 2, reason: 'x', location: null }] }));
    expect(again.map(x => x.id)).not.toContain(post?.id);
    /* a further day goes missing */
    const later = deriveExceptions(facts({ ...one, people: [person({ missing: ['2026-08-10', '2026-08-11'] })] }));
    expect(later.map(x => x.id)).not.toContain(ts?.id);
  });
  test('the id is the key\'s', () => {
    const key = exceptionKey('Hours', 'CP-1042', '2026-08-10|Over contracted');
    expect(key).toBe('Hours|CP-1042|2026-08-10|Over contracted');
    expect(exceptionId(key)).toBe(exceptionId(key));
    expect(exceptionId(key)).not.toBe(exceptionId(`${key} `));
  });
});

describe('the state machine', () => {
  test('P\'s moves from each state, in its button order', () => {
    expect(movesFrom('open')).toEqual(['take', 'ignore']);
    expect(movesFrom('prog')).toEqual(['resolve', 'ignore', 'release']);
    expect(movesFrom('resolved')).toEqual(['reopen']);
    expect(movesFrom('ignored')).toEqual(['reopen']);
    expect(movesFrom('reopened')).toEqual(['take', 'resolve', 'ignore']);
    expect(Object.values(EXC_STATES).map(s => s.label)).toEqual(['Open', 'In progress', 'Resolved', 'Ignored', 'Reopened']);
  });
  test('an illegal move is refused naming what the state allows', () => {
    expect(moveProblem('open', 'resolve', 'done')).toEqual({ status: 409, code: 'ILLEGAL_TRANSITION',
      message: 'An open exception cannot move to resolved.', next: 'It can be taken or ignored.' });
    expect(moveProblem('resolved', 'take', '')).toMatchObject({ code: 'ILLEGAL_TRANSITION', message: 'A resolved exception cannot move to in progress.',
      next: 'It can be reopened.' });
    expect(moveProblem('prog', 'reopen', '')?.next).toBe('It can be resolved, ignored or moved back to open.');
  });
  test('resolve needs a note and ignore a reason; whitespace is not one', () => {
    expect(moveProblem('prog', 'resolve', '  ')).toBe(NOTE_REQUIRED);
    expect(moveProblem('open', 'ignore', '')).toBe(REASON_REQUIRED);
    expect(moveProblem('prog', 'resolve', 'Hours corrected')).toBeNull();
    expect(moveProblem('open', 'take', '')).toBeNull();
  });
  test('take makes the caller the owner, back to open clears it, and every move is a step of history', () => {
    const taken = applyMove(UNHANDLED, 'take', ME, 't1', '');
    expect(taken).toEqual({ state: 'prog', owner: ME, resolution: '', history: [{ from: 'open', to: 'prog', by: ME, at: 't1', note: '' }] });
    const other = { personCode: 'CP-2', name: 'Other' };
    const back = applyMove(taken, 'release', other, 't2', '');
    expect([back.state, back.owner, back.history.length]).toEqual(['open', null, 2]);
    const done = applyMove(taken, 'resolve', other, 't2', ' Hours corrected ');
    expect([done.state, done.owner, done.resolution, done.history.at(-1)?.note]).toEqual(['resolved', ME, 'Hours corrected', 'Hours corrected']);
    const reopened = applyMove(done, 'reopen', ME, 't3', '');
    expect([reopened.state, reopened.resolution, reopened.history.length]).toEqual(['reopened', 'Hours corrected', 3]);
    expect(MOVE_TO.reopen).toBe('reopened');
  });
  test('the audit act names the state reached', () => {
    expect([moveAuditAct('take'), moveAuditAct('resolve'), moveAuditAct('release')]).toEqual(['Exception in progress', 'Exception resolved', 'Exception open']);
  });
});

describe('the screen\'s filters', () => {
  test('Needs action is open, in progress and reopened; the counts follow', () => {
    expect(['open', 'prog', 'reopened', 'resolved', 'ignored'].map(s => needsAction(s as never))).toEqual([true, true, true, false, false]);
    expect(filterCounts(['open', 'prog', 'resolved', 'ignored', 'reopened'])).toEqual({ open: 3, prog: 1, resolved: 1, ignored: 1, all: 5 });
    expect(inFilter('all', 'ignored')).toBe(true);
  });
  test('search reads who, what and the kind', () => {
    const x = { subject: 'Amara Okafor', text: 'Over maximum', kind: 'Compliance' };
    expect([matches('amara', x), matches('compliance', x), matches('maximum', x), matches('nobody', x), matches(' ', x)]).toEqual([true, true, true, false, true]);
    expect([changesText(1), changesText(2)]).toEqual(['1 change', '2 changes']);
  });
});

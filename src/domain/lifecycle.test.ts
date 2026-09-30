import meta from '@/mocks/seed/meta.json';
import {
  LIFECYCLE, PERSON_STATES, STARTING_STATES, canMove, describeStates, isHere, isPersonState,
  nextStates, transitionProblem, type PersonState,
} from './lifecycle';

/* The guard table, written out in full so a change to the rules is a change to this test.
   Ported from the prototype's EMP_STATES (qnipay-workforce-v15.html, "IMP-013"). */
const ALLOWED: Record<PersonState, PersonState[]> = {
  candidate: ['preboard', 'archived'],
  preboard: ['active', 'archived'],
  active: ['suspended', 'onleave', 'leaver'],
  suspended: ['active', 'leaver'],
  onleave: ['active', 'leaver'],
  leaver: ['archived', 'active'],
  archived: ['active'],
};

describe('every from → to pair', () => {
  for (const from of PERSON_STATES) {
    for (const to of PERSON_STATES) {
      const allowed = ALLOWED[from].includes(to);
      test(`${from} → ${to} is ${allowed ? 'allowed' : 'refused'}`, () => {
        expect(canMove(from, to)).toBe(allowed);
        expect(transitionProblem(from, to) === null).toBe(allowed);
      });
    }
  }
});

test('the seven states are the prototype\'s, in its order', () => {
  expect(PERSON_STATES).toEqual(Object.keys(meta.empStates));
});

test('labels, tones and moves match the prototype table', () => {
  const proto = meta.empStates as Record<string, { label: string; pill: string; next: string[] }>;
  for (const s of PERSON_STATES) {
    const p = proto[s];
    if (!p) throw new Error(`meta.empStates has no ${s}`);
    expect(LIFECYCLE[s].label, s).toBe(p.label);
    expect(LIFECYCLE[s].tone, s).toBe(p.pill);
    expect([...LIFECYCLE[s].next], s).toEqual(p.next);
  }
});

test('no state moves to itself', () => {
  expect(PERSON_STATES.filter(s => canMove(s, s))).toEqual([]);
});

test('every state can move somewhere, so no record is stuck', () => {
  expect(PERSON_STATES.filter(s => nextStates(s).length === 0)).toEqual([]);
});

test('a refused move says what the record can do instead', () => {
  expect(transitionProblem('candidate', 'active')).toEqual({
    message: 'A candidate record cannot become active.',
    next: 'From Candidate it can move to Preboarding or Archived.',
  });
  expect(transitionProblem('onleave', 'archived')).toEqual({
    message: 'An on long leave record cannot become archived.',
    next: 'From On long leave it can move to Active or Leaver.',
  });
});

test('state lists read as a sentence', () => {
  expect(describeStates(['suspended', 'onleave', 'leaver'])).toBe('Suspended, On long leave or Leaver');
  expect(describeStates(['active'])).toBe('Active');
  expect(describeStates([])).toBe('');
});

test('leavers and archived records are not "here"; everyone else is', () => {
  expect(PERSON_STATES.filter(isHere)).toEqual(['candidate', 'preboard', 'active', 'suspended', 'onleave']);
});

test('a new record starts as a candidate, preboarding or active, and nothing else', () => {
  expect([...STARTING_STATES]).toEqual(['candidate', 'preboard', 'active']);
});

test('isPersonState accepts the seven keys only', () => {
  expect(PERSON_STATES.every(isPersonState)).toBe(true);
  expect(isPersonState('terminated')).toBe(false);
  expect(isPersonState('Active')).toBe(false);
});

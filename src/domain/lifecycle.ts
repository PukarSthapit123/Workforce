/* The employment lifecycle. Ported from the prototype's EMP_STATES
   (qnipay-workforce-v15.html, "IMP-013 — EMPLOYEE LIFECYCLE"). Status is never
   free text: a person is in exactly one of these states, and moves only along
   `next`. The notes are the prototype's, rewritten without em-dash asides. */
export const PERSON_STATES = ['candidate', 'preboard', 'active', 'suspended', 'onleave', 'leaver', 'archived'] as const;
export type PersonState = (typeof PERSON_STATES)[number];
export type StateTone = 'ok' | 'warn' | 'err' | 'info' | 'neu';
export interface StateInfo { label: string; tone: StateTone; glyph: string; note: string; next: readonly PersonState[] }

export const LIFECYCLE: Record<PersonState, StateInfo> = {
  candidate: { label: 'Candidate', tone: 'neu', glyph: '○', next: ['preboard', 'archived'],
    note: 'Offered a role, not yet set up. No access, no rota, no timesheet.' },
  preboard: { label: 'Preboarding', tone: 'info', glyph: '◷', next: ['active', 'archived'],
    note: 'Being set up. Compliance and access are in progress. Not yet on the rota.' },
  active: { label: 'Active', tone: 'ok', glyph: '✓', next: ['suspended', 'onleave', 'leaver'],
    note: 'Working. Appears on the rota, submits time, counts toward coverage.' },
  suspended: { label: 'Suspended', tone: 'err', glyph: '✕', next: ['active', 'leaver'],
    note: 'Not to be offered shifts. Existing timesheets stand and still need approving.' },
  onleave: { label: 'On long leave', tone: 'warn', glyph: '☀', next: ['active', 'leaver'],
    note: 'Away for an extended period, such as maternity, a sabbatical or long-term sickness.' },
  leaver: { label: 'Leaver', tone: 'warn', glyph: '→', next: ['archived', 'active'],
    note: 'Leaving date set. Entitlement is reconciled and future shifts are released.' },
  archived: { label: 'Archived', tone: 'neu', glyph: '—', next: ['active'],
    note: 'Kept for audit and payroll history. Hidden from every working list.' },
};

export const isPersonState = (s: string): s is PersonState => (PERSON_STATES as readonly string[]).includes(s);
export const nextStates = (from: PersonState): readonly PersonState[] => LIFECYCLE[from].next;
export const canMove = (from: PersonState, to: PersonState): boolean => LIFECYCLE[from].next.includes(to);

/* what a new record may start as; anything later is reached by a transition */
export const STARTING_STATES = ['candidate', 'preboard', 'active'] as const;
/* the moves that release future shifts once Rota exists (sub-project 3) */
export const RELEASES_SHIFTS: readonly PersonState[] = ['leaver', 'suspended', 'archived'];
/* "Currently here": the default list leaves leavers and archived records out of the way */
export const isHere = (s: PersonState): boolean => s !== 'leaver' && s !== 'archived';

export function describeStates(states: readonly PersonState[]): string {
  const labels = states.map(s => LIFECYCLE[s].label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1) ?? ''}`;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'An' : 'A');

/* null when the move is allowed; otherwise the refusal, naming where the record can go */
export function transitionProblem(from: PersonState, to: PersonState): { message: string; next: string } | null {
  if (canMove(from, to)) return null;
  const f = LIFECYCLE[from], fromWord = f.label.toLowerCase();
  return {
    message: `${article(fromWord)} ${fromWord} record cannot become ${LIFECYCLE[to].label.toLowerCase()}.`,
    next: `From ${f.label} it can move to ${describeStates(f.next)}.`,
  };
}

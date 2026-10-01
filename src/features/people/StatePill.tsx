import type { ReactNode } from 'react';
import { ArrowRight, Check, Circle, Clock, Minus, Sun, X } from 'lucide-react';
import { Pill } from '@/ui';
import { LIFECYCLE, type PersonState } from '@/domain/lifecycle';

/* The prototype's state pill (empState(x).pill and .gly): the state's tone,
   its glyph and its label, so colour never carries the state on its own.
   The glyphs come from the shared icon set rather than the prototype's
   characters, one of which (☀) renders as an emoji. */
const GLYPH: Record<PersonState, ReactNode> = {
  candidate: <Circle />, preboard: <Clock />, active: <Check />, suspended: <X />, onleave: <Sun />, leaver: <ArrowRight />, archived: <Minus />,
};
/* In a list, the pill carries the state's note as its tip, as the
   prototype's mgrPeople does (v15:5675-5676); where the note is already
   written beside the pill (the record, the lifecycle dialog) it is not. */
export function StatePill({ testId, state, withNote }: { testId: string; state: PersonState; withNote?: boolean }) {
  const s = LIFECYCLE[state];
  return <Pill testId={testId} tone={s.tone} glyph={GLYPH[state]} note={withNote ? s.note : undefined}>{s.label}</Pill>;
}

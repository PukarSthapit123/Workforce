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
export function StatePill({ testId, state }: { testId: string; state: PersonState }) {
  const s = LIFECYCLE[state];
  return <Pill testId={testId} tone={s.tone} glyph={GLYPH[state]}>{s.label}</Pill>;
}

import { ClipboardList } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, CardNote, Pill, ScopeBadge, SettingRow, SwitchField } from '@/ui';
import type { OnboardingSetup, OnbStepRecord } from '@/api/onboarding';
import { ALWAYS_ASKED, STEP_UNAVAILABLE } from '@/domain/onboarding';

/* The Steps card, shared by the Default draft and a named template's draft:
   the switches come from the draft, the labels and descriptions from the one
   shared config. */
export function StepsCard({ setup, steps, fe, onChange }: {
  setup: OnboardingSetup; steps: readonly OnbStepRecord[]; fe(field: string): string | undefined; onChange(id: string, on: boolean): void;
}) {
  return (
    <AdminCard testId={tid.monb.card('steps')} icon={<ClipboardList />} title="Steps" tipTestId={tid.monb.tip('steps')}
      tip="The order a new starter works through. A step you switch off is not asked for at all.">
      {steps.map(s => {
        const at = setup.steps.find(x => x.id === s.id);
        const available = at?.available !== false;
        const err = fe(`steps.${s.id}`);
        return (
          <SettingRow key={s.id} testId={tid.monb.step(s.id)}
            title={<>{s.label}{s.fixed && <span className="ml-[6px]"><ScopeBadge>Always asked</ScopeBadge></span>}</>}
            desc={<>{s.desc}
              {!available && <span data-testid={tid.monb.stepNeeds(s.id)} className="mt-px block text-warn">
                {STEP_UNAVAILABLE}{at?.needs ? ` It needs ${at.needs}.` : ''}</span>}
              {err && <span data-testid={tid.monb.stepError(s.id)} role="alert" className="mt-px block text-err">{err}</span>}</>}>
            {s.fixed
              ? <Pill testId={tid.monb.stepOn(s.id)} tone="ok" glyph="✓">On</Pill>
              /* as the prototype, a step whose features are off cannot be switched either way */
              : <SwitchField testId={tid.monb.stepSwitch(s.id)} aria-label={`Ask for ${s.label}`} checked={s.on} disabled={!available}
                  onCheckedChange={v => onChange(s.id, v)} />}
          </SettingRow>);
      })}
      <CardNote>{ALWAYS_ASKED} Everything else is your choice.</CardNote>
    </AdminCard>);
}

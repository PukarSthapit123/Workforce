import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { tid } from '@/testids';
import { Button, Empty, Field, FieldGrid, SelectBox, SubHead, TextArea, TextInput, Wide } from '@/ui';
import {
  CONTACT_FIELDS, CONVICTIONS_FIELD, CONVICTION_DETAIL_FIELD, EMERGENCY_FIELDS, LOCKED_HINT, NO_QUALIFICATIONS, PERSONAL_FIELDS, QUALIFICATION_FIELDS,
  WORKING_TIME_FIELD, emptyContact, type EmergencyContact, type OnbData, type OnbField, type Qualification,
} from '@/domain/onboarding';
import type { OnbFeatures } from '@/api/onboarding';

/* The prototype's onbFieldRow (qnipay-workforce-v15.html:4322-4353) and the
   first four step bodies, onbPersonal, onbContact, onbEmergency and
   onbAdditional (4354-4421). A field carries the type its data actually is:
   a date opens a date picker, a phone number gets the dialling keypad, the
   national insurance number is upper case and length-limited. The field
   definitions are the domain's, so the server checks exactly what is drawn. */

/* A choice's value as a test id can carry it ("No, I do not opt out" -> no-i-do-not-opt-out). */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function FieldRow({ f, testId, value, onChange, error, today, required, disabled }: {
  f: OnbField; testId: string; value: string; onChange(v: string): void; error?: string | undefined; today: string; required?: boolean; disabled?: boolean;
}) {
  const req = required ?? f.req;
  const hint = f.locked ? LOCKED_HINT : f.hint;
  const control = f.type === 'select'
    ? <SelectBox testId={testId} value={value ? slug(value) : ''} placeholder="Choose" disabled={disabled || f.locked}
        options={(f.options ?? []).map(o => ({ value: slug(o), label: o }))}
        onValueChange={x => onChange((f.options ?? []).find(o => slug(o) === x) ?? '')} />
    : f.type === 'area'
      ? <TextArea testId={testId} value={value} disabled={disabled || f.locked} maxLength={1000} onChange={e => onChange(e.target.value)} />
      : <TextInput testId={testId} type={f.type} value={value} disabled={disabled || f.locked} placeholder={f.placeholder}
          maxLength={f.maxlength} autoComplete={f.autocomplete ?? (f.type === 'tel' ? 'tel' : f.type === 'email' ? 'email' : undefined)}
          inputMode={f.type === 'tel' ? 'tel' : f.type === 'email' ? 'email' : undefined} pattern={f.pattern}
          max={f.notAfterToday ? today : undefined} min={f.notBeforeToday ? today : undefined}
          className={f.uppercase ? 'uppercase placeholder:normal-case' : undefined} onChange={e => onChange(e.target.value)} />;
  const field = <Field label={f.label} required={req} tip={f.tip} {...(error ? { error } : hint ? { hint } : {})}>{control}</Field>;
  return f.wide ? <Wide>{field}</Wide> : field;
}

/* What the step bodies are given: the values on screen (saved, with any
   edits over them), a way to change them, and the inline error for a field. */
export interface StepProps {
  v: OnbData; features: OnbFeatures; today: string; disabled: boolean;
  set<K extends keyof OnbData>(section: K, value: OnbData[K]): void;
  error(field: string): string | undefined;
}

export function PersonalStep({ v, set, error, today, disabled, person }: StepProps & { person: { name: string; email: string } }) {
  const locked: Record<string, string> = { nm: person.name, email: person.email };
  return (
    <FieldGrid>
      {PERSONAL_FIELDS.map(f => (
        <FieldRow key={f.key} f={f} testId={tid.onb.field(f.key)} today={today} disabled={disabled} error={error(f.key)}
          value={f.locked ? locked[f.key] ?? '' : v.personal[f.key as keyof OnbData['personal']]}
          onChange={x => set('personal', { ...v.personal, [f.key]: x })} />))}
    </FieldGrid>);
}

export function ContactStep({ v, set, error, today, disabled }: StepProps) {
  return (
    <FieldGrid>
      {CONTACT_FIELDS.map(f => (
        <FieldRow key={f.key} f={f} testId={tid.onb.field(f.key)} today={today} disabled={disabled} error={error(f.key)}
          value={v.contact[f.key as keyof OnbData['contact']]} onChange={x => set('contact', { ...v.contact, [f.key]: x })} />))}
    </FieldGrid>);
}

/* .acard-sub (v15:1167-1168): one repeated record inside the step card. */
function SubCard({ testId, children }: { testId: string; children: ReactNode }) {
  return <div data-testid={testId} className="mb-sm rounded-control border p-md">{children}</div>;
}
const MAX_CONTACTS = 5, MAX_QUALS = 10;

/* Only the first contact is required; another can be added and removed. */
export function EmergencyStep({ v, set, error, today, disabled }: StepProps) {
  const list = v.emergency.length ? v.emergency : [emptyContact()];
  const change = (i: number, c: EmergencyContact) => set('emergency', list.map((x, n) => (n === i ? c : x)));
  return (
    <>
      {list.map((c, i) => (
        <SubCard key={i} testId={tid.onb.contact(i)}>
          <div className="mb-md flex items-center gap-sm">
            <div className="text-sm font-semibold">Contact {i + 1}</div>
            {i > 0 && <Button testId={tid.onb.contactRemove(i)} kind="ghost" small className="ml-auto" disabled={disabled}
              onClick={() => set('emergency', list.filter((_, n) => n !== i))}><Trash2 aria-hidden="true" /> Remove</Button>}
          </div>
          <FieldGrid>
            {EMERGENCY_FIELDS.map(f => (
              <FieldRow key={f.key} f={f} testId={tid.onb.contactField(i, f.key)} today={today} required={i === 0} disabled={disabled}
                error={error(`emergency.${i}.${f.key}`)} value={c[f.key as keyof EmergencyContact]}
                onChange={x => change(i, { ...c, [f.key]: x })} />))}
          </FieldGrid>
        </SubCard>))}
      {list.length < MAX_CONTACTS && <Button testId={tid.onb.contactAdd} kind="ghost" small disabled={disabled}
        onClick={() => set('emergency', [...list, emptyContact()])}>+ Add another contact</Button>}
    </>);
}

/* The statutory questions (D13): the convictions note and the working-time
   note are the prototype's words, kept as its tips. */
export function AdditionalStep({ v, set, error, today, disabled, features }: StepProps) {
  const a = v.additional;
  const put = (key: 'conv' | 'convDetail' | 'wtd', x: string) => set('additional', { ...a, [key]: x });
  const putQual = (i: number, q: Qualification) => set('additional', { ...a, quals: a.quals.map((x, n) => (n === i ? q : x)) });
  return (
    <>
      {(features.conv || features.wtd) && <FieldGrid>
        {features.conv && <FieldRow f={CONVICTIONS_FIELD} testId={tid.onb.field('conv')} today={today} disabled={disabled} error={error('conv')}
          value={a.conv} onChange={x => put('conv', x)} />}
        {features.conv && a.conv === 'Yes' && <FieldRow f={CONVICTION_DETAIL_FIELD} testId={tid.onb.field('convDetail')} today={today} disabled={disabled}
          error={error('convDetail')} value={a.convDetail} onChange={x => put('convDetail', x)} />}
        {features.wtd && <FieldRow f={WORKING_TIME_FIELD} testId={tid.onb.field('wtd')} today={today} disabled={disabled} error={error('wtd')}
          value={a.wtd} onChange={x => put('wtd', x)} />}
      </FieldGrid>}
      {features.qual && <>
        <SubHead>Qualifications</SubHead>
        {a.quals.length
          ? a.quals.map((q, i) => (
              <SubCard key={i} testId={tid.onb.qual(i)}>
                <FieldGrid>
                  {QUALIFICATION_FIELDS.map(f => (
                    <FieldRow key={f.key} f={f} testId={tid.onb.qualField(i, f.key)} today={today} disabled={disabled} error={error(`quals.${i}.${f.key}`)}
                      value={q[f.key as keyof Qualification]} onChange={x => putQual(i, { ...q, [f.key]: x })} />))}
                </FieldGrid>
                <Button testId={tid.onb.qualRemove(i)} kind="ghost" small disabled={disabled}
                  onClick={() => set('additional', { ...a, quals: a.quals.filter((_, n) => n !== i) })}><Trash2 aria-hidden="true" /> Remove</Button>
              </SubCard>))
          : <Empty testId={tid.onb.noQuals}>{NO_QUALIFICATIONS}</Empty>}
        {a.quals.length < MAX_QUALS && <Button testId={tid.onb.qualAdd} kind="ghost" small disabled={disabled}
          onClick={() => set('additional', { ...a, quals: [...a.quals, { nm: '', by: '', exp: '' }] })}>+ Add a qualification</Button>}
      </>}
    </>);
}

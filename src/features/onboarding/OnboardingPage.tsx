import { useRef, useState, type ReactNode } from 'react';
import { ClipboardList, FileText, Folder, Lock, Megaphone, Shield, Users } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Banner, Button, CheckboxField, Fact, Field, FormWarn, Page, PageHead, Pill, Small, SubHead, TextInput, toastInfo, toastRefusal } from '@/ui';
import { ApiError } from '@/api/client';
import {
  useAckOnboardingPolicy, useMyOnboarding, useReadOnboardingPolicy, useSaveOnboardingStep, useSubmitOnboarding, useUploadOnboardingDocument,
  type OnboardingDetail, type OnbDocumentView, type OnbPolicyView, type OnbStepView, type SaveStep,
} from '@/api/onboarding';
import { outstandingText, type OnbData } from '@/domain/onboarding';
import { formatDmy } from '@/domain/time';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AdditionalStep, ContactStep, EmergencyStep, PersonalStep, type StepProps } from './OnbFields';
import { DocumentsStep } from './OnbDocuments';
import { DOC_DONE, PoliciesStep, PolicyList, ReadDialog } from './OnbPolicies';
import { readUpload, tooLarge } from './upload';

/* My work → Onboarding: the new starter's portal, the prototype's
   essOnboarding and onbSubmitted (qnipay-workforce-v15.html:4766-4804) with
   the onb-* handlers (10967-10983, 11434-11631). A rail of the steps asked,
   one step's body at a time, Back, the save dot and Save and continue, which
   is Submit to HR on the review step. Every write goes to the server and the
   screen follows its answer (no optimistic updates); a refusal with a field
   is shown at that field. Once submitted, the page thanks them, shows the
   reference, and reopens only what was sent back. There is no guide: the
   prototype has none for this page. */
export function OnboardingPage() {
  const q = useMyOnboarding();
  const refused = q.error instanceof ApiError ? q.error.refusal : null;
  const d = q.data;
  return (
    <Page testId={tid.page('onb')}>
      {q.isError && <>
        <PageHead title="My onboarding" crumb="My work · Onboarding" />
        <p data-testid={tid.onb.error} role="alert" className="text-err">
          {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Your onboarding could not be loaded. Reload the page to try again.'}</p>
      </>}
      {!d && !q.isError && <p data-testid={tid.onb.loading} className="text-text-secondary">Loading your onboarding&hellip;</p>}
      {d && (d.case.submittedAt ? <Submitted d={d} /> : <Portal d={d} />)}
    </Page>);
}

/* ------------------------------------------------------------ the writes */
/* The five writes to the one case, shared by the portal and the submitted
   page. busy: any of them in flight, so no second write goes out on a version
   the first is about to change. */
function useCaseWrites(d: OnboardingDetail) {
  const save = useSaveOnboardingStep(), upload = useUploadOnboardingDocument(), read = useReadOnboardingPolicy();
  const ack = useAckOnboardingPolicy(), submit = useSubmitOnboarding();
  const caseRef = { id: d.case.id, version: d.case.version };
  const busy = save.anyPending || upload.anyPending || read.anyPending || ack.anyPending || submit.anyPending;
  /* the document an upload was last sent for, so a refusal of it shows on its row */
  const [sentFor, setSentFor] = useState('');
  const [tooBig, setTooBig] = useState<{ doc: string; message: string } | null>(null);
  const [reading, setReading] = useState<OnbPolicyView | null>(null);

  /* D3: a file over the limit is refused before it is read; anything else is
     read here (an image becomes a small preview) and sent. */
  const onFile = (doc: OnbDocumentView, file: File) => {
    upload.clearFieldErrors();
    const bad = tooLarge(file);
    if (bad) { setTooBig({ doc: doc.id, message: bad.message }); toastRefusal(bad); return; }
    setTooBig(null);
    setSentFor(doc.id);
    void readUpload(file).then(f => upload.mutate({ case: caseRef, doc: doc.id, file: f }, { onSuccess: r => toastInfo(r.summary) }));
  };
  const docError = (id: string) => (tooBig?.doc === id ? tooBig.message : undefined)
    ?? (sentFor === id ? upload.fieldError('file') : undefined) ?? save.fieldError(`docs.${id}`);
  const onAck = (p: OnbPolicyView, on: boolean) => ack.mutate({ case: caseRef, policy: p.id, on }, { onSuccess: r => toastInfo(r.summary) });
  const onRead = (p: OnbPolicyView) => {
    setReading(p);
    if (!p.read) read.mutate({ case: caseRef, policy: p.id });
  };
  const readDialog = reading && <ReadDialog p={d.policies.find(x => x.id === reading.id) ?? reading} busy={busy} onClose={() => setReading(null)}
    onAck={() => ack.mutate({ case: caseRef, policy: reading.id, on: true }, { onSuccess: r => { setReading(null); toastInfo(r.summary); } })} />;
  return { save, submit, caseRef, busy, onFile, docError, onAck, onRead, readDialog };
}

/* ------------------------------------------------------------ the portal */
type Edits = { [K in keyof OnbData]?: OnbData[K] } & { signature?: string };
const ICON: Record<string, ReactNode> = {
  personal: <FileText />, contact: <Megaphone />, emergency: <Users />, additional: <Shield />, documents: <Folder />, policies: <Lock />, review: <ClipboardList />,
};
const isDone = (s: Pick<OnbStepView, 'state'>) => s.state === 'done' || s.state === 'verified';
/* What a step's Save sends: only that step's section (the server reads no other). */
function sectionOf(id: string, v: OnbData, signature: string): Omit<SaveStep, 'mode'> {
  switch (id) {
    case 'personal': return { personal: v.personal };
    case 'contact': return { contact: v.contact };
    case 'emergency': return { emergency: v.emergency };
    case 'additional': return { additional: v.additional };
    case 'documents': return { documents: v.documents };
    case 'review': return { signature };
    default: return {};
  }
}

function Portal({ d }: { d: OnboardingDetail }) {
  const w = useCaseWrites(d);
  const { save, submit } = w;
  const top = useRef<HTMLDivElement>(null);
  const [stepId, setStepId] = useState<string>(d.steps[0]?.id ?? 'personal');
  const [edits, setEdits] = useState<Edits>({});
  const [consent, setConsent] = useState(d.case.consent);
  const i = Math.max(0, d.steps.findIndex(s => s.id === stepId));
  const st = d.steps[i];
  if (!st) return null;
  const saved = d.case.data;
  const v: OnbData = {
    personal: { ...saved.personal, ...edits.personal }, contact: { ...saved.contact, ...edits.contact },
    emergency: edits.emergency ?? saved.emergency, additional: edits.additional ?? saved.additional, documents: { ...saved.documents, ...edits.documents },
  };
  const signature = edits.signature ?? d.case.signature;
  const dirty = Object.keys(edits).length > 0;

  const move = (to: string) => {
    setEdits({});
    save.clearFieldErrors();
    submit.clearFieldErrors();
    setStepId(to);
    top.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };
  /* Back and the rail save what is on screen without judging it (quiet). */
  const go = (to: string) => {
    if (to === st.id) return;
    if (!dirty) { move(to); return; }
    save.mutate({ case: w.caseRef, step: st.id, body: { mode: 'quiet', ...sectionOf(st.id, v, signature) } }, { onSuccess: () => move(to) });
  };
  /* Save and continue judges the step; done, it moves to the next one. */
  const next = () => save.mutate({ case: w.caseRef, step: st.id, body: { mode: 'check', ...sectionOf(st.id, v, signature) } }, { onSuccess: r => {
    toastInfo(r.summary);
    move(d.steps[i + 1]?.id ?? st.id);
  } });
  const send = () => submit.mutate({ case: w.caseRef, body: { consent, ...(d.features.sign ? { signature } : {}) } }, { onSuccess: r => toastInfo(r.summary) });

  const props: StepProps = {
    v, features: d.features, today: d.today, disabled: false,
    set: (section, value) => { save.clearFieldErrors(); setEdits(e => ({ ...e, [section]: value })); },
    error: field => save.fieldError(field),
  };
  const body = (() => {
    switch (st.id) {
      case 'personal': return <PersonalStep {...props} person={d.person} />;
      case 'contact': return <ContactStep {...props} />;
      case 'emergency': return <EmergencyStep {...props} />;
      case 'additional': return <AdditionalStep {...props} />;
      case 'documents': return <DocumentsStep {...props} disabled={w.busy} documents={d.documents} filesNote={d.filesNote} docError={w.docError} onFile={w.onFile} />;
      case 'policies': return <PoliciesStep policies={d.policies} disabled={w.busy} error={id => save.fieldError(`policies.${id}`)} onAck={w.onAck} onRead={w.onRead} />;
      case 'review': return <ReviewStep d={d} v={v} signature={signature} consent={consent} busy={w.busy}
        onSignature={x => { submit.clearFieldErrors(); setEdits(e => ({ ...e, signature: x })); }}
        onConsent={on => { submit.clearFieldErrors(); setConsent(on); }}
        error={field => submit.fieldError(field) ?? save.fieldError(field)} />;
      default: return null;
    }
  })();
  const general = [save.refusal, submit.refusal].find(r => r && (!r.field || r.field === 'step'));
  const dot = w.busy ? 'Saving' : dirty ? 'Changes not saved yet' : 'All changes saved';

  return (
    <>
      <PageHead title={`Welcome, ${d.person.first}`} crumb="My work · Onboarding" tipTestId={tid.onb.tip}
        tip={`A few things to complete before ${d.person.start ? formatDmy(d.person.start) : 'you start'}.`}
        actions={<Pill testId={tid.onb.progress} tone={d.progress.pc === 100 ? 'ok' : 'info'}>{d.progress.text}</Pill>} />
      <div ref={top} className="grid scroll-mt-[110px] grid-cols-[250px_1fr] items-start gap-lg max-[860px]:grid-cols-1">
        <nav data-testid={tid.onb.rail} aria-label="Onboarding steps"
          className="sticky top-[96px] flex flex-col gap-xs max-[860px]:static max-[860px]:flex-row max-[860px]:overflow-x-auto max-[860px]:pb-xs">
          {d.steps.map((s, n) => (
            <button key={s.id} type="button" data-testid={tid.onb.step(s.id)} aria-current={n === i ? 'step' : 'false'} onClick={() => go(s.id)}
              className={cn('relative flex w-full items-center gap-sm rounded-control border border-transparent px-md py-sm text-left hover:bg-surface-tint max-[860px]:w-auto max-[860px]:flex-none',
                n === i && 'border-border bg-surface-card hover:bg-surface-card')}>
              <span aria-hidden="true" className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                isDone(s) ? 'bg-ok-surface text-ok' : n === i ? 'bg-brand text-text-on-brand dark:bg-brand-accent dark:text-text-on-accent' : 'bg-surface-tint text-text-muted')}>
                {isDone(s) ? '✓' : n + 1}</span>
              <span className="min-w-0">
                <b className="block text-sm leading-[normal] font-semibold whitespace-nowrap text-text-primary">{s.label}</b>
                <span className="block text-xs leading-[normal] text-text-muted max-[860px]:sr-only">{s.stateLabel}</span>
              </span>
            </button>))}
        </nav>
        <div className="min-w-0">
          <AdminCard testId={tid.onb.body(st.id)} icon={ICON[st.id]} title={st.label} tip={st.desc} tipTestId={tid.onb.stepTip}>{body}</AdminCard>
          {general && <FormWarn testId={tid.onb.formWarn}>{general.message} {general.next}</FormWarn>}
          <div className="mt-md flex items-center gap-md">
            {i > 0 ? <Button testId={tid.onb.back} kind="ghost" pending={w.busy} className="max-[860px]:flex-1" onClick={() => {
              const prev = d.steps[i - 1];
              if (prev) go(prev.id);
            }}>‹ Back</Button> : <span />}
            <span data-testid={tid.onb.saved} role="status" className={cn('mx-auto text-xs whitespace-nowrap text-text-muted before:mr-[6px] before:inline-block before:size-[6px] before:rounded-full before:align-[1px] before:content-[\'\']',
              dirty || w.busy ? 'before:bg-text-muted' : 'before:bg-ok')}>{dot}</span>
            {st.id === 'review'
              ? <Button testId={tid.onb.submit} kind="primary" pending={w.busy} className="max-[860px]:flex-1" onClick={send}>Submit to HR</Button>
              : <Button testId={tid.onb.next} kind="primary" pending={w.busy} className="max-[860px]:flex-1" onClick={next}>Save and continue ›</Button>}
          </div>
        </div>
      </div>
      {w.readDialog}
    </>);
}

/* ------------------------------------------------------- review (onbReview) */
function ReviewStep({ d, v, signature, consent, busy, onSignature, onConsent, error }: {
  d: OnboardingDetail; v: OnbData; signature: string; consent: boolean; busy: boolean;
  onSignature(x: string): void; onConsent(on: boolean): void; error(field: string): string | undefined;
}) {
  const bl = d.toSubmit;
  const row = (key: string, label: string, value: string) => <Fact key={key} label={label} testId={tid.onb.review(key)}>{value || '—'}</Fact>;
  const contacts = v.emergency.filter(c => c.nm.trim());
  const consentError = error('consent');
  return (
    <>
      {bl.length
        ? <Banner testId={tid.onb.todo} tone="warn" title={`${bl.length} ${bl.length === 1 ? 'thing' : 'things'} still to do`}>{outstandingText(bl)}</Banner>
        : <Banner testId={tid.onb.complete} tone="ok" title="Everything is complete. Check it below, then submit." />}
      <SubHead>Personal</SubHead>
      {row('name', 'Name', d.person.name)}
      {row('dob', 'Date of birth', v.personal.dob ? formatDate(v.personal.dob) : '')}
      {row('nat', 'Nationality', v.personal.nat)}
      {row('ni', 'National insurance', v.personal.ni)}
      <SubHead>Contact</SubHead>
      {row('mob', 'Mobile', v.contact.mob)}
      {row('address', 'Address', [v.contact.a1, v.contact.city, v.contact.post].filter(Boolean).join(', '))}
      <SubHead>Emergency</SubHead>
      {contacts.length ? contacts.map((c, n) => row(`contact-${n}`, c.rel || 'Contact', [c.nm, c.ph].filter(Boolean).join(' · '))) : row('contact', 'Contact', '')}
      <SubHead>Documents</SubHead>
      {d.documents.map(x => row(`doc-${x.id}`, x.label, x.stateLabel))}
      {d.features.sign && <>
        <SubHead>Signature</SubHead>
        <Field label="Type your full name to sign" {...(error('signature') ? { error: error('signature') } : { hint: 'This records that the information above is true and complete, with the date and time.' })}>
          <TextInput testId={tid.onb.sign} value={signature} maxLength={120} placeholder={d.person.name} autoComplete="name" disabled={busy}
            onChange={e => onSignature(e.target.value)} />
        </Field>
      </>}
      <SubHead>Confirm</SubHead>
      <label className={cn('flex cursor-pointer items-start gap-sm rounded-control border bg-surface-card p-md', consent && DOC_DONE, consentError && 'border-err')}>
        <CheckboxField testId={tid.onb.consent} className="mt-[2px] shrink-0" checked={consent} disabled={busy} aria-invalid={consentError ? 'true' : undefined}
          aria-describedby={consentError ? tid.onb.consentError : undefined} onCheckedChange={on => onConsent(on === true)} />
        <span className="min-w-0">
          <span className="block text-sm font-[650]">I confirm the information above is true and complete</span>
          <span className="mt-[2px] block text-xs text-text-secondary">Knowingly giving false information may affect your employment.</span>
        </span>
      </label>
      {consentError && <p id={tid.onb.consentError} data-testid={tid.onb.consentError} className="mt-xs text-xs text-err">{consentError}</p>}
    </>);
}

/* -------------------------------------------------- submitted (onbSubmitted) */
/* The thank-you page, with the reference. The prototype's "come back here to
   correct it" is said as the build works: a rejected document reopens its
   step here; anything else goes through the manager. What was sent back, and
   any policy asked again after a new version, can be done from here. */
function Submitted({ d }: { d: OnboardingDetail }) {
  const w = useCaseWrites(d);
  /* a required document rejected reopens the step; an optional one can simply be sent again */
  const reopened = d.case.steps.documents === 'prog';
  const sentBack = reopened || d.documents.some(x => x.state === 'rejected');
  const askedAgain = d.policies.filter(p => !p.acknowledged);
  return (
    <>
      <PageHead title={`Thank you, ${d.person.first}`} crumb="My work · Onboarding" tipTestId={tid.onb.tip} tip="Your information has been sent to HR." />
      <div data-testid={tid.onb.submitted}>
        <AdminCard icon={<ClipboardList />} title="Submitted" tip="What happens next" tipTestId={tid.onb.submittedTip}>
          <Fact label="Reference" testId={tid.onb.ref}><span className="tabular-nums">{d.case.ref}</span></Fact>
          <Fact label="Submitted" testId={tid.onb.submittedAt}>{formatDateTime(d.case.submittedAt)}</Fact>
          <Small testId={tid.onb.whatNext} className="mt-[10px]">HR will check your documents. If one is rejected you will be told why, and its step opens
            again here so you can send a new one. For anything else that needs changing, ask your manager. There is nothing else for you to do now.</Small>
        </AdminCard>
      </div>
      {sentBack && <SentBack d={d} w={w} reopened={reopened} />}
      {askedAgain.length > 0 && <section data-testid={tid.onb.askedAgain}>
        <AdminCard icon={<Lock />} title="Policies to read again" desc="A policy has changed since you acknowledged it. Read the new version, then tick it.">
          <PolicyList policies={askedAgain} disabled={w.busy} lockTicks error={() => undefined} onAck={w.onAck} onRead={w.onRead} />
        </AdminCard>
      </section>}
      {w.readDialog}
    </>);
}

/* A required document HR rejected reopens the documents step (D4): upload it
   again, then save the step. */
function SentBack({ d, w, reopened }: { d: OnboardingDetail; w: ReturnType<typeof useCaseWrites>; reopened: boolean }) {
  const { save } = w;
  const [rtw, setRtw] = useState<OnbData['documents'] | null>(null);
  const v: OnbData = { ...d.case.data, documents: rtw ?? d.case.data.documents };
  const done = () => save.mutate({ case: w.caseRef, step: 'documents', body: { mode: 'check', documents: v.documents } }, { onSuccess: r => {
    setRtw(null);
    toastInfo(r.summary);
  } });
  return (
    <section data-testid={tid.onb.sentBack}>
      <AdminCard icon={<Folder />} title="Documents sent back"
        desc={reopened ? 'HR could not accept a document. Upload a new one, then save this step.' : 'HR could not accept a document. Upload a new one if you have it.'}>
        <DocumentsStep v={v} features={d.features} today={d.today} disabled={w.busy} set={(_, x) => { save.clearFieldErrors(); setRtw(x as OnbData['documents']); }}
          error={f => save.fieldError(f)} documents={d.documents} filesNote={d.filesNote} docError={w.docError} onFile={w.onFile} />
        {reopened && <div className="mt-md flex justify-end">
          <Button testId={tid.onb.next} kind="primary" pending={w.busy} onClick={done}>Save and continue ›</Button>
        </div>}
      </AdminCard>
    </section>);
}

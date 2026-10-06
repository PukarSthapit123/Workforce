import { useState } from 'react';
import { ClipboardList, Folder } from 'lucide-react';
import { tid } from '@/testids';
import {
  ActionBar, AdminCard, Button, Card, CardNote, Caution, Empty, FormWarn, Page, PageHead, Pill, Row, ScopeBadge, SettingRow, SettingSelect, SwitchField,
  toastInfo,
} from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useOnboardingSetup, useSaveOnboardingConfig, type OnboardingSetup, type UpdateOnboardingConfig } from '@/api/onboarding';
import { useTenant } from '@/shell/shellData';
import { versionKey } from '@/lib/latest';
import { ALWAYS_ASKED, REQUIRED_CHANGE_WARNING, STEP_UNAVAILABLE, isVerifier, stepsAsked } from '@/domain/onboarding';
import { DENSE_TEXT, PoliciesCard } from './OnbSetupPolicies';

/* Qnipay setup → Modules → Onboarding → Onboarding setup: the prototype's
   admOnboarding (qnipay-workforce-v15.html:4672-4728) with its step switch,
   document setting and verified-by handlers (10951-10966, 12829-12839).
   The step switches and the document settings edit one draft: Save sends the
   whole config with If-Match and writes one audit row with the before and
   after, Cancel puts it back (brief D2). The prototype applied each change as
   it was made. Steps are switched, never added or reordered (D11): the three
   fixed ones are always asked, and a step whose features are off under
   Modules and features cannot be switched and says why. Each policy is its own
   row with its own actions (OnbSetupPolicies.tsx). There is no guide: the
   prototype has none for this page. */
const CRUMB = 'Modules · Onboarding · Onboarding setup';
const OFF = 'The Onboarding module is off for this tenant. Turn it on under Modules & features.';

export function OnboardingSetupPage() {
  const tenant = useTenant();
  const on = tenant.data?.modules.ON === true;
  const setup = useOnboardingSetup(on);
  const refused = setup.error instanceof ApiError ? setup.error.refusal : null;
  return (
    <Page testId={tid.page('monb')}>
      <PageHead title="Onboarding setup" crumb={CRUMB} tipTestId={tid.head.tip('monb')}
        tip="What a new starter completes, what they must prove, and who checks it"
        actions={tenant.data && !on ? undefined : <Caution testId={tid.head.caution('monb')} text={REQUIRED_CHANGE_WARNING} />} />
      {tenant.data && !on && <Card><Empty testId={tid.monb.off}>{OFF}</Empty></Card>}
      {on && (setup.data
        /* the draft starts again from what the server holds whenever the config gets a new version: after a save, or after a 412 */
        ? <>
            <SetupDraftView key={versionKey(setup.data.config)} setup={setup.data} />
            <PoliciesCard policies={setup.data.policies} />
          </>
        : !setup.isError && <p data-testid={tid.monb.loading} className="text-text-secondary">Loading Onboarding setup&hellip;</p>)}
      {(setup.isError || tenant.isError) && <p data-testid={tid.monb.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Onboarding setup could not be loaded. Reload the page.'}</p>}
    </Page>);
}

const draftOf = (c: OnboardingSetup['config']): UpdateOnboardingConfig =>
  ({ steps: c.steps.map(s => ({ ...s })), documents: c.documents.map(d => ({ ...d })) });
type DocKey = 'req' | 'blocks' | 'expiry';

function SetupDraftView({ setup }: { setup: OnboardingSetup }) {
  const { config, features } = setup;
  const [draft, setDraft] = useState<UpdateOnboardingConfig>(() => draftOf(config));
  const save = useSaveOnboardingConfig();
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(config));
  const fe = save.fieldError;
  const inUse = stepsAsked(draft, features).length;
  const setStep = (id: string, on: boolean) => setDraft(d => ({ ...d, steps: d.steps.map(s => (s.id === id ? { ...s, on } : s)) }));
  const setDoc = (id: string, patch: Partial<UpdateOnboardingConfig['documents'][number]>) =>
    setDraft(d => ({ ...d, documents: d.documents.map(x => (x.id === id ? { ...x, ...patch } : x)) }));
  /* the server's summary is the toast: a switched step says people part-way through keep what they gave */
  const submit = () => save.mutate({ config, body: draft }, { onSuccess: d => toastInfo(d.summary) });
  const cancel = () => { setDraft(draftOf(config)); save.clearFieldErrors(); };

  return (
    <>
      <AdminCard testId={tid.monb.card('steps')} icon={<ClipboardList />} title="Steps" tipTestId={tid.monb.tip('steps')}
        tip="The order a new starter works through. A step you switch off is not asked for at all."
        desc={<span data-testid={tid.monb.stepsCount}>{inUse} of {draft.steps.length} steps in use</span>}>
        {draft.steps.map(s => {
          const at = setup.steps.find(x => x.id === s.id);
          const available = at?.available !== false;
          const err = fe(`steps.${s.id}`);
          return (
            <SettingRow key={s.id} testId={tid.monb.step(s.id)}
              title={<>{s.label}{s.fixed && <ScopeBadge>Always asked</ScopeBadge>}</>}
              desc={<>{s.desc}
                {!available && <span data-testid={tid.monb.stepNeeds(s.id)} className="mt-px block text-warn">
                  {STEP_UNAVAILABLE}{at?.needs ? ` It needs ${at.needs}.` : ''}</span>}
                {err && <span data-testid={tid.monb.stepError(s.id)} role="alert" className="mt-px block text-err">{err}</span>}</>}>
              {s.fixed
                ? <Pill testId={tid.monb.stepOn(s.id)} tone="ok" glyph="✓">On</Pill>
                /* as the prototype, a step whose features are off cannot be switched either way */
                : <SwitchField testId={tid.monb.stepSwitch(s.id)} aria-label={`Ask for ${s.label}`} checked={s.on} disabled={!available}
                    onCheckedChange={v => setStep(s.id, v)} />}
            </SettingRow>);
        })}
        <CardNote>{ALWAYS_ASKED} Everything else is your choice.</CardNote>
      </AdminCard>

      <AdminCard testId={tid.monb.card('documents')} icon={<Folder />} title="Documents" tipTestId={tid.monb.tip('documents')}
        tip="What a new starter must provide. Who verifies each one, and whether an unverified document stops them starting, are set per document."
        desc="What they must provide, and who checks it">
        <Table data-testid={tid.monb.docs} dense className={DENSE_TEXT}>
          <TableHeader><TableRow>
            <TableHead>Document</TableHead><TableHead>Required</TableHead><TableHead>Verified by</TableHead>
            <TableHead>Blocks start</TableHead><TableHead>Expiry tracked</TableHead>
          </TableRow></TableHeader>
          <TableBody>{draft.documents.map(d => {
            const err = fe(`documents.${d.id}.verify`) ?? fe(`documents.${d.id}`);
            const sw = (k: DocKey, words: string, testId: string) => (
              <TableCell><SwitchField testId={testId} aria-label={`${d.label} ${words}`} checked={d[k]} onCheckedChange={v => setDoc(d.id, { [k]: v })} /></TableCell>);
            return (
              <Row key={d.id} testId={tid.monb.doc(d.id)}>
                <TableCell><strong>{d.label}</strong><span className="block text-xs text-text-muted">{d.hint}</span></TableCell>
                {sw('req', 'required', tid.monb.docReq(d.id))}
                <TableCell>
                  <SettingSelect testId={tid.monb.docVerify(d.id)} small aria-label={`${d.label} verified by`} value={d.verify}
                    aria-invalid={err ? true : undefined} onChange={e => { const v = e.target.value; if (isVerifier(v)) setDoc(d.id, { verify: v }); }}>
                    {setup.verifiers.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}</SettingSelect>
                  {err && <p role="alert" className="mt-xs text-xs text-err">{err}</p>}
                </TableCell>
                {sw('blocks', 'blocks start', tid.monb.docBlocks(d.id))}
                {sw('expiry', 'expiry tracked', tid.monb.docExpiry(d.id))}
              </Row>);
          })}</TableBody>
        </Table>
      </AdminCard>

      {save.refusal && <FormWarn testId={tid.monb.warn}>{save.refusal.message} {save.refusal.next}</FormWarn>}
      {/* Save and Cancel stay in reach while a change waits to be saved */}
      <ActionBar stuck={dirty}>
        {dirty && <span data-testid={tid.monb.dirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        <Button testId={tid.monb.cancel} kind="ghost" disabled={!dirty || save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.monb.save} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>
    </>);
}

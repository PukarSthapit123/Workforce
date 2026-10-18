import { useState } from 'react';
import { Folder } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Button, CardNote, ConfirmModal, Field, FieldGrid, FormWarn, Modal, Row, ScopeBadge, SettingSelect, SwitchField, TextInput, Wide, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  useAddOnboardingDocument, useRemoveOnboardingDocument, useRenameOnboardingDocument, type OnbDocumentRecord, type OnboardingSetup,
} from '@/api/onboarding';
import { documentProblem, isVerifier, verifierLabel } from '@/domain/onboarding';
import { DENSE_TEXT } from './OnbSetupPolicies';

/* The Documents card of Onboarding setup (admOnboarding, v15:4690-4704). The
   settings of each document are part of the page's draft and apply on Save.
   Module 8: a document can be switched off, so a new starter is not asked for
   it; the tenant can add its own (a DBS check, a professional registration),
   with the hint a new starter reads, and rename or remove one it added. Each
   of those is a write of its own on the config, with one audit row, so they
   wait while the page has unsaved changes. A built-in document is switched
   off, never removed. Removing one that anybody's onboarding holds is
   refused, naming who (D2). The prototype had none of this. */
type DocKey = 'req' | 'blocks' | 'expiry' | 'on';
type Box = { k: 'add' } | { k: 'rename' | 'remove'; id: string } | null;

export function DocumentsCard({ setup, docs, locked, shared, fe, onChange }: {
  setup: OnboardingSetup; docs: readonly OnbDocumentRecord[]; locked: boolean; shared?: boolean;
  fe(field: string): string | undefined; onChange(id: string, patch: Partial<OnbDocumentRecord>): void;
}) {
  const [box, setBox] = useState<Box>(null);
  const remove = useRemoveOnboardingDocument();
  const close = () => setBox(null);
  const cur = box && box.k !== 'add' ? setup.config.documents.find(d => d.id === box.id) : undefined;
  return (
    <AdminCard testId={tid.monb.card('documents')} icon={<Folder />} title="Documents" tipTestId={tid.monb.tip('documents')}
      tip="What a new starter must provide. Who verifies each one, and whether an unverified document stops them starting, are set per document.">
      {/* a card per document on a phone (table.rec), as the prototype shows it */}
      <Table data-testid={tid.monb.docs} variant="records" dense className={DENSE_TEXT}>
        <TableHeader><TableRow>
          <TableHead>Document</TableHead><TableHead>Asked</TableHead><TableHead>Required</TableHead><TableHead>Verified by</TableHead>
          <TableHead>Blocks start</TableHead><TableHead>Expiry tracked</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{docs.map(d => {
          const err = fe(`documents.${d.id}.verify`) ?? fe(`documents.${d.id}`);
          const sw = (k: DocKey, words: string, testId: string, label: string) => (
            <TableCell label={label}>
              <SwitchField testId={testId} aria-label={`${d.label} ${words}`} checked={d[k]} onCheckedChange={v => onChange(d.id, { [k]: v })} /></TableCell>);
          return (
            <Row key={d.id} testId={tid.monb.doc(d.id)}>
              <TableCell kind="title"><strong>{d.label}</strong>
                {d.custom && <span className="ml-[6px]" data-testid={tid.monb.docCustom(d.id)}><ScopeBadge>Added here</ScopeBadge></span>}
                <span className="block text-xs font-normal text-text-muted">{d.hint}</span></TableCell>
              {sw('on', 'asked for', tid.monb.docOn(d.id), 'Asked')}
              {sw('req', 'required', tid.monb.docReq(d.id), 'Required')}
              {shared
                ? <TableCell label="Verified by"><span data-testid={tid.monb.docVerifyText(d.id)}>{verifierLabel(d.verify)}</span></TableCell>
                : <TableCell label="Verified by">
                <SettingSelect testId={tid.monb.docVerify(d.id)} small aria-label={`${d.label} verified by`} value={d.verify}
                  aria-invalid={err ? true : undefined} onChange={e => { const v = e.target.value; if (isVerifier(v)) onChange(d.id, { verify: v }); }}>
                  {setup.verifiers.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}</SettingSelect>
                {err && <p role="alert" className="mt-xs text-xs text-err">{err}</p>}
              </TableCell>}
              {sw('blocks', 'blocks start', tid.monb.docBlocks(d.id), 'Blocks start')}
              {shared
                ? <TableCell label="Expiry tracked"><span data-testid={tid.monb.docExpiryText(d.id)}>{d.expiry ? 'Yes' : 'No'}</span></TableCell>
                : sw('expiry', 'expiry tracked', tid.monb.docExpiry(d.id), 'Expiry tracked')}
              <TableCell kind="foot" empty={shared || !d.custom} className="text-right whitespace-nowrap">
                {!shared && d.custom && <span className="inline-flex gap-[6px] max-md:grid max-md:w-full max-md:grid-cols-2">
                  <Button testId={tid.monb.docRename(d.id)} kind="ghost" small disabled={locked} onClick={() => setBox({ k: 'rename', id: d.id })}>Rename</Button>
                  <Button testId={tid.monb.docRemove(d.id)} kind="ghost" small disabled={locked} onClick={() => setBox({ k: 'remove', id: d.id })}>Remove</Button>
                </span>}
              </TableCell>
            </Row>);
        })}</TableBody>
      </Table>
      {!shared && <div className="mt-lg flex flex-wrap gap-sm">
        <Button testId={tid.monb.docAdd} kind="ghost" small disabled={locked} onClick={() => setBox({ k: 'add' })}>Add a document</Button>
      </div>}
      {!shared && locked && <p data-testid={tid.monb.docLocked} className="mt-xs text-xs text-text-muted">Save or cancel the changes on this page before adding, renaming or removing a document.</p>}
      {shared
        ? <CardNote><span data-testid={tid.monb.docShared}>Verified by and Expiry tracked are set on the Default template and shared by every template.</span></CardNote>
        : <CardNote>A document switched off is not asked for. Built-in documents can be switched off, not removed. A document you added can be renamed, or removed while nobody is onboarding with it.</CardNote>}
      {box?.k === 'add' && <DocumentDialog setup={setup} onClose={close} />}
      {box?.k === 'rename' && cur && <DocumentDialog setup={setup} doc={cur} onClose={close} />}
      {box?.k === 'remove' && cur && <ConfirmModal open onOpenChange={o => { if (!o) close(); }} title={`Remove ${cur.label}?`}
        body="New starters will no longer be asked for it. It cannot be removed while anybody is onboarding with it." confirmLabel="Remove" danger busy={remove.anyPending}
        onConfirm={() => remove.mutate({ config: setup.config, doc: cur.id }, { onSuccess: r => { close(); toastInfo(r.summary); } })} />}
    </AdminCard>);
}

/* Add a document, or rename one this tenant added: its name and the hint a new
   starter reads. The rule the server applies is checked here first, so a
   missing or duplicate name is said in the form. */
function DocumentDialog({ setup, doc, onClose }: { setup: OnboardingSetup; doc?: OnbDocumentRecord; onClose(): void }) {
  const [f, setF] = useState({ label: doc?.label ?? '', hint: doc?.hint ?? '' });
  const [shown, setShown] = useState(false);
  const add = useAddOnboardingDocument(), rename = useRenameOnboardingDocument();
  const m = doc ? rename : add;
  const problem = documentProblem(f, setup.config.documents, doc?.id);
  const warn = (shown ? problem?.message : undefined) ?? m.fieldError('label') ?? m.fieldError('hint');
  const set = (p: Partial<typeof f>) => { setF(x => ({ ...x, ...p })); setShown(false); m.clearFieldErrors(); };
  const done = (r: { summary: string }) => { onClose(); toastInfo(r.summary); };
  const go = () => {
    if (problem) { setShown(true); return; }
    const body = { label: f.label, hint: f.hint };
    if (doc) rename.mutate({ config: setup.config, doc: doc.id, body }, { onSuccess: done });
    else add.mutate({ config: setup.config, body }, { onSuccess: done });
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={doc ? `Rename ${doc.label}` : 'Add a document'}
      footer={<>
        <Button testId={tid.monb.docCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.monb.docSave} kind="primary" pending={m.anyPending} onClick={go}>{doc ? 'Save' : 'Add document'}</Button>
      </>}>
      <FieldGrid>
        <Wide><Field label="Name" required>
          <TextInput testId={tid.monb.docName} placeholder="e.g. DBS check" maxLength={60} aria-invalid={warn ? true : undefined}
            value={f.label} onChange={e => set({ label: e.target.value })} /></Field></Wide>
        <Wide><Field label="Hint">
          <TextInput testId={tid.monb.docHint} placeholder="What counts, shown to the new starter beside the upload" maxLength={200}
            value={f.hint} onChange={e => set({ hint: e.target.value })} /></Field></Wide>
      </FieldGrid>
      {!doc && <p className="mt-md text-xs text-text-muted">It starts optional and checked by HR. Make it required, or change who checks it, in the list, then save.</p>}
      {warn && <FormWarn testId={tid.monb.docWarn}>{warn}</FormWarn>}
    </Modal>);
}

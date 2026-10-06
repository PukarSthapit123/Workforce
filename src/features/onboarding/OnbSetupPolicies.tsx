import { useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Button, CardNote, ConfirmModal, Empty, Field, FieldGrid, FormWarn, Modal, Row, Small, TextInput, Wide, toastInfo, toastRefusal } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  useAddOnboardingPolicy, useEditOnboardingPolicy, useRemoveOnboardingPolicy, useUploadOnboardingPolicy, type OnbPolicySetupView,
} from '@/api/onboarding';
import { DEFAULT_POLICY_VER, UPLOAD_ACCEPT, policyProblem } from '@/domain/onboarding';
import { FileCell } from './OnbDocuments';
import { readUpload, tooLarge } from './upload';

/* The Policies card of Onboarding setup (admOnboarding, v15:4705-4727) with
   the pol-upload, pol-add, pol-edit, pol-save, pol-del and pol-del-go
   handlers (11502-11592). Each policy is its own row and each action writes
   it at once, with one audit row (brief D2). A new upload raises the version
   and everyone who acknowledged the old one is asked again; the toast says
   how many (D10). Removing asks first. Uploads are simulated (D3): the file
   is read here, and only its name, size, type and an image's small preview
   are sent. */
/* table.dense (v15:478) sets its cells and headings at 14px as well as its padding */
export const DENSE_TEXT = 'md:[&_td]:text-sm md:[&_th]:text-sm';

type Box = { k: 'add' } | { k: 'edit' | 'remove'; id: string } | null;

export function PoliciesCard({ policies }: { policies: readonly OnbPolicySetupView[] }) {
  const [box, setBox] = useState<Box>(null);
  const [target, setTarget] = useState<OnbPolicySetupView | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadOnboardingPolicy(), remove = useRemoveOnboardingPolicy();
  const cur = box && box.k !== 'add' ? policies.find(p => p.id === box.id) : undefined;
  const close = () => setBox(null);
  const pick = (p: OnbPolicySetupView) => {
    setTarget(p);
    if (input.current) { input.current.value = ''; input.current.click(); }
  };
  const onFile = (p: OnbPolicySetupView, file: File) => {
    const bad = tooLarge(file);
    if (bad) { toastRefusal(bad); return; }
    void readUpload(file).then(f => upload.mutate({ policy: p, file: f }, { onSuccess: r => toastInfo(r.summary) }));
  };
  const n = policies.length;
  return (
    <AdminCard testId={tid.monb.card('policies')} icon={<Lock />} title="Policies" tipTestId={tid.monb.tip('policies')}
      tip="Upload the document a new starter has to read. Replacing it raises the version, and anybody who acknowledged the old one is asked again."
      desc={<span data-testid={tid.monb.polCount}>{n} document{n === 1 ? '' : 's'} to read and acknowledge</span>}>
      {n
        ? <Table data-testid={tid.monb.policies} dense className={DENSE_TEXT}>
            <TableHeader><TableRow>
              <TableHead>Policy</TableHead><TableHead>Version</TableHead><TableHead>Document</TableHead>
              <TableHead className="text-right">Acknowledged</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>{policies.map(p => (
              <Row key={p.id} testId={tid.monb.pol(p.id)}>
                <TableCell><strong>{p.label}</strong>{p.sum && <span className="block text-xs text-text-muted">{p.sum}</span>}</TableCell>
                <TableCell data-testid={tid.monb.polVer(p.id)} className="font-mono">{p.ver}</TableCell>
                <TableCell>{p.file
                  ? <FileCell f={p.file} testId={tid.monb.polFile(p.id)} />
                  /* the prototype points at "the extract below", which nothing on this page shows: say what a new starter reads instead */
                  : <span data-testid={tid.monb.polFile(p.id)} className="text-xs text-text-muted">
                      {p.body.length ? 'Nothing uploaded. New starters read the extract held here instead.' : 'Nothing uploaded yet.'}</span>}</TableCell>
                <TableCell data-testid={tid.monb.polAcks(p.id)} className="text-right tabular-nums">{p.ackCount}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <span className="inline-flex gap-[6px]">
                    <Button testId={tid.monb.polUpload(p.id)} kind="ghost" small pending={upload.isPending(`onboarding/policy/${p.id}`)}
                      onClick={() => pick(p)}>{p.file ? 'Replace' : 'Upload'}</Button>
                    <Button testId={tid.monb.polEdit(p.id)} kind="ghost" small onClick={() => setBox({ k: 'edit', id: p.id })}>Edit</Button>
                    <Button testId={tid.monb.polRemove(p.id)} kind="ghost" small onClick={() => setBox({ k: 'remove', id: p.id })}>Remove</Button>
                  </span>
                </TableCell>
              </Row>))}</TableBody>
          </Table>
        : <Empty testId={tid.monb.polsEmpty}>No policies yet. New starters are not asked to read anything.</Empty>}
      <div className="mt-lg flex flex-wrap gap-sm">
        <Button testId={tid.monb.polAdd} kind="primary" small onClick={() => setBox({ k: 'add' })}>Add a policy</Button>
      </div>
      <CardNote>Uploading a new document raises the version. Anybody who acknowledged an earlier version is asked again, because they agreed to something different.</CardNote>
      <input ref={input} type="file" accept={UPLOAD_ACCEPT} data-testid={tid.monb.filePick} aria-label="Choose a policy document to upload" className="hidden"
        onChange={e => { const file = e.target.files?.[0]; if (file && target) onFile(target, file); }} />
      {box?.k === 'add' && <PolicyDialog policies={policies} onClose={close} />}
      {box?.k === 'edit' && cur && <PolicyDialog policy={cur} policies={policies} onClose={close} />}
      {box?.k === 'remove' && cur && <ConfirmModal open onOpenChange={o => { if (!o) close(); }} title={`Remove ${cur.label}?`} body={cur.removeText}
        confirmLabel="Remove" danger busy={remove.anyPending}
        onConfirm={() => remove.mutate({ policy: cur }, { onSuccess: r => { close(); toastInfo(r.summary); } })} />}
    </AdminCard>);
}

/* pol-add and pol-edit (v15:11532-11552): the name, the version and what it
   covers, as the prototype has them. The domain rule the server applies is
   checked here first, so a missing or duplicate name is said in the form. */
function PolicyDialog({ policy, policies, onClose }: { policy?: OnbPolicySetupView; policies: readonly OnbPolicySetupView[]; onClose: () => void }) {
  const [f, setF] = useState({ label: policy?.label ?? '', ver: policy?.ver ?? DEFAULT_POLICY_VER, sum: policy?.sum ?? '' });
  const [shown, setShown] = useState(false);
  const add = useAddOnboardingPolicy(), edit = useEditOnboardingPolicy();
  const m = policy ? edit : add;
  const problem = policyProblem(f, policies, policy?.id);
  const warn = (shown ? problem?.message : undefined) ?? m.fieldError('label');
  const set = (p: Partial<typeof f>) => { setF(x => ({ ...x, ...p })); setShown(false); m.clearFieldErrors(); };
  const done = (r: { summary: string }) => { onClose(); toastInfo(r.summary); };
  const go = () => {
    if (problem) { setShown(true); return; }
    const body = { label: f.label, ver: f.ver, sum: f.sum };
    if (policy) edit.mutate({ policy, body }, { onSuccess: done });
    else add.mutate(body, { onSuccess: done });
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={policy ? policy.label : 'Add a policy'}
      footer={<>
        <Button testId={tid.monb.polCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.monb.polSave} kind="primary" pending={m.anyPending} onClick={go}>{policy ? 'Save' : 'Add policy'}</Button>
      </>}>
      <FieldGrid>
        <Wide><Field label="Name" required>
          <TextInput testId={tid.monb.polName} placeholder="e.g. Safeguarding policy" maxLength={80} aria-invalid={warn ? true : undefined}
            value={f.label} onChange={e => set({ label: e.target.value })} /></Field></Wide>
        <Field label="Version">
          <TextInput testId={tid.monb.polVersion} className="font-mono" placeholder={DEFAULT_POLICY_VER} maxLength={20} value={f.ver} onChange={e => set({ ver: e.target.value })} /></Field>
        <Wide><Field label="What it covers">
          <TextInput testId={tid.monb.polSum} placeholder="One line, shown to the new starter before they open it" maxLength={300}
            value={f.sum} onChange={e => set({ sum: e.target.value })} /></Field></Wide>
      </FieldGrid>
      <Small className="mt-md">Upload the document itself from the list once it exists.</Small>
      {warn && <FormWarn testId={tid.monb.polWarn}>{warn}</FormWarn>}
    </Modal>);
}

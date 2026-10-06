import { useRef, useState } from 'react';
import { tid } from '@/testids';
import { Banner, Button, Fact, FieldGrid, Modal, Pill, Small } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { Row } from '@/ui/Row';
import { RTW_TYPE_FIELD, UPLOAD_ACCEPT, fileSize } from '@/domain/onboarding';
import { formatDateTime } from '@/lib/format';
import type { OnbDocumentView, OnbFileRecord } from '@/api/onboarding';
import { FieldRow, type StepProps } from './OnbFields';

/* The prototype's onbDocuments, onbFileCell and the onb-upload and onb-view
   handlers (qnipay-workforce-v15.html:4377-4384, 4423-4447, 11477-11518). The
   right-to-work type, then a row per document asked: what it is, whether it is
   needed, what was sent, its state (with the reason a rejected one was sent
   back), View and Upload or Replace. Uploads are simulated (D3), and the step
   says so plainly. */

/* .onb-file (v15:1121-1130): a 40px thumbnail, or a PDF or FILE tile, beside the name and "size · when". */
export function FileCell({ f, testId }: { f: OnbFileRecord | null; testId: string }) {
  if (!f) return <span data-testid={testId} className="text-xs text-text-muted">—</span>;
  return (
    <span data-testid={testId} className="inline-flex min-w-0 items-center gap-sm">
      {f.preview
        ? <img src={f.preview} alt="" className="size-10 shrink-0 rounded-sm border bg-surface-tint object-cover" />
        : <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-sm border bg-surface-tint text-xs font-bold tracking-[.04em] text-text-muted">
            {f.kind === 'pdf' ? 'PDF' : 'FILE'}</span>}
      <span className="min-w-0">
        <b className="block max-w-[160px] truncate text-xs font-semibold">{f.name}</b>
        <span className="block text-xs text-text-muted">{fileSize(f.size)} · {formatDateTime(f.at)}</span>
      </span>
    </span>);
}

export function DocumentsStep({ v, set, error, today, disabled, features, documents, filesNote, docError, onFile }: StepProps & {
  documents: readonly OnbDocumentView[]; filesNote: string;
  docError(id: string): string | undefined;
  /* a file the person picked for a document; checked and read by the caller */
  onFile(doc: OnbDocumentView, file: File): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<OnbDocumentView | null>(null);
  const [viewing, setViewing] = useState<OnbDocumentView | null>(null);
  const pick = (d: OnbDocumentView) => {
    setTarget(d);
    if (input.current) { input.current.value = ''; input.current.click(); }
  };
  return (
    <>
      {features.rtw && <div className="mb-md"><FieldGrid>
        <FieldRow f={RTW_TYPE_FIELD} testId={tid.onb.field('rtwType')} today={today} disabled={disabled} error={error('rtwType')}
          value={v.documents.rtwType} onChange={x => set('documents', { ...v.documents, rtwType: x })} />
      </FieldGrid></div>}
      <Table data-testid={tid.onb.docs} variant="records" dense>
        <TableHeader><TableRow>
          <TableHead>Document</TableHead><TableHead>Needed</TableHead><TableHead>What you sent</TableHead><TableHead>State</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {documents.map(d => {
            const bad = docError(d.id);
            return (
              <Row key={d.id} testId={tid.onb.doc(d.id)}>
                <TableCell kind="title"><b className="font-bold">{d.label}</b><span className="block text-xs font-normal text-text-muted">{d.hint}</span></TableCell>
                <TableCell label="Needed">{d.req ? <Pill tone="warn">Required</Pill> : <span className="text-xs text-text-muted">Optional</span>}</TableCell>
                <TableCell label="What you sent"><FileCell f={d.file} testId={tid.onb.docFile(d.id)} /></TableCell>
                <TableCell label="State">
                  <span className="block">
                    <Pill testId={tid.onb.docState(d.id)} tone={d.tone} glyph={d.glyph}>{d.stateLabel}</Pill>
                    {d.state === 'rejected' && d.rejection && <span data-testid={tid.onb.docReason(d.id)} className="mt-xs block text-xs text-err">
                      Reason: {d.rejection}</span>}
                    {bad && <span data-testid={tid.onb.docError(d.id)} role="alert" className="mt-xs block max-w-[260px] text-xs text-err">{bad}</span>}
                  </span>
                </TableCell>
                <TableCell kind="foot" className="text-right whitespace-nowrap">
                  <span className="inline-flex gap-sm">
                    {d.file && <Button testId={tid.onb.docView(d.id)} kind="ghost" small onClick={() => setViewing(d)}>View</Button>}
                    <Button testId={tid.onb.docUpload(d.id)} kind="ghost" small pending={disabled} onClick={() => pick(d)}>{d.file ? 'Replace' : 'Upload'}</Button>
                  </span>
                </TableCell>
              </Row>);
          })}
        </TableBody>
      </Table>
      <Small testId={tid.onb.filesNote}>{filesNote}</Small>
      <input ref={input} type="file" accept={UPLOAD_ACCEPT} data-testid={tid.onb.filePick} aria-label="Choose a file to upload" className="hidden"
        onChange={e => { const file = e.target.files?.[0]; if (file && target) onFile(target, file); }} />
      {viewing && <ViewDialog d={documents.find(x => x.id === viewing.id) ?? viewing} disabled={disabled} onClose={() => setViewing(null)}
        onReplace={() => { const d = viewing; setViewing(null); pick(d); }} />}
    </>);
}

/* onb-view (v15:11499-11518): the image itself, or a note that only images
   are previewed here, and the file's name, size and when it was sent. */
function ViewDialog({ d, disabled, onClose, onReplace }: { d: OnbDocumentView; disabled: boolean; onClose(): void; onReplace(): void }) {
  const f = d.file;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={d.label} width="wide"
      footer={<>
        <Button testId={tid.onb.viewClose} kind="ghost" onClick={onClose}>Close</Button>
        <Button testId={tid.onb.viewReplace} kind="primary" pending={disabled} onClick={onReplace}>Replace</Button>
      </>}>
      {f?.preview
        ? <img data-testid={tid.onb.viewImage} src={f.preview} alt={d.label}
            className="mb-md max-h-[52vh] w-full rounded-control border bg-surface-sunken object-contain" />
        : <Banner testId={tid.onb.viewNoPreview} tone="info" title={f?.kind === 'pdf' ? 'A PDF was uploaded' : 'A file was uploaded'}>
            Only images are previewed here. The file itself is not kept in this build, only its name and size.</Banner>}
      {f && <>
        <Fact label="File">{f.name}</Fact>
        <Fact label="Size">{fileSize(f.size)}</Fact>
        <Fact label="Uploaded">{formatDateTime(f.at)}</Fact>
      </>}
    </Modal>);
}

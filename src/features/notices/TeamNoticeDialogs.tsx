import { useState } from 'react';
import { RotateCw, X } from 'lucide-react';
import { tid } from '@/testids';
import { Banner, Button, CheckboxField, CheckRow, Field, FieldGrid, FormWarn, Modal, NativeSelect, Pill, Row, Small, TextArea, TextInput, Tip, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  useCreateNotice, useDeleteNotice, useEditNotice, useNoticeTrack, usePinNotice, usePostNotice, useWithdrawNotice, type NoticeTrack, type PosterNotice, type ScopeOption,
} from '@/api/notices';
import { MUST_ACK_TIP, URGENT_TIP } from '@/domain/notices';
import { formatDateTime } from '@/lib/format';
import { NoticeMarks, StatusPill } from './NoticeParts';

/* noticeEditBox (qnipay-workforce-v15.html:5898-5930): a new notice, a
   draft or a live one. On a live one the audience is fixed and a warning
   says how many acknowledged the current version and will be asked again if
   the words change. A draft saves as a draft or posts; a live one saves its
   changes. The server checks the title, the text, the dates and the scope,
   and a refusal lands on its field. */
const FIELDS = ['title', 'body', 'scope', 'from', 'until'];
const keyOf = (s: { kind: string; code: string; loc: string }) => `${s.kind}:${s.code}:${s.loc}`;

export function EditDialog({ notice: n, scopes, org, today, onClose }: { notice?: PosterNotice; scopes: ScopeOption[]; org: boolean; today: string; onClose: () => void }) {
  const create = useCreateNotice(), edit = useEditNotice();
  const live = !!n && n.state !== 'draft';
  const options = n && !scopes.some(s => s.key === keyOf(n.scope)) ? [{ scope: n.scope, key: keyOf(n.scope), label: n.scopeLabel }, ...scopes] : scopes;
  const [title, setTitle] = useState(n?.title ?? ''), [body, setBody] = useState(n?.body ?? '');
  const [scope, setScope] = useState(n ? keyOf(n.scope) : options[0]?.key ?? '');
  const [from, setFrom] = useState(n?.from ?? today), [until, setUntil] = useState(n?.until ?? '');
  const [mustAck, setMustAck] = useState(n?.mustAck ?? true), [pinned, setPinned] = useState(n?.pinned ?? false), [urgent, setUrgent] = useState(n?.urgent ?? false);
  const m = n ? edit : create;
  const touched = () => m.clearFieldErrors();
  const err = (f: string) => m.fieldError(f);
  const general = m.refusal && !FIELDS.includes(m.refusal.field ?? '') ? m.refusal : null;
  const chosen = options.find(o => o.key === scope)?.scope;
  const fields = { title, body, from, until, mustAck, pinned, urgent };
  const done = (r: { message: string }) => { toastInfo(r.message); onClose(); };
  const send = (post: boolean) => {
    if (!n) { if (chosen) create.mutate({ ...fields, scope: chosen, post }, { onSuccess: done }); return; }
    edit.mutate({ id: n.id, ifMatch: n.version, change: live ? fields : { ...fields, ...(chosen ? { scope: chosen } : {}), post } }, { onSuccess: done });
  };
  const pending = n ? edit.isPending(`notice/${n.id}`) : create.isPending('notices/new');
  const owed = live && n.mustAck ? n.acknowledged : 0;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={n ? `Edit notice ${n.id}` : 'New notice'}
      footer={<>
        <Button testId={tid.tnotices.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        {live
          ? <Button testId={tid.tnotices.save} kind="primary" pending={pending} onClick={() => send(false)}>Save changes</Button>
          : <>
              <Button testId={tid.tnotices.saveDraft} kind="secondary" pending={pending} onClick={() => send(false)}>Save draft</Button>
              <Button testId={tid.tnotices.postNow} kind="primary" pending={pending} onClick={() => send(true)}>Post</Button>
            </>}
      </>}>
      {n && owed > 0 && (
        <Banner testId={tid.tnotices.resetWarn} tone="warn" icon={<RotateCw />} title={`${owed} ${owed === 1 ? 'person has' : 'people have'} acknowledged v${n.textVersion}`}>
          Changing the title or text makes this v{n.textVersion + 1}. They will be asked to acknowledge again. Their v{n.textVersion} acknowledgement stays on record.</Banner>)}
      <Field label="Title" error={err('title')}>
        <TextInput testId={tid.tnotices.title} maxLength={90} value={title} onChange={e => { setTitle(e.target.value); touched(); }} />
      </Field>
      <Field label="Notice" error={err('body')}>
        <TextArea testId={tid.tnotices.body} rows={5} value={body} onChange={e => { setBody(e.target.value); touched(); }} />
      </Field>
      <Field label="Who it is for" error={err('scope')}
        hint={live ? 'The audience is fixed once a notice is live. Withdraw it and post a new one to reach different people.'
          : org ? 'Any location or department, or everyone.' : 'Your location, or a department within it.'}>
        <NativeSelect testId={tid.tnotices.scope} value={scope} disabled={live} onChange={e => { setScope(e.target.value); touched(); }}>
          {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </NativeSelect>
      </Field>
      <FieldGrid>
        <Field label="Shows from" error={err('from')}>
          <TextInput testId={tid.tnotices.from} type="date" value={from} onChange={e => { setFrom(e.target.value); touched(); }} />
        </Field>
        <Field label="Ends" error={err('until')} hint="Optional. After this date the notice moves to Expired.">
          <TextInput testId={tid.tnotices.until} type="date" value={until} onChange={e => { setUntil(e.target.value); touched(); }} />
        </Field>
      </FieldGrid>
      <CheckRow control={<CheckboxField testId={tid.tnotices.mustAck} checked={mustAck} onCheckedChange={v => { setMustAck(v === true); touched(); }} />}
        tip={<Tip testId={tid.tnotices.mustAckTip} text={MUST_ACK_TIP} />}>Must acknowledge</CheckRow>
      <CheckRow control={<CheckboxField testId={tid.tnotices.pinned} checked={pinned} onCheckedChange={v => { setPinned(v === true); touched(); }} />}>Pin to the top</CheckRow>
      <CheckRow control={<CheckboxField testId={tid.tnotices.urgent} checked={urgent} onCheckedChange={v => { setUrgent(v === true); touched(); }} />}
        tip={<Tip testId={tid.tnotices.urgentTip} text={URGENT_TIP} />}>Urgent</CheckRow>
      {general && <FormWarn testId={tid.tnotices.warn}>{general.message} <span className="opacity-90">{general.next}</span></FormWarn>}
    </Modal>);
}

/* noticeTrackBox (5931-5965): the notice, a withdrawn banner with its reason,
   who has acknowledged the current version among the people the poster can
   see, the earlier versions and the notice's own audit trail; then what the
   poster may do: a draft is deleted, edited or posted; a live one deleted
   (refused, with how to withdraw instead), withdrawn, pinned or edited. */
export function TrackDialog({ id, onClose, onEdit, onWithdraw }: {
  id: string; onClose: () => void; onEdit: (n: PosterNotice) => void; onWithdraw: (n: PosterNotice) => void;
}) {
  const q = useNoticeTrack(id);
  const pin = usePinNotice(), post = usePostNotice(), del = useDeleteNotice();
  const t = q.data, n = t?.notice;
  const key = `notice/${id}`;
  const footer = (
    <>
      <Button testId={tid.tnotices.trackClose} kind="ghost" onClick={onClose}>Close</Button>
      {n?.mine && n.state === 'draft' && <>
        <Button testId={tid.tnotices.trackDelete} kind="ghost" pending={del.isPending(key)}
          onClick={() => del.mutate({ id, ifMatch: n.version }, { onSuccess: r => { toastInfo(r.message); onClose(); } })}>Delete draft</Button>
        <Button testId={tid.tnotices.trackEdit} kind="secondary" onClick={() => onEdit(n)}>Edit</Button>
        <Button testId={tid.tnotices.trackPost} kind="primary" pending={post.isPending(key)}
          onClick={() => post.mutate({ id, ifMatch: n.version }, { onSuccess: r => { toastInfo(r.message); onClose(); } })}>Post</Button>
      </>}
      {n?.mine && n.state === 'live' && <>
        <Button testId={tid.tnotices.trackDelete} kind="ghost" pending={del.isPending(key)}
          onClick={() => del.mutate({ id, ifMatch: n.version }, { onSuccess: r => { toastInfo(r.message); onClose(); } })}>Delete</Button>
        <Button testId={tid.tnotices.trackWithdraw} kind="ghost" onClick={() => onWithdraw(n)}>Withdraw</Button>
        <Button testId={tid.tnotices.trackPin} kind="secondary" pending={pin.isPending(key)}
          onClick={() => pin.mutate({ id, pinned: !n.pinned, ifMatch: n.version }, { onSuccess: r => toastInfo(r.message) })}>{n.pinned ? 'Unpin' : 'Pin'}</Button>
        <Button testId={tid.tnotices.trackEdit} kind="primary" onClick={() => onEdit(n)}>Edit</Button>
      </>}
    </>);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} width="wide" title={n?.title ?? 'Notice'} footer={footer}>
      {!t && <p className="text-text-secondary" role={q.isError ? 'alert' : undefined}>{q.isError ? 'This notice could not be loaded. Reload the page.' : 'Loading the notice…'}</p>}
      {t && <TrackBody t={t} />}
    </Modal>);
}

function TrackBody({ t }: { t: NoticeTrack }) {
  const n = t.notice, done = t.people.filter(p => p.acknowledged).length;
  return (
    <>
      <div data-testid={tid.tnotices.trackMeta} className="flex flex-wrap items-center gap-xs text-xs text-text-muted">
        <NoticeMarks urgent={n.urgent} pinned={n.pinned} /><StatusPill status={n.status} />
        <span>{n.id} · v{n.textVersion} · {n.scopeLabel} · {n.by}</span>
      </div>
      {n.state === 'withdrawn' && <div className="mt-md"><Banner testId={tid.tnotices.trackWithdrawn} tone="err" icon={<X />} title="Withdrawn">{n.withdrawReason}</Banner></div>}
      <div data-testid={tid.tnotices.trackBody} className="my-md text-sm whitespace-pre-wrap">{n.body}</div>
      {n.mustAck && n.state !== 'draft' && <>
        <h4 data-testid={tid.tnotices.trackAcks} className="mt-lg mb-sm text-sm font-semibold">Acknowledgements · {done} of {t.people.length}</h4>
        <Table data-testid={tid.tnotices.trackTable} variant="records" dense>
          <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Location</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {t.people.length ? t.people.map(p => (
              <Row key={p.code} testId={tid.tnotices.trackRow(p.code)}>
                <TableCell kind="title"><b>{p.name}</b></TableCell>
                <TableCell label="Location">{p.location}</TableCell>
                <TableCell label="Status">
                  {p.acknowledged
                    ? <Pill testId={tid.tnotices.trackStatus(p.code)} tone="ok">v{p.textVersion} · {p.at ? formatDateTime(p.at) : ''}</Pill>
                    : <Pill testId={tid.tnotices.trackStatus(p.code)} tone="warn">{p.textVersion ? `Outstanding · had v${p.textVersion}` : 'Outstanding'}</Pill>}
                </TableCell>
              </Row>))
              : <Row testId={tid.tnotices.trackNobody}><TableCell colSpan={3} className="text-xs text-text-muted">Nobody you can see is in this audience.</TableCell></Row>}
          </TableBody>
        </Table>
      </>}
      {n.history.length > 0 && <div data-testid={tid.tnotices.history}>
        <h4 className="mt-lg mb-sm text-sm font-semibold">Earlier versions</h4>
        {[...n.history].reverse().map(h => (
          <div key={h.textVersion} data-testid={tid.tnotices.historyRow(h.textVersion)} className="border-b py-[11px] last:border-b-0">
            <div className="text-sm font-semibold">v{h.textVersion} · {h.title}</div>
            <Small>{h.by} · {formatDateTime(h.at)}</Small>
            <Small className="whitespace-pre-wrap">{h.body}</Small>
          </div>))}
      </div>}
      <h4 className="mt-lg mb-sm text-sm font-semibold">Audit trail</h4>
      <div data-testid={tid.tnotices.trail}>
        {t.trail.length
          ? t.trail.map(x => <Small key={x.id} testId={tid.tnotices.trailRow(x.id)}>{formatDateTime(x.at)} · {x.who} · {x.act}{x.detail ? ` · ${x.detail}` : ''}</Small>)
          : <Small testId={tid.tnotices.trailEmpty}>Nothing recorded yet.</Small>}
      </div>
    </>);
}

/* noticeWithdrawBox (5966-5975): withdrawing needs a reason. */
export function WithdrawDialog({ notice: n, onClose }: { notice: PosterNotice; onClose: () => void }) {
  const w = useWithdrawNotice();
  const [reason, setReason] = useState('');
  const general = w.refusal && w.refusal.field !== 'reason' ? w.refusal : null;
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Withdraw ${n.title}`}
      description="Colleagues stop seeing it. The notice, its versions and every acknowledgement stay on record."
      footer={<>
        <Button testId={tid.tnotices.withdrawCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.tnotices.withdrawOk} kind="primary" pending={w.isPending(`notice/${n.id}`)}
          onClick={() => w.mutate({ id: n.id, reason, ifMatch: n.version }, { onSuccess: r => { toastInfo(r.message); onClose(); } })}>Withdraw</Button>
      </>}>
      <Field label="Reason" required error={w.fieldError('reason')}>
        <TextArea testId={tid.tnotices.reason} rows={3} placeholder="Why it is being withdrawn" value={reason}
          onChange={e => { setReason(e.target.value); w.clearFieldErrors(); }} />
      </Field>
      {general && <FormWarn testId={tid.tnotices.withdrawWarn}>{general.message} <span className="opacity-90">{general.next}</span></FormWarn>}
    </Modal>);
}


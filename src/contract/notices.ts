/* 1c group 6: the notice board (brief D10). A reader lists the notices
   aimed at them and acknowledges one at the textVersion they read; a poster
   lists what they manage, drafts, posts, edits, pins, withdraws (with a
   reason), deletes drafts and tracks who has acknowledged. `version` is the
   record's concurrency counter (If-Match); `textVersion` is the version of
   the words, which only a title or text change on a live notice moves on.
   Every endpoint is refused while the notice board is switched off. */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta } from './common';
import { IsoDate } from './people';

/* the same as src/domain/notices.ts (the contract test holds them together) */
export const ScopeKind = z.enum(['all', 'loc', 'dept']);
export const NoticeStatus = z.enum(['draft', 'current', 'scheduled', 'expired', 'withdrawn']);
export type NoticeStatus = z.infer<typeof NoticeStatus>;
export const NoticeScope = z.strictObject({ kind: ScopeKind, code: z.string().max(20), loc: z.string().max(20) });
export type NoticeScope = z.infer<typeof NoticeScope>;
const Until = IsoDate.or(z.literal(''));

const NoticeBase = RecordMeta.extend({
  textVersion: z.number().int().positive(), title: z.string(), body: z.string(), scope: NoticeScope, scopeLabel: z.string(),
  pinned: z.boolean(), urgent: z.boolean(), mustAck: z.boolean(), from: IsoDate, until: Until, status: NoticeStatus, by: z.string(), at: IsoDateTime,
});
/* A notice as its reader sees it, with where they stand on it. */
export const ReaderState = z.enum(['info', 'acknowledged', 'again', 'owed']);
export type ReaderState = z.infer<typeof ReaderState>;
export const ReaderNotice = NoticeBase.extend({ you: ReaderState, acknowledgedAt: IsoDateTime.nullable(), owed: z.boolean() });
export type ReaderNotice = z.infer<typeof ReaderNotice>;
export const MyNotices = z.object({
  /* current and expired notices aimed at me, urgent, then pinned, then newest */
  items: z.array(ReaderNotice),
  counts: z.object({ current: z.number().int(), expired: z.number().int() }),
  owed: z.number().int(),
});
export type MyNotices = z.infer<typeof MyNotices>;

/* A notice as a poster manages it. `mine` is false for an organisation
   notice outside the poster's scope, shown read-only. */
const OldText = z.object({ textVersion: z.number().int(), title: z.string(), body: z.string(), by: z.string(), at: IsoDateTime });
export const PosterNotice = NoticeBase.extend({
  state: z.enum(['draft', 'live', 'withdrawn']), withdrawReason: z.string(), mine: z.boolean(),
  audience: z.number().int(), acknowledged: z.number().int(), history: z.array(OldText),
});
export type PosterNotice = z.infer<typeof PosterNotice>;
export const ScopeOption = z.object({ scope: NoticeScope, key: z.string(), label: z.string() });
export type ScopeOption = z.infer<typeof ScopeOption>;
export const StatusFilter = z.enum(['all', 'draft', 'current', 'scheduled', 'expired', 'withdrawn']);
export type StatusFilter = z.infer<typeof StatusFilter>;
export const PostedNotices = z.object({
  items: z.array(PosterNotice),
  counts: z.record(StatusFilter, z.number().int()),
  /* where this poster may post, and whether that is everyone (notice_org) or their own location */
  scopes: z.array(ScopeOption), org: z.boolean(), location: z.string(),
  /* the server's date, which a new notice shows from unless another is chosen */
  today: IsoDate,
});
export type PostedNotices = z.infer<typeof PostedNotices>;
export const TrackRow = z.object({
  code: z.string(), name: z.string(), location: z.string(),
  /* the latest version they acknowledged and when; acknowledged only when that is the current one */
  acknowledged: z.boolean(), textVersion: z.number().int().nullable(), at: IsoDateTime.nullable(),
});
export const NoticeTrack = z.object({
  notice: PosterNotice,
  /* the audience the poster can see: everyone with notice_org, otherwise their own location */
  people: z.array(TrackRow),
  trail: z.array(z.object({ id: z.string(), at: IsoDateTime, who: z.string(), act: z.string(), detail: z.string() })),
});
export type NoticeTrack = z.infer<typeof NoticeTrack>;

const Fields = {
  title: z.string().max(90), body: z.string().max(4000), from: IsoDate.or(z.literal('')), until: Until,
  mustAck: z.boolean(), pinned: z.boolean(), urgent: z.boolean(),
};
export const CreateNotice = z.strictObject({ ...Fields, scope: NoticeScope, post: z.boolean() });
export type CreateNotice = z.infer<typeof CreateNotice>;
/* The scope may be sent only while the notice is a draft; post sends a draft live as it is saved. */
export const EditNotice = z.strictObject({ ...Fields, scope: NoticeScope.optional(), post: z.boolean().optional() });
export type EditNotice = z.infer<typeof EditNotice>;
export const NoticeSaved = z.object({ record: PosterNotice, auditId: z.string().nullable(), message: z.string() });
export type NoticeSaved = z.infer<typeof NoticeSaved>;
export const Acknowledge = z.strictObject({ textVersion: z.number().int().positive() });
export const Acknowledged = z.object({ record: ReaderNotice, auditId: z.string(), message: z.string() });
export type Acknowledged = z.infer<typeof Acknowledged>;
export const Withdraw = z.strictObject({ reason: z.string().max(300) });
export const Pin = z.strictObject({ pinned: z.boolean() });
export const NoticeDeleted = z.object({ auditId: z.string(), message: z.string() });
export type NoticeDeleted = z.infer<typeof NoticeDeleted>;

const IdParams = z.object({ id: z.string().min(1).max(20) });
const READ = 'own_notices', POST = 'notice_post';
export const listMyNotices = defineEndpoint({ method: 'GET', path: '/api/v1/notices/mine', response: MyNotices, capability: READ,
  summary: 'The current and expired notices aimed at me, worked out from my record now, with where I stand on each and how many I owe' });
export const getMyNotice = defineEndpoint({ method: 'GET', path: '/api/v1/notices/mine/:id', params: IdParams, response: ReaderNotice, capability: READ, errors: [404],
  summary: 'One notice I can read' });
export const acknowledgeNotice = defineEndpoint({ method: 'POST', path: '/api/v1/notices/:id/acknowledge', params: IdParams, request: Acknowledge, response: Acknowledged,
  capability: READ, errors: [404, 409],
  summary: 'Acknowledge the version I read. Not open (CLOSED), changed since I read it (CHANGED) or already done (ALREADY_ACKNOWLEDGED) is 409. One audit row.' });
export const listPostedNotices = defineEndpoint({ method: 'GET', path: '/api/v1/notices', query: z.object({ status: StatusFilter.optional() }), response: PostedNotices,
  capability: POST, summary: 'The notices a poster manages, draft first, with counts per status, and the scopes they may post to' });
export const trackNotice = defineEndpoint({ method: 'GET', path: '/api/v1/notices/:id/track', params: IdParams, response: NoticeTrack, capability: POST, errors: [404],
  summary: 'Who has acknowledged which version, among the people the poster can see, the earlier versions and the notice\'s audit trail' });
export const createNotice = defineEndpoint({ method: 'POST', path: '/api/v1/notices', request: CreateNotice, response: NoticeSaved, capability: POST, errors: [409],
  summary: 'Save a draft, or post it now. A scope outside the poster\'s is refused (403). Posting tells the audience (notice_posted). One audit row.' });
export const editNotice = defineEndpoint({ method: 'PATCH', path: '/api/v1/notices/:id', params: IdParams, request: EditNotice, response: NoticeSaved,
  capability: POST, versioned: true, errors: [404, 409],
  summary: 'Edit (If-Match). On a live notice a title or text change is a new textVersion and asks everyone again; the audience is fixed (AUDIENCE_FIXED). One audit row.' });
export const pinNotice = defineEndpoint({ method: 'PUT', path: '/api/v1/notices/:id/pin', params: IdParams, request: Pin, response: NoticeSaved,
  capability: POST, versioned: true, errors: [404, 409], summary: 'Pin or unpin (If-Match), without a new textVersion. One audit row.' });
export const postNotice = defineEndpoint({ method: 'POST', path: '/api/v1/notices/:id/post', params: IdParams, response: NoticeSaved,
  capability: POST, versioned: true, errors: [404, 409], summary: 'Send a draft live (If-Match) and tell its audience. One audit row.' });
export const withdrawNotice = defineEndpoint({ method: 'POST', path: '/api/v1/notices/:id/withdraw', params: IdParams, request: Withdraw, response: NoticeSaved,
  capability: POST, versioned: true, errors: [404, 409],
  summary: 'Withdraw a live notice with a reason (If-Match). It leaves colleagues\' view and stays on record with its acknowledgements. One audit row.' });
export const deleteNotice = defineEndpoint({ method: 'DELETE', path: '/api/v1/notices/:id', params: IdParams, response: NoticeDeleted,
  capability: POST, versioned: true, errors: [404, 409], summary: 'Delete a draft (If-Match). A notice that has been live is withdrawn instead (NOT_DRAFT). One audit row.' });

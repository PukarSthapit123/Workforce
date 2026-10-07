/* Module 5 Onboarding. One case per starter (brief D1), versioned on its own:
   every write to it carries If-Match on the case. The config (step switches
   and document settings) is one versioned record saved with Save (D2); each
   policy is a row of its own with its own actions and version. Every rule is
   the group 1 domain's (src/domain/onboarding.ts); the screens run the same
   rules only to warn early. Uploads are simulated (D3): the server keeps the
   file's name, size, type, time and, for an image, a small preview, nothing
   else. Activation is refused while start blockers remain (D6). No money
   anywhere (D14). With the Onboarding module off every endpoint refuses
   (module-off). */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta } from './common';
import { DateOrBlank, IsoDate, Person, PersonState } from './people';

const Tone = z.enum(['neu', 'info', 'warn', 'ok', 'err']);
/* the domain's STEP_IDS and TASK_STATES (src/domain/onboarding.ts) */
export const OnbStepId = z.enum(['personal', 'contact', 'emergency', 'additional', 'documents', 'policies', 'review']);
export const TaskState = z.enum(['todo', 'prog', 'done', 'verified', 'rejected']);
export const Verifier = z.enum(['hr', 'mgr', 'either', 'none']);

/* ------------------------------------------------------------- records */
/* What is kept of an upload (D3): an image carries a downscaled preview as a data URL. */
export const OnbFileRecord = z.object({
  name: z.string(), size: z.number().int().nonnegative(), type: z.string(), at: IsoDateTime, kind: z.enum(['image', 'pdf', 'file']),
  preview: z.string().optional(),
});
export type OnbFileRecord = z.infer<typeof OnbFileRecord>;
export const OnbStepRecord = z.object({ id: OnbStepId, label: z.string().max(60), on: z.boolean(), fixed: z.boolean(), desc: z.string().max(200) });
export type OnbStepRecord = z.infer<typeof OnbStepRecord>;
export const OnbDocumentRecord = z.object({
  id: z.string().max(20), label: z.string().max(60), req: z.boolean(), verify: Verifier, blocks: z.boolean(), expiry: z.boolean(), hint: z.string().max(200),
});
export type OnbDocumentRecord = z.infer<typeof OnbDocumentRecord>;
/* The config record (D2): step switches and document settings. */
export const OnboardingConfigRecord = RecordMeta.extend({ steps: z.array(OnbStepRecord), documents: z.array(OnbDocumentRecord) });
export type OnboardingConfigRecord = z.infer<typeof OnboardingConfigRecord>;
/* A policy row. `ver` is the document's own version ("v4.1"); `version` is the record's concurrency counter. */
export const OnbPolicyRecord = RecordMeta.extend({
  label: z.string(), ver: z.string(), sum: z.string(), body: z.array(z.string()), order: z.number().int(), file: OnbFileRecord.optional(),
});
export type OnbPolicyRecord = z.infer<typeof OnbPolicyRecord>;

const Contact = z.object({ nm: z.string(), rel: z.string(), ph: z.string() });
const Qual = z.object({ nm: z.string(), by: z.string(), exp: z.string() });
export const OnbDataRecord = z.object({
  personal: z.object({ dob: z.string(), gender: z.string(), nat: z.string(), ni: z.string() }),
  contact: z.object({ mob: z.string(), alt: z.string(), a1: z.string(), a2: z.string(), city: z.string(), post: z.string() }),
  emergency: z.array(Contact),
  additional: z.object({ conv: z.string(), convDetail: z.string(), wtd: z.string(), quals: z.array(Qual) }),
  documents: z.object({ rtwType: z.string() }),
});
const AtOrBlank = z.union([IsoDateTime, z.literal('')]);
/* The case (D1). steps and docs hold task states by id; acks the policy version acknowledged. */
export const OnboardingCaseRecord = RecordMeta.extend({
  personCode: z.string(), steps: z.record(z.string(), TaskState), docs: z.record(z.string(), TaskState), files: z.record(z.string(), OnbFileRecord),
  rejections: z.record(z.string(), z.string()), acks: z.record(z.string(), z.string()), read: z.record(z.string(), z.boolean()),
  data: OnbDataRecord, signature: z.string(), consent: z.boolean(), submittedAt: AtOrBlank, ref: z.string(), invitedAt: AtOrBlank, startedAt: AtOrBlank,
  /* what was asked when they submitted: the start is judged against it, never against a requirement added later */
  asked: z.object({ steps: z.array(OnbStepId), documents: z.array(z.object({ id: z.string(), req: z.boolean(), blocks: z.boolean() })) }).optional(),
});
export type OnboardingCaseRecord = z.infer<typeof OnboardingCaseRecord>;

/* ---------------------------------------------------------------- views */
export const OnbFeatures = z.object({
  rtw: z.boolean(), conv: z.boolean(), wtd: z.boolean(), qual: z.boolean(), pol: z.boolean(), sign: z.boolean(), verify: z.boolean(),
});
export type OnbFeatures = z.infer<typeof OnbFeatures>;
const StateShown = { state: TaskState, stateLabel: z.string(), tone: Tone, glyph: z.string() };
/* A step as asked: switched on (fixed ones always are) and available. */
export const OnbStepView = z.object({ id: OnbStepId, label: z.string(), desc: z.string(), fixed: z.boolean(), ...StateShown });
export type OnbStepView = z.infer<typeof OnbStepView>;
/* A document as asked, with what was uploaded and why it was rejected ('' otherwise). */
export const OnbDocumentView = OnbDocumentRecord.extend({ ...StateShown, verifierLabel: z.string(), file: OnbFileRecord.nullable(), sizeText: z.string(), rejection: z.string() });
export type OnbDocumentView = z.infer<typeof OnbDocumentView>;
/* acknowledged: this version is; read: opened since the last upload. */
export const OnbPolicyView = OnbPolicyRecord.extend({ acknowledged: z.boolean(), read: z.boolean() });
export type OnbPolicyView = z.infer<typeof OnbPolicyView>;
export const Blocker = z.object({ kind: z.enum(['step', 'doc']), id: z.string(), why: z.string() });
export type Blocker = z.infer<typeof Blocker>;
/* "3 of 7 done" */
export const OnbProgress = z.object({ done: z.number().int(), total: z.number().int(), pc: z.number().int(), text: z.string() });
export type OnbProgress = z.infer<typeof OnbProgress>;
export const OnbPerson = z.object({
  code: z.string(), id: z.string(), name: z.string(), first: z.string(), email: z.string(), start: DateOrBlank, state: PersonState, stateLabel: z.string(),
  stateTone: Tone, stateGlyph: z.string(), location: z.string(), locationName: z.string(), employeeType: z.string(), employeeTypeName: z.string(), manager: z.string(),
});
export type OnbPerson = z.infer<typeof OnbPerson>;
/* One starter's onboarding, as the portal and the tracker read it. toSubmit is
   what the person still has to do; toStart adds the checks only HR can make.
   open: the person can still change it (not submitted, or a step sent back). */
export const OnboardingDetail = z.object({
  person: OnbPerson, case: OnboardingCaseRecord, features: OnbFeatures, steps: z.array(OnbStepView), documents: z.array(OnbDocumentView),
  policies: z.array(OnbPolicyView), progress: OnbProgress, toSubmit: z.array(Blocker), toStart: z.array(Blocker), open: z.boolean(),
  /* "Submitted with reference ONB-1001. HR has been told.", or '' */
  submitted: z.string(),
  /* D3: said plainly on the documents step */
  filesNote: z.string(), today: IsoDate,
});
export type OnboardingDetail = z.infer<typeof OnboardingDetail>;
/* One starter's onboarding as the tracker reads it: what a manager needs to
   check the documents and see what stops the start, and none of the starter's
   own answers. No step data (date of birth, NI number, address, contacts,
   convictions), no signature, no consent. Strict, so a field added to the
   handler by mistake fails the response check instead of reaching the browser. */
export const StarterOnboarding = z.strictObject({
  person: OnbPerson, caseRef: z.object({ id: z.string(), version: z.number().int().nonnegative() }), steps: z.array(OnbStepView),
  documents: z.array(OnbDocumentView), progress: OnbProgress, toStart: z.array(Blocker), submittedAt: AtOrBlank, ref: z.string(),
});
export type StarterOnboarding = z.infer<typeof StarterOnboarding>;

/* ------------------------------------------------------------- my case */
const Text = (n = 200) => z.string().max(n);
/* What a step's Save sends: only the section for that step is read. check is
   Save and continue (judged, then done); quiet is Back or a rail jump. */
export const SaveStep = z.strictObject({
  mode: z.enum(['check', 'quiet']),
  personal: z.object({ dob: Text(10), gender: Text(40), nat: Text(60), ni: Text(20) }).partial().optional(),
  contact: z.object({ mob: Text(30), alt: Text(30), a1: Text(), a2: Text(), city: Text(80), post: Text(12) }).partial().optional(),
  emergency: z.array(z.object({ nm: Text(120), rel: Text(40), ph: Text(30) }).partial()).max(5).optional(),
  additional: z.object({ conv: Text(10), convDetail: Text(1000), wtd: Text(60), quals: z.array(z.object({ nm: Text(120), by: Text(120), exp: Text(10) }).partial()).max(10) })
    .partial().optional(),
  documents: z.object({ rtwType: Text(60) }).partial().optional(),
  signature: Text(120).optional(),
});
export type SaveStep = z.infer<typeof SaveStep>;
/* A file as the browser read it (D3). The size limit is the domain's, refused with its sentence. */
export const UploadFile = z.object({
  name: z.string().max(255), size: z.number().int().nonnegative(), type: z.string().max(120),
  preview: z.string().max(1_500_000).regex(/^data:image\/[a-z+]+;base64,/, 'The preview must be an image.').optional(),
});
export type UploadFile = z.infer<typeof UploadFile>;
export const AckPolicy = z.object({ on: z.boolean() });
export const SubmitOnboarding = z.object({ consent: z.boolean(), signature: Text(120).optional() });
export type SubmitOnboarding = z.infer<typeof SubmitOnboarding>;
/* auditId is null when nothing changed. summary is the toast. */
export const CaseChanged = z.object({ record: OnboardingCaseRecord, summary: z.string(), auditId: z.string().nullable() });
export type CaseChanged = z.infer<typeof CaseChanged>;
export const CaseSubmitted = CaseChanged.extend({ ref: z.string(), auditId: z.string() });
export type CaseSubmitted = z.infer<typeof CaseSubmitted>;

/* ----------------------------------------------------------------- team */
export const TrackerRow = z.object({
  person: OnbPerson, caseRef: z.object({ id: z.string(), version: z.number().int().nonnegative() }), progress: OnbProgress,
  /* start-stage blockers: what stops them becoming active */
  blockers: z.array(Blocker), canInvite: z.boolean(), submittedAt: AtOrBlank, ref: z.string(),
});
export type TrackerRow = z.infer<typeof TrackerRow>;
/* An uploaded document waiting on a check. */
export const OnbQueueRow = z.object({
  person: OnbPerson, caseRef: z.object({ id: z.string(), version: z.number().int().nonnegative() }),
  document: OnbDocumentRecord, file: OnbFileRecord, sizeText: z.string(),
});
export type OnbQueueRow = z.infer<typeof OnbQueueRow>;
/* The starters at the locations this person tracks (D5): their own, or every location with onb_cfg. */
export const TeamOnboarding = z.object({
  rows: z.array(TrackerRow), queue: z.array(OnbQueueRow), toVerify: z.number().int(), verify: z.boolean(),
  all: z.boolean(), locationName: z.string(),
  /* the caller's own location: where a new starter added from the tracker is placed by default */
  location: z.string(),
});
export type TeamOnboarding = z.infer<typeof TeamOnboarding>;
export const RejectDocument = z.object({ reason: z.string().max(300) });
/* Invite and Start them move the person along the lifecycle as well as the case. */
export const StarterMoved = CaseChanged.extend({ person: Person, auditId: z.string() });
export type StarterMoved = z.infer<typeof StarterMoved>;
export const StarterChased = z.object({ outstanding: z.number().int(), summary: z.string(), auditId: z.string() });
export type StarterChased = z.infer<typeof StarterChased>;

/* ---------------------------------------------------------------- setup */
export const OnbPolicySetupView = OnbPolicyRecord.extend({ ackCount: z.number().int(), removeText: z.string() });
export type OnbPolicySetupView = z.infer<typeof OnbPolicySetupView>;
/* available: its features exist; needs names them as Modules and features does. */
export const OnbStepSetup = z.object({ id: OnbStepId, available: z.boolean(), needs: z.string() });
export const OnboardingSetup = z.object({
  config: OnboardingConfigRecord, policies: z.array(OnbPolicySetupView), features: OnbFeatures, steps: z.array(OnbStepSetup),
  verifiers: z.array(z.object({ value: Verifier, label: z.string() })),
  /* people part-way through: candidates and preboarders with a case */
  inProgress: z.number().int(),
});
export type OnboardingSetup = z.infer<typeof OnboardingSetup>;
/* The whole config on Save (D2): the same steps and documents in the same order, only switches and settings changed. */
export const UpdateOnboardingConfig = z.strictObject({ steps: z.array(OnbStepRecord).max(10), documents: z.array(OnbDocumentRecord).max(20) });
export type UpdateOnboardingConfig = z.infer<typeof UpdateOnboardingConfig>;
export const OnboardingConfigSaved = z.object({ record: OnboardingConfigRecord, summary: z.string(), auditId: z.string().nullable() });
export type OnboardingConfigSaved = z.infer<typeof OnboardingConfigSaved>;
export const PolicyDraft = z.object({ label: z.string().max(80), ver: z.string().max(20).optional(), sum: z.string().max(300).optional() });
export type PolicyDraft = z.infer<typeof PolicyDraft>;
export const PolicySaved = z.object({ record: OnbPolicySetupView, summary: z.string(), auditId: z.string().nullable() });
export type PolicySaved = z.infer<typeof PolicySaved>;
/* asked: people whose acknowledgement the new version cleared (D10). */
export const PolicyUploaded = z.object({ record: OnbPolicySetupView, asked: z.number().int(), summary: z.string(), auditId: z.string() });
export type PolicyUploaded = z.infer<typeof PolicyUploaded>;
export const PolicyRemoved = z.object({ id: z.string(), summary: z.string(), auditId: z.string() });
export type PolicyRemoved = z.infer<typeof PolicyRemoved>;

/* ------------------------------------------------------------- endpoints */
const ByStep = z.object({ step: z.string().min(1) });
const ByDoc = z.object({ doc: z.string().min(1) });
const ByPolicy = z.object({ id: z.string().min(1) });
const ByPerson = z.object({ personCode: z.string().min(1) });
const ByPersonDoc = z.object({ personCode: z.string().min(1), doc: z.string().min(1) });

export const getMyOnboarding = defineEndpoint({ method: 'GET', path: '/api/v1/onboarding/me', response: OnboardingDetail, capability: 'own_onb', errors: [409],
  summary: 'My onboarding: the steps I am asked, my documents and policies, my progress and what is still to do. Only while I am a candidate or preboarding.' });
export const saveOnboardingStep = defineEndpoint({ method: 'PUT', path: '/api/v1/onboarding/me/steps/:step', params: ByStep, request: SaveStep, response: CaseChanged,
  capability: 'own_onb', versioned: true, errors: [404, 409],
  summary: 'Save a step of my onboarding (If-Match: the case). check judges it and marks it done; quiet saves without judging.' });
export const uploadOnboardingDocument = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/me/documents/:doc', params: ByDoc, request: UploadFile,
  response: CaseChanged, capability: 'own_onb', versioned: true, errors: [404, 409],
  summary: 'Upload or replace a document (If-Match: the case). Simulated: the name, size, type, time and an image preview are kept, nothing else.' });
export const readOnboardingPolicy = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/me/policies/:id/read', params: ByPolicy, response: CaseChanged,
  capability: 'own_onb', versioned: true, errors: [404, 409], summary: 'Record that I opened a policy (If-Match: the case)' });
export const ackOnboardingPolicy = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/me/policies/:id/ack', params: ByPolicy, request: AckPolicy,
  response: CaseChanged, capability: 'own_onb', versioned: true, errors: [404, 409],
  summary: 'Acknowledge a policy, or take the tick back (If-Match: the case). The version acknowledged is kept.' });
export const submitOnboarding = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/me/submit', request: SubmitOnboarding, response: CaseSubmitted,
  capability: 'own_onb', versioned: true, errors: [409],
  summary: 'Submit my onboarding to HR (If-Match: the case): every step done, the confirmation ticked, and a typed signature while signing is on' });

/* No single capability: the tracker and one starter's case are read with
   Track onboarding or Verify onboarding documents, which the handler checks;
   each action still needs its own. */
export const getTeamOnboarding = defineEndpoint({ method: 'GET', path: '/api/v1/onboarding/team', response: TeamOnboarding, errors: [403],
  summary: 'New starters at my location (every location with Configure onboarding): progress, state, what blocks the start, and documents waiting on a check' });
export const getStarterOnboarding = defineEndpoint({ method: 'GET', path: '/api/v1/onboarding/team/:personCode', params: ByPerson, response: StarterOnboarding,
  errors: [403, 404, 409], summary: 'One new starter\'s onboarding as the tracker reads it: progress, step and document states, the files to check and what blocks the start. None of their answers.' });
export const verifyOnboardingDocument = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/team/:personCode/documents/:doc/verify', params: ByPersonDoc,
  response: CaseChanged, capability: 'onb_verify', versioned: true, errors: [403, 404, 409],
  summary: 'Verify an uploaded document (If-Match: the case). The person is told.' });
export const rejectOnboardingDocument = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/team/:personCode/documents/:doc/reject', params: ByPersonDoc,
  request: RejectDocument, response: CaseChanged, capability: 'onb_verify', versioned: true, errors: [403, 404, 409],
  summary: 'Reject an uploaded document with a reason the person sees (If-Match: the case). A rejected required document reopens the documents step.' });
export const inviteStarter = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/team/:personCode/invite', params: ByPerson, response: StarterMoved,
  capability: 'onb_track', versioned: true, errors: [403, 404, 409],
  summary: 'Invite a candidate to complete onboarding (If-Match: the case): they move to preboarding. No email is sent in this build.' });
export const startStarter = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/team/:personCode/start', params: ByPerson, response: StarterMoved,
  capability: 'onb_track', versioned: true, errors: [403, 404, 409],
  summary: 'Make a new starter active (If-Match: the case). Refused while anything that blocks the start is outstanding.' });
export const chaseStarter = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/team/:personCode/chase', params: ByPerson, response: StarterChased,
  capability: 'onb_track', errors: [403, 404, 409], summary: 'Remind a new starter of what is outstanding. They are told in the app.' });

export const getOnboardingSetup = defineEndpoint({ method: 'GET', path: '/api/v1/onboarding/config', response: OnboardingSetup, capability: 'onb_cfg',
  summary: 'Onboarding setup: the step switches, the document settings, and the policies with their acknowledged counts' });
export const updateOnboardingConfig = defineEndpoint({ method: 'PUT', path: '/api/v1/onboarding/config', request: UpdateOnboardingConfig,
  response: OnboardingConfigSaved, capability: 'onb_cfg', versioned: true,
  summary: 'Save the step switches and document settings (If-Match). Steps are switched, never added or reordered. One audit row with before and after.' });
export const addOnboardingPolicy = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/policies', request: PolicyDraft, response: PolicySaved,
  capability: 'onb_cfg', errors: [409], summary: 'Add a policy new starters are asked to read. A name is needed and no two share one.' });
export const editOnboardingPolicy = defineEndpoint({ method: 'PATCH', path: '/api/v1/onboarding/policies/:id', params: ByPolicy, request: PolicyDraft,
  response: PolicySaved, capability: 'onb_cfg', versioned: true, errors: [404], summary: 'Edit a policy\'s name, version or summary (If-Match: the policy)' });
export const uploadOnboardingPolicy = defineEndpoint({ method: 'POST', path: '/api/v1/onboarding/policies/:id/file', params: ByPolicy, request: UploadFile,
  response: PolicyUploaded, capability: 'onb_cfg', versioned: true, errors: [404],
  summary: 'Upload a new document for a policy (If-Match: the policy). The version goes up and everyone who acknowledged it is asked again.' });
export const removeOnboardingPolicy = defineEndpoint({ method: 'DELETE', path: '/api/v1/onboarding/policies/:id', params: ByPolicy, response: PolicyRemoved,
  capability: 'onb_cfg', versioned: true, errors: [404],
  summary: 'Remove a policy (If-Match: the policy). New starters are no longer asked; past acknowledgements stay in the audit trail.' });

/* Onboarding rules. Ported from the prototype (qnipay-workforce-v15.html:
   ONB_STEPS, ONB_DOCS, ONB_VERIFIERS, ONB_POLICIES, ONB_STATES, nextPolVer,
   onbFor, readUpload, fileSize, onbStepAvailable, onbSteps, onbDocsFor,
   onbBlockers, onbProgress, onbFieldRow, onbSaveStep and the onb-upload,
   onb-ack, onb-submit, onb-verify, onb-reject, pol-upload, pol-save, pol-del
   and step switch handlers). Every function is pure: the config, the features,
   the clock and the case come in as arguments, so the server refuses with
   exactly what the screen says.

   One case per person (brief D1), holding task states, file records, policy
   acknowledgements by version, the step data, signature and consent. A person's
   own state stays the employee lifecycle; onboarding adds per-task states only.
   Uploads are simulated (D3): a file is its name, size, type, time and, for an
   image, a small preview. No money anywhere (D14).
   Messages are the prototype's, with each em-dash or "·" aside rewritten as
   its own sentence (listed in the module report). */
import { flagOn, type Switches } from './modules';
import { isIsoDate } from './time';

/* A refusal the server sends as it is: code, message and what to do next. */
export interface OnbRefusal { code: string; message: string; next: string; field?: string }
export type Outcome<T> = { ok: true; value: T } | { ok: false; refusal: OnbRefusal };
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const no = <T>(refusal: OnbRefusal): Outcome<T> => ({ ok: false, refusal });
const invalid = (field: string, message: string, next: string): OnbRefusal => ({ code: 'VALIDATION', message, next, field });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/* A record without one key. */
const without = <T>(rec: Readonly<Record<string, T>>, key: string): Record<string, T> => Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

/* ------------------------------------------------------------- config */
export const STEP_IDS = ['personal', 'contact', 'emergency', 'additional', 'documents', 'policies', 'review'] as const;
export type OnbStepId = (typeof STEP_IDS)[number];
export const isStepId = (s: string): s is OnbStepId => (STEP_IDS as readonly string[]).includes(s);
/* `on` is configuration; `fixed` marks the three a new starter cannot skip. */
export interface OnbStep { id: OnbStepId; label: string; on: boolean; fixed: boolean; desc: string }
export const VERIFIERS = [['hr', 'HR'], ['mgr', 'Line manager'], ['either', 'HR or line manager'], ['none', 'No check needed']] as const;
export type Verifier = (typeof VERIFIERS)[number][0];
export const isVerifier = (s: string): s is Verifier => VERIFIERS.some(([v]) => v === s);
export const verifierLabel = (v: string) => VERIFIERS.find(([k]) => k === v)?.[1] ?? v;
/* `verify` says who checks it; `blocks` whether an unverified one stops the start. */
export interface OnbDocument { id: string; label: string; req: boolean; verify: Verifier; blocks: boolean; expiry: boolean; hint: string }
export type FileKind = 'image' | 'pdf' | 'file';
/* What is kept of an upload (D3). `at` is an instant. */
export interface OnbFile { name: string; size: number; type: string; at: string; kind: FileKind; preview?: string }
/* `ver` is the document's own version ("v4.1"); a record's `version` is its concurrency counter. */
export interface OnbPolicy { id: string; label: string; ver: string; sum: string; body: string[]; order: number; file?: OnbFile }
/* The versioned config record (D2): step switches and document settings. Policies are rows of their own. */
export interface OnboardingConfig { steps: OnbStep[]; documents: OnbDocument[] }

/* ------------------------------------------------------------- features */
export interface OnbFeatures { rtw: boolean; conv: boolean; wtd: boolean; qual: boolean; pol: boolean; sign: boolean; verify: boolean }
export const FEATURE_FLAGS: Readonly<Record<keyof OnbFeatures, string>> = {
  rtw: 'ONB_RTW', conv: 'ONB_CONV', wtd: 'ONB_WTD', qual: 'ONB_QUAL', pol: 'ONB_POL', sign: 'ONB_SIGN', verify: 'ONB_VERIFY',
};
/* A feature counts only while the Onboarding module is on (flagOn). */
export function onbFeatures(modules: Switches, flags: Readonly<Record<string, unknown>>): OnbFeatures {
  const on = (k: keyof OnbFeatures) => flagOn(modules, flags, FEATURE_FLAGS[k]);
  return { rtw: on('rtw'), conv: on('conv'), wtd: on('wtd'), qual: on('qual'), pol: on('pol'), sign: on('sign'), verify: on('verify') };
}
export const ALL_FEATURES: OnbFeatures = { rtw: true, conv: true, wtd: true, qual: true, pol: true, sign: true, verify: true };

/* A step is shown when it is switched on and the features it depends on exist. */
export function stepAvailable(id: OnbStepId, f: OnbFeatures): boolean {
  if (id === 'additional') return f.conv || f.wtd || f.qual;
  if (id === 'policies') return f.pol;
  return true;
}
/* The features a step depends on, named as Modules and features names them. */
export const STEP_NEEDS: Readonly<Partial<Record<OnbStepId, string>>> = {
  additional: 'Convictions declaration, Working time opt-out or Qualifications',
  policies: 'Policy acknowledgement',
};
export const STEP_UNAVAILABLE = 'Its features are switched off under Modules, so it cannot be shown.';
export const ALWAYS_ASKED = 'Identity, contact and the final submission are always asked for. Without them there is nothing to onboard.';
/* The steps a person is asked, in order: switched on (fixed ones always are) and available. */
export const stepsAsked = (config: OnboardingConfig, f: OnbFeatures): OnbStep[] =>
  config.steps.filter(s => (s.fixed || s.on) && stepAvailable(s.id, f));
/* The right-to-work document is collected only while ONB_RTW is on. */
export const docsAsked = (config: OnboardingConfig, f: OnbFeatures): OnbDocument[] =>
  config.documents.filter(d => d.id !== 'rtw' || f.rtw);

/* --------------------------------------------------------- task states */
export const TASK_STATES = ['todo', 'prog', 'done', 'verified', 'rejected'] as const;
export type TaskState = (typeof TASK_STATES)[number];
export type TaskTone = 'neu' | 'info' | 'warn' | 'ok' | 'err';
export const TASK_STATE: Readonly<Record<TaskState, { label: string; tone: TaskTone; glyph: string }>> = {
  todo: { label: 'Not started', tone: 'neu', glyph: '○' },
  prog: { label: 'In progress', tone: 'info', glyph: '◷' },
  done: { label: 'Submitted', tone: 'warn', glyph: '✓' },
  verified: { label: 'Verified', tone: 'ok', glyph: '✓' },
  rejected: { label: 'Rejected', tone: 'err', glyph: '✕' },
};
export const isTaskState = (s: unknown): s is TaskState => typeof s === 'string' && (TASK_STATES as readonly string[]).includes(s);
export const taskState = (s: unknown) => TASK_STATE[isTaskState(s) ? s : 'todo'];

/* --------------------------------------------------------------- case */
export type EmergencyContact = { nm: string; rel: string; ph: string };
export type Qualification = { nm: string; by: string; exp: string };
export interface OnbData {
  personal: { dob: string; gender: string; nat: string; ni: string };
  contact: { mob: string; alt: string; a1: string; a2: string; city: string; post: string };
  emergency: EmergencyContact[];
  additional: { conv: string; convDetail: string; wtd: string; quals: Qualification[] };
  documents: { rtwType: string };
}
export interface OnboardingCase {
  personCode: string;
  steps: Partial<Record<OnbStepId, TaskState>>;
  docs: Record<string, TaskState>;
  files: Record<string, OnbFile>;
  /* why a document was rejected, by document id, until it is replaced */
  rejections: Record<string, string>;
  /* the version of each policy the person acknowledged, by policy id */
  acks: Record<string, string>;
  read: Record<string, boolean>;
  data: OnbData;
  signature: string;
  consent: boolean;
  submittedAt: string;
  ref: string;
  invitedAt: string;
  startedAt: string;
  /* what was asked when they submitted (steps, and documents with their
     Required and Blocks start settings); absent before submission, and on a
     case submitted before this was recorded */
  asked?: OnbAsked;
}
export interface OnbAsked { steps: OnbStepId[]; documents: { id: string; req: boolean; blocks: boolean }[] }
export const emptyContact = (): EmergencyContact => ({ nm: '', rel: '', ph: '' });
export const emptyData = (): OnbData => ({
  personal: { dob: '', gender: '', nat: '', ni: '' },
  contact: { mob: '', alt: '', a1: '', a2: '', city: '', post: '' },
  emergency: [emptyContact()],
  additional: { conv: '', convDetail: '', wtd: '', quals: [] },
  documents: { rtwType: '' },
});
export const emptyCase = (personCode: string): OnboardingCase => ({
  personCode, steps: {}, docs: {}, files: {}, rejections: {}, acks: {}, read: {}, data: emptyData(),
  signature: '', consent: false, submittedAt: '', ref: '', invitedAt: '', startedAt: '',
});
export const caseId = (personCode: string) => `onb_${personCode}`;
/* Who is onboarding: a candidate or preboarding person. */
export const STARTER_STATES = ['candidate', 'preboard'] as const;
export const isStarterState = (s: string) => (STARTER_STATES as readonly string[]).includes(s);

const stepDone = (c: OnboardingCase, id: OnbStepId) => { const k = c.steps[id] ?? 'todo'; return k === 'done' || k === 'verified'; };
const docState = (c: OnboardingCase, id: string): TaskState => c.docs[id] ?? 'todo';

/* ------------------------------------------------------------- fields */
/* A field carries the type its data actually is (onbFieldRow). The screen
   renders from these; the server normalises and checks with them. */
export type FieldType = 'text' | 'email' | 'tel' | 'date' | 'select' | 'area';
export interface OnbField {
  key: string; label: string; type: FieldType; req?: boolean; locked?: boolean; wide?: boolean; maxlength?: number; uppercase?: boolean;
  pattern?: string; placeholder?: string; autocomplete?: string; options?: readonly string[]; blank?: boolean; hint?: string; tip?: string;
  /* a date's limit against today: a birth date cannot be later, an expiry cannot be earlier */
  notAfterToday?: boolean; notBeforeToday?: boolean;
}
export const LOCKED_HINT = 'Set by HR. Ask them if this needs to change.';
export const GENDERS = ['Female', 'Male', 'Prefer not to say', 'Other'] as const;
export const RELATIONSHIPS = ['Partner', 'Parent', 'Sibling', 'Child', 'Friend', 'Other'] as const;
export const CONVICTION_ANSWERS = ['No', 'Yes'] as const;
export const WORKING_TIME_ANSWERS = ['No, I do not opt out', 'Yes, I opt out'] as const;
export const RTW_TYPES = ['Passport', 'Birth certificate', 'Visa or biometric residence permit', 'Share code'] as const;
/* D13: kept as the prototype words them. */
export const CONVICTIONS_NOTE = 'Only unspent convictions under the Rehabilitation of Offenders Act. A declaration does not by itself prevent you starting.';
export const WORKING_TIME_NOTE = 'An opt-out is voluntary and you may withdraw it later by giving notice. Saying no does not affect your offer.';
export const NI_TIP = 'Payroll needs this to report you to HMRC. It is stored against your record, not shown to colleagues.';
export const NI_MAX = 13;
export const POSTCODE_MAX = 8;
export const PERSONAL_FIELDS: readonly OnbField[] = [
  { key: 'nm', label: 'Full legal name', type: 'text', req: true, locked: true, wide: true, autocomplete: 'name' },
  { key: 'email', label: 'Work email', type: 'email', req: true, locked: true },
  { key: 'dob', label: 'Date of birth', type: 'date', req: true, notAfterToday: true, hint: 'You must be 16 or over to be employed.' },
  { key: 'gender', label: 'Gender', type: 'select', options: GENDERS, blank: true },
  { key: 'nat', label: 'Nationality', type: 'text', req: true, autocomplete: 'country-name' },
  { key: 'ni', label: 'National insurance number', type: 'text', req: true, placeholder: 'QQ123456C', uppercase: true, maxlength: NI_MAX,
    pattern: '[A-Za-z ]{2}[0-9 ]{6,8}[A-Da-d ]?', tip: NI_TIP },
];
export const CONTACT_FIELDS: readonly OnbField[] = [
  { key: 'mob', label: 'Mobile', type: 'tel', req: true },
  { key: 'alt', label: 'Alternative number', type: 'tel' },
  { key: 'a1', label: 'Address line 1', type: 'text', req: true, wide: true, autocomplete: 'address-line1' },
  { key: 'a2', label: 'Address line 2', type: 'text', wide: true, autocomplete: 'address-line2' },
  { key: 'city', label: 'Town or city', type: 'text', req: true, autocomplete: 'address-level2' },
  { key: 'post', label: 'Postcode', type: 'text', req: true, uppercase: true, maxlength: POSTCODE_MAX, autocomplete: 'postal-code' },
];
/* Only the first contact is required. */
export const EMERGENCY_FIELDS: readonly OnbField[] = [
  { key: 'nm', label: 'Name', type: 'text' },
  { key: 'rel', label: 'Relationship', type: 'select', options: RELATIONSHIPS, blank: true },
  { key: 'ph', label: 'Phone', type: 'tel' },
];
export const CONVICTIONS_FIELD: OnbField = { key: 'conv', label: 'Do you have any unspent convictions?', type: 'select', req: true,
  options: CONVICTION_ANSWERS, blank: true, tip: CONVICTIONS_NOTE };
export const CONVICTION_DETAIL_FIELD: OnbField = { key: 'convDetail', label: 'Details', type: 'area', req: true, wide: true };
export const WORKING_TIME_FIELD: OnbField = { key: 'wtd', label: 'Do you wish to opt out of the 48-hour working week?', type: 'select', req: true,
  options: WORKING_TIME_ANSWERS, blank: true, tip: WORKING_TIME_NOTE };
export const QUALIFICATION_FIELDS: readonly OnbField[] = [
  { key: 'nm', label: 'Qualification', type: 'text' },
  { key: 'by', label: 'Awarding body', type: 'text' },
  { key: 'exp', label: 'Expires', type: 'date', notBeforeToday: true, hint: 'Leave blank if it does not expire.' },
];
export const RTW_TYPE_FIELD: OnbField = { key: 'rtwType', label: 'Which document proves your right to work?', type: 'select', req: true,
  options: RTW_TYPES, blank: true };
export const NO_QUALIFICATIONS = 'None added. Add any qualification relevant to the role.';

/* Upper case where the field says so (the national insurance number and the postcode), trimmed. */
export const normaliseField = (f: Pick<OnbField, 'uppercase'>, v: string) => (f.uppercase ? v.trim().toUpperCase() : v.trim());
/* The shape checks a field makes whatever the step: length, and a date's limits. */
export function fieldProblem(f: OnbField, value: string, today: string, field = f.key): OnbRefusal | null {
  if (!value) return null;
  if (f.maxlength !== undefined && value.length > f.maxlength)
    return invalid(field, `${f.label} can be at most ${f.maxlength} characters.`, `Shorten ${f.label.toLowerCase()}, then save again.`);
  if (f.type === 'date') {
    if (!isIsoDate(value)) return invalid(field, `${f.label} must be a date.`, 'Pick the date from the calendar.');
    if (f.notAfterToday && value > today) return invalid(field, `${f.label} cannot be in the future.`, 'Pick a date on or before today.');
    if (f.notBeforeToday && value < today) return invalid(field, `${f.label} cannot be in the past.`, 'Pick a date from today on, or leave it blank.');
  }
  if (f.type === 'select' && f.options && !f.options.includes(value))
    return invalid(field, `${f.label} must be one of the choices offered.`, 'Choose one from the list.');
  return null;
}

/* ------------------------------------------------- step validation */
/* Each message the prototype's onbSaveStep gives, as a sentence. */
export const STEP_MESSAGES = {
  dob: 'A date of birth is required.',
  nat: 'A nationality is required.',
  ni: 'A national insurance number is required. Payroll cannot report you without it.',
  mob: 'A mobile number is required.',
  a1: 'An address is required.',
  city: 'A town or city is required.',
  post: 'A postcode is required.',
  emergencyName: 'At least one emergency contact is required.',
  emergencyPhone: 'The emergency contact needs a phone number.',
  conv: 'Answer the convictions question.',
  convDetail: 'Give details of the conviction.',
  wtd: 'Answer the working time question.',
  rtwType: 'Say which document proves your right to work.',
} as const;
export const docRequiredText = (label: string) => `${label} is required.`;
export const acknowledgeFirstText = (label: string) => `Acknowledge ${label} before continuing.`;
export const FILL_IN = 'Fill it in, then save the step again.';

/* What a step's Save sends: only the section for that step is read. */
export interface StepPatch {
  personal?: Partial<OnbData['personal']>;
  contact?: Partial<OnbData['contact']>;
  emergency?: readonly Partial<EmergencyContact>[];
  additional?: Partial<Omit<OnbData['additional'], 'quals'>> & { quals?: readonly Partial<Qualification>[] };
  documents?: Partial<OnbData['documents']>;
  signature?: string;
}
export interface StepContext { features: OnbFeatures; documents: readonly OnbDocument[]; policies: readonly OnbPolicy[]; today: string }

const pick = <T extends Record<string, string>>(base: T, patch: Partial<Record<keyof T, unknown>> | undefined, fields: readonly OnbField[]): T => {
  const out: Record<string, string> = { ...base };
  if (patch) for (const f of fields) {
    const v = (patch as Record<string, unknown>)[f.key];
    if (typeof v === 'string' && f.key in base) out[f.key] = normaliseField(f, v);
  }
  return out as T;
};
const row = <T extends Record<string, string>>(fields: readonly OnbField[], empty: T, r: Partial<Record<keyof T, unknown>>): T => pick(empty, r, fields);

/* Merges a step's section into the data. Never touches another step's section. */
export function mergeStep(data: OnbData, id: OnbStepId, patch: StepPatch): OnbData {
  switch (id) {
    case 'personal': return { ...data, personal: pick(data.personal, patch.personal, PERSONAL_FIELDS) };
    case 'contact': return { ...data, contact: pick(data.contact, patch.contact, CONTACT_FIELDS) };
    case 'emergency': {
      if (!patch.emergency) return data;
      const list = patch.emergency.map(c => row(EMERGENCY_FIELDS, emptyContact(), c));
      return { ...data, emergency: list.length ? list : [emptyContact()] };
    }
    case 'additional': {
      const a = patch.additional;
      if (!a) return data;
      const fields = [CONVICTIONS_FIELD, CONVICTION_DETAIL_FIELD, WORKING_TIME_FIELD];
      const { conv, convDetail, wtd } = data.additional;
      const next = pick({ conv, convDetail, wtd }, a, fields);
      const quals = a.quals ? a.quals.map(q => row(QUALIFICATION_FIELDS, { nm: '', by: '', exp: '' }, q)) : data.additional.quals;
      return { ...data, additional: { ...next, quals } };
    }
    case 'documents': return { ...data, documents: pick(data.documents, patch.documents, [RTW_TYPE_FIELD]) };
    default: return data;
  }
}

/* The shape checks for a step's section (both Back and Save and continue make them). */
function shapeProblem(id: OnbStepId, d: OnbData, today: string): OnbRefusal | null {
  const each = (fields: readonly OnbField[], rec: Readonly<Record<string, string>>, prefix = '') => {
    for (const f of fields) { const p = fieldProblem(f, rec[f.key] ?? '', today, prefix + f.key); if (p) return p; }
    return null;
  };
  if (id === 'personal') return each(PERSONAL_FIELDS.filter(f => !f.locked), d.personal);
  if (id === 'contact') return each(CONTACT_FIELDS, d.contact);
  if (id === 'emergency') { for (const [i, c] of d.emergency.entries()) { const p = each(EMERGENCY_FIELDS, { ...c }, `emergency.${i}.`); if (p) return p; } return null; }
  if (id === 'additional') {
    const { quals, ...a } = d.additional;
    const p = each([CONVICTIONS_FIELD, CONVICTION_DETAIL_FIELD, WORKING_TIME_FIELD], a);
    if (p) return p;
    for (const [i, q] of quals.entries()) { const r = each(QUALIFICATION_FIELDS, { ...q }, `quals.${i}.`); if (r) return r; }
    return null;
  }
  if (id === 'documents') return each([RTW_TYPE_FIELD], d.documents);
  return null;
}

/* What a step still needs before Save and continue counts it done (onbSaveStep). */
export function stepProblem(id: OnbStepId, c: OnboardingCase, ctx: StepContext): OnbRefusal | null {
  const d = c.data;
  const need = (val: string, field: string, message: string) => (val.trim() ? null : invalid(field, message, FILL_IN));
  switch (id) {
    case 'personal':
      return need(d.personal.dob, 'dob', STEP_MESSAGES.dob) ?? need(d.personal.nat, 'nat', STEP_MESSAGES.nat) ?? need(d.personal.ni, 'ni', STEP_MESSAGES.ni);
    case 'contact':
      return need(d.contact.mob, 'mob', STEP_MESSAGES.mob) ?? need(d.contact.a1, 'a1', STEP_MESSAGES.a1)
        ?? need(d.contact.city, 'city', STEP_MESSAGES.city) ?? need(d.contact.post, 'post', STEP_MESSAGES.post);
    case 'emergency': {
      const first = d.emergency[0] ?? emptyContact();
      return need(first.nm, 'emergency.0.nm', STEP_MESSAGES.emergencyName) ?? need(first.ph, 'emergency.0.ph', STEP_MESSAGES.emergencyPhone);
    }
    case 'additional': {
      const a = d.additional;
      if (ctx.features.conv) {
        const p = need(a.conv, 'conv', STEP_MESSAGES.conv);
        if (p) return p;
        if (a.conv === 'Yes') { const q = need(a.convDetail, 'convDetail', STEP_MESSAGES.convDetail); if (q) return q; }
      }
      if (ctx.features.wtd) return need(a.wtd, 'wtd', STEP_MESSAGES.wtd);
      return null;
    }
    case 'documents': {
      if (ctx.features.rtw) { const p = need(d.documents.rtwType, 'rtwType', STEP_MESSAGES.rtwType); if (p) return p; }
      const docs = ctx.documents.filter(x => x.id !== 'rtw' || ctx.features.rtw);
      const missing = docs.find(x => x.req && ['todo', 'rejected'].includes(docState(c, x.id)));
      return missing ? invalid(`docs.${missing.id}`, docRequiredText(missing.label), `Upload ${missing.label.toLowerCase()}, then save the step again.`) : null;
    }
    case 'policies': {
      const un = ctx.policies.find(p => !policyAcknowledged(c, p));
      return un ? invalid(`policies.${un.id}`, acknowledgeFirstText(un.label), 'Read it, then tick to confirm you have.') : null;
    }
    default: return null;
  }
}

/* A step that is switched off, or whose features are off, is not asked and cannot be saved. */
export const stepNotAsked = (id: string): OnbRefusal => ({ code: 'NOT_FOUND', field: 'step', message: `There is no step "${id}" to complete.`,
  next: 'Reload the page to see the steps you are asked.' });
export const ALREADY_SUBMITTED: OnbRefusal = { code: 'SUBMITTED', message: 'You have already submitted your onboarding.',
  next: 'Ask your manager if something needs to change.' };
/* After submission only a step sent back (a rejected required document) is open again. */
export function stepOpen(c: OnboardingCase, id: OnbStepId): boolean {
  return !c.submittedAt || c.steps[id] === 'prog';
}

/* Saves a step. `check` is Save and continue: it judges the step and marks it
   done. `quiet` is Back or a rail jump: it saves without judging. Both refuse a
   malformed value. */
export function saveStep(c: OnboardingCase, id: OnbStepId, patch: StepPatch, ctx: StepContext, mode: 'check' | 'quiet'): Outcome<OnboardingCase> {
  if (!stepOpen(c, id)) return no(ALREADY_SUBMITTED);
  const data = mergeStep(c.data, id, patch);
  const shape = shapeProblem(id, data, ctx.today);
  if (shape) return no(shape);
  const signature = id === 'review' && typeof patch.signature === 'string' ? patch.signature.trim() : c.signature;
  const next: OnboardingCase = { ...c, data, signature };
  if (mode === 'quiet' || id === 'review') return ok(next);
  const bad = stepProblem(id, next, ctx);
  if (bad) return no(bad);
  return ok({ ...next, steps: { ...next.steps, [id]: 'done' } });
}
export const stepSavedText = (label: string) => `${label} saved.`;

/* ------------------------------------------------------ blockers */
export interface Blocker { kind: 'step' | 'doc'; id: string; why: string }
export type BlockerStage = 'submit' | 'start';
export interface BlockerContext { config: OnboardingConfig; features: OnbFeatures }
/* What was asked, recorded at submission. */
export const askedNow = (ctx: BlockerContext): OnbAsked => ({
  steps: stepsAsked(ctx.config, ctx.features).map(s => s.id),
  documents: docsAsked(ctx.config, ctx.features).map(({ id, req, blocks }) => ({ id, req, blocks })),
});
/* What a person is judged against. Before submission, today's config. After
   it, what they were asked when they submitted, so a step switched on or a
   document made required (or made to block the start) later is never held
   against somebody who can no longer change their onboarding. A rule relaxed
   since still counts in their favour, and something no longer asked at all
   is not counted. A submitted case with no record of what was asked (from
   before it was kept) is judged against today's config. */
export function askedOf(c: OnboardingCase, ctx: BlockerContext): { steps: OnbStep[]; documents: OnbDocument[] } {
  const steps = stepsAsked(ctx.config, ctx.features), documents = docsAsked(ctx.config, ctx.features);
  const a = c.submittedAt ? c.asked : undefined;
  if (!a) return { steps, documents };
  return {
    steps: steps.filter(s => a.steps.includes(s.id)),
    documents: documents.flatMap(d => {
      const was = a.documents.find(x => x.id === d.id);
      return was ? [{ ...d, req: d.req && was.req, blocks: d.blocks && was.blocks }] : [];
    }),
  };
}
/* Two gates, easily confused: 'submit' is what the person must do before
   sending it to HR; 'start' is that, plus the checks only HR can make. Review is
   the act of submitting, so it never counts against itself. */
export function blockers(c: OnboardingCase, ctx: BlockerContext, stage: BlockerStage = 'start'): Blocker[] {
  const out: Blocker[] = [], asked = askedOf(c, ctx);
  for (const st of asked.steps)
    if (st.id !== 'review' && !stepDone(c, st.id)) out.push({ kind: 'step', id: st.id, why: `${st.label} not completed` });
  for (const d of asked.documents.filter(x => x.req)) {
    const k = docState(c, d.id);
    if (k === 'todo' || k === 'prog') out.push({ kind: 'doc', id: d.id, why: `${d.label} not uploaded` });
    else if (stage === 'start' && d.blocks && ctx.features.verify && k !== 'verified') out.push({ kind: 'doc', id: d.id, why: `${d.label} not verified` });
    else if (k === 'rejected') out.push({ kind: 'doc', id: d.id, why: `${d.label} was rejected` });
  }
  return out;
}
export const readyToStart = (c: OnboardingCase, ctx: BlockerContext) => blockers(c, ctx, 'start').length === 0;
/* The outstanding items as sentences, for a chase and its notification. */
export const outstandingText = (bl: readonly Blocker[]) => bl.map(b => `${b.why}.`).join(' ');

/* Steps done over steps asked; review counts once submitted. */
export function progress(c: OnboardingCase, ctx: BlockerContext): { done: number; total: number } {
  const steps = askedOf(c, ctx).steps;
  const done = steps.filter(s => stepDone(c, s.id) || (s.id === 'review' && !!c.submittedAt)).length;
  return { done, total: steps.length };
}
export const progressText = (p: { done: number; total: number }) => `${p.done} of ${p.total} done`;

/* --------------------------------------------------------------- submit */
export const CONSENT_NEEDED = 'Confirm the information is true and complete before submitting.';
export const SIGNATURE_NEEDED = 'Type your name to sign before submitting.';
export const stillToDoText = (bl: readonly Blocker[]) =>
  `${plural(bl.length, 'thing')} ${bl.length === 1 ? 'is' : 'are'} still to do. ${bl[0] ? `${bl[0].why}.` : ''}`.trim();
/* The reference: ONB- and four digits, one more than the highest already given (not random). */
export const REF_PATTERN = /^ONB-(\d+)$/;
export function nextRef(existing: readonly string[]): string {
  const top = existing.reduce((m, r) => { const x = REF_PATTERN.exec(r); return x ? Math.max(m, Number(x[1])) : m; }, 1000);
  return `ONB-${top + 1}`;
}
export interface SubmitInput { consent: boolean; signature?: string; ref: string; at: string }
export function submitCase(c: OnboardingCase, input: SubmitInput, ctx: BlockerContext): Outcome<OnboardingCase> {
  if (c.submittedAt) return no(ALREADY_SUBMITTED);
  const signature = typeof input.signature === 'string' ? input.signature.trim() : c.signature;
  const bl = blockers(c, ctx, 'submit');
  if (bl[0]) return no({ code: 'OUTSTANDING', message: stillToDoText(bl), next: 'Finish the steps not ticked on the left, then submit.' });
  if (!input.consent) return no(invalid('consent', CONSENT_NEEDED, 'Tick the confirmation, then submit.'));
  if (ctx.features.sign && !signature) return no(invalid('signature', SIGNATURE_NEEDED, 'Type your full name in the signature box, then submit.'));
  return ok({ ...c, signature, consent: true, submittedAt: input.at, ref: input.ref, steps: { ...c.steps, review: 'done' }, asked: askedNow(ctx) });
}
export const submittedText = (ref: string) => `Submitted with reference ${ref}. HR has been told.`;

/* -------------------------------------------------------------- uploads */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const PREVIEW_MAX_SIDE = 560;
export const PREVIEW_QUALITY = 0.7;
export const UPLOAD_ACCEPT = 'image/*,.pdf';
export const FILES_NOTE = "Files are kept with this demo's saved data. They are not sent to a document store.";
export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/* Only an image gets a preview; a PDF is named as one; anything else is a file. */
export const fileKind = (type: string): FileKind => (type.startsWith('image/') ? 'image' : type === 'application/pdf' ? 'pdf' : 'file');
export const hasPreview = (type: string) => fileKind(type) === 'image';
export const tooLargeText = (name: string, size: number) => `${name} is ${fileSize(size)}. 8 MB is the most this browser can hold.`;
export function uploadProblem(f: { name: string; size: number }): OnbRefusal | null {
  if (!f.name.trim()) return invalid('file', 'Choose a file to upload.', 'Pick the file again.');
  if (f.size > UPLOAD_MAX_BYTES) return invalid('file', tooLargeText(f.name, f.size), 'Choose a smaller file, or a photograph of the page.');
  return null;
}
/* The record kept: a preview only for an image. */
export function fileRecord(f: { name: string; size: number; type: string; preview?: string }, at: string): OnbFile {
  const kind = fileKind(f.type);
  return { name: f.name, size: f.size, type: f.type, at, kind, ...(kind === 'image' && f.preview ? { preview: f.preview } : {}) };
}
export const NOTHING_UPLOADED = 'Nothing was uploaded for that document.';

/* D4: a document nobody checks, or any document while verification is off, is verified on upload. */
export const uploadState = (doc: Pick<OnbDocument, 'verify'>, f: Pick<OnbFeatures, 'verify'>): TaskState =>
  doc.verify === 'none' || !f.verify ? 'verified' : 'done';
/* Before submission any document; after it, only one rejected or on a step sent back. */
export const uploadOpen = (c: OnboardingCase, docId: string) => !c.submittedAt || c.steps.documents === 'prog' || docState(c, docId) === 'rejected';
export function applyUpload(c: OnboardingCase, doc: OnbDocument, file: OnbFile, f: Pick<OnbFeatures, 'verify'>): Outcome<OnboardingCase> {
  if (!uploadOpen(c, doc.id)) return no(ALREADY_SUBMITTED);
  return ok({ ...c, files: { ...c.files, [doc.id]: file }, docs: { ...c.docs, [doc.id]: uploadState(doc, f) }, rejections: without(c.rejections, doc.id) });
}
export const uploadedText = (label: string, name: string, state: TaskState) =>
  `${label}: ${name} ${state === 'verified' ? 'was accepted.' : 'is waiting to be checked.'}`;

/* --------------------------------------------------------- verification */
export const REASON_NEEDED = 'Give a reason, so they know what to send instead.';
export const notWaitingText = (label: string) => `${label} is not waiting for a check.`;
export type Decision = { ok: true } | { ok: false; reason: string };
/* Verify or reject an uploaded document. A rejected required document sends the documents step back to in progress. */
export function decideDocument(c: OnboardingCase, doc: OnbDocument, decision: Decision): Outcome<OnboardingCase> {
  if (!c.files[doc.id]) return no({ code: 'NOT_FOUND', message: NOTHING_UPLOADED, next: 'Wait for them to upload it, or chase them.' });
  if (docState(c, doc.id) !== 'done') return no({ code: 'STALE', message: notWaitingText(doc.label), next: 'Reload the page to see where it stands.' });
  if (decision.ok) return ok({ ...c, docs: { ...c.docs, [doc.id]: 'verified' } });
  const reason = decision.reason.trim();
  if (!reason) return no(invalid('reason', REASON_NEEDED, 'Say what is wrong with it, then reject it.'));
  return ok({ ...c, docs: { ...c.docs, [doc.id]: 'rejected' }, rejections: { ...c.rejections, [doc.id]: reason },
    steps: doc.req ? { ...c.steps, documents: 'prog' } : c.steps });
}
export const decidedText = (label: string, verified: boolean, name: string) =>
  verified ? `${label} verified.` : `${label} rejected. ${name} has been told.`;

/* ------------------------------------------------------------- policies */
/* An acknowledgement counts only for the version shown when it was given. */
export const policyAcknowledged = (c: OnboardingCase, p: Pick<OnbPolicy, 'id' | 'ver'>) => c.acks[p.id] === p.ver;
export function setPolicyAck(c: OnboardingCase, p: OnbPolicy, on: boolean): OnboardingCase {
  const rest = without(c.acks, p.id);
  return on ? { ...c, acks: { ...rest, [p.id]: p.ver }, read: { ...c.read, [p.id]: true } } : { ...c, acks: rest };
}
export const markRead = (c: OnboardingCase, p: OnbPolicy): OnboardingCase => ({ ...c, read: { ...c.read, [p.id]: true } });
export const acknowledgedText = (p: OnbPolicy) => `${p.label} ${p.ver} acknowledged.`;
/* The setup count: people who acknowledged the current version only. */
export const ackCount = (p: OnbPolicy, cases: readonly OnboardingCase[]) => cases.filter(c => policyAcknowledged(c, p)).length;
/* v2.3 becomes v2.4; anything unparseable starts again at v1.1 (nextPolVer). */
export function nextPolVer(v: string): string {
  const m = /^v?(\d+)\.(\d+)$/.exec(v);
  return m ? `v${m[1] ?? ''}.${Number(m[2]) + 1}` : 'v1.1';
}
/* D10: a new document raises the version and clears every acknowledgement of that
   policy, so everybody who agreed to the old one is asked again. The caller
   passes only the cases of people still onboarding: somebody who has started
   is never asked again, and keeps what they agreed to as the record. */
export function applyPolicyUpload(p: OnbPolicy, file: OnbFile, cases: readonly OnboardingCase[]): { policy: OnbPolicy; changed: OnboardingCase[]; asked: number } {
  const changed = cases.filter(c => p.id in c.acks || c.read[p.id]).map(c => {
    return { ...c, acks: without(c.acks, p.id), read: without(c.read, p.id) };
  });
  const asked = cases.filter(c => p.id in c.acks).length;
  return { policy: { ...p, file, ver: nextPolVer(p.ver) }, changed, asked };
}
export const policyUploadedText = (label: string, ver: string, asked: number) =>
  `${label} is now ${ver}. ${asked ? `${plural(asked, 'person', 'people')} will be asked again.` : 'It is ready to read.'}`;
export const POLICY_NAME_NEEDED = 'A policy needs a name.';
export const POLICY_NAME_TAKEN = 'A policy with that name already exists.';
export const DEFAULT_POLICY_VER = 'v1.0';
export const policyKey = (name: string) => `pol_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
export interface PolicyDraft { label: string; ver?: string; sum?: string }
/* Add or edit (pol-save): a name is needed, and no two policies share one (by key, so case and punctuation do not count). */
export function policyProblem(draft: PolicyDraft, policies: readonly OnbPolicy[], editingId?: string): OnbRefusal | null {
  const label = draft.label.trim();
  if (!label) return invalid('label', POLICY_NAME_NEEDED, 'Give the policy a name, then save.');
  const same = (p: OnbPolicy) => p.id === policyKey(label) || policyKey(p.label) === policyKey(label);
  if (policies.some(p => p.id !== editingId && same(p))) return invalid('label', POLICY_NAME_TAKEN, 'Choose another name, or edit the one already there.');
  return null;
}
export function policyFromDraft(draft: PolicyDraft, order: number): OnbPolicy {
  const label = draft.label.trim();
  return { id: policyKey(label), label, ver: draft.ver?.trim() || DEFAULT_POLICY_VER, sum: draft.sum?.trim() ?? '', body: [], order };
}
export const policySavedText = (label: string) => `${label} saved. Upload the document to make it readable.`;
/* Removing asks first; past acknowledgements stay in the audit trail. */
export const removePolicyText = (acks: number) => (acks
  ? `${plural(acks, 'person has', 'people have')} acknowledged this policy. Removing it does not remove that record from the audit trail, but new starters will no longer be asked.`
  : 'New starters will no longer be asked to read it.');
export const policyRemovedText = (label: string) => `${label} removed.`;

/* ---------------------------------------------------------- step switches */
/* D11: steps are switched, never added or reordered. A fixed step is always
   asked; a step whose features are off cannot be switched on. */
export function stepSwitchProblem(step: OnbStep, on: boolean, f: OnbFeatures): OnbRefusal | null {
  if (step.fixed && !on) return { code: 'FIXED', field: `steps.${step.id}`, message: ALWAYS_ASKED, next: 'Leave it on.' };
  if (on && !step.on && !stepAvailable(step.id, f))
    return { code: 'FLAG_OFF', field: `steps.${step.id}`, message: `${step.label} cannot be switched on. ${STEP_UNAVAILABLE}`,
      next: `Switch on ${STEP_NEEDS[step.id] ?? 'its features'} under Modules and features first.` };
  return null;
}
export const stepSwitchText = (label: string, on: boolean) =>
  `${label} ${on ? 'will be asked for' : 'will not be asked for'}. People part-way through keep what they have already given.`;
export const REQUIRED_CHANGE_WARNING = 'Changing what is required affects people already part-way through. Somebody who has submitted will not be asked again for a document that becomes required after they finished.';
/* The whole config on Save (D2): the same steps and documents in the same order,
   each switch allowed, each verifier one of the four. */
export function configProblem(before: OnboardingConfig, next: OnboardingConfig, f: OnbFeatures): OnbRefusal | null {
  if (next.steps.map(s => s.id).join() !== before.steps.map(s => s.id).join())
    return { code: 'VALIDATION', field: 'steps', message: 'Steps can be switched on or off, not added, removed or reordered.', next: 'Reload the page and switch the steps you need.' };
  for (const s of next.steps) {
    const was = before.steps.find(x => x.id === s.id);
    if (!was) continue;
    if (s.fixed !== was.fixed || s.label !== was.label)
      return { code: 'VALIDATION', field: `steps.${s.id}`, message: 'Only a step\'s switch can be changed.', next: 'Reload the page and switch the steps you need.' };
    const p = s.on === was.on ? null : stepSwitchProblem(was, s.on, f);
    if (p) return p;
  }
  if (next.documents.map(d => d.id).join() !== before.documents.map(d => d.id).join())
    return { code: 'VALIDATION', field: 'documents', message: 'Documents can be set, not added, removed or reordered.', next: 'Reload the page and change the settings you need.' };
  const renamed = next.documents.find(d => { const was = before.documents.find(x => x.id === d.id); return !was || was.label !== d.label || was.hint !== d.hint; });
  if (renamed) return { code: 'VALIDATION', field: `documents.${renamed.id}`, message: 'Only a document\'s settings can be changed.', next: 'Reload the page and change the settings you need.' };
  const bad = next.documents.find(d => !isVerifier(d.verify));
  if (bad) return { code: 'VALIDATION', field: `documents.${bad.id}.verify`, message: `${bad.label} needs somebody to check it, or No check needed.`, next: 'Choose who verifies it from the list.' };
  return null;
}

/* ----------------------------------------------------- activation (D6) */
export const START_REASON = 'Onboarding complete';
export const INVITE_REASON = 'Invited to complete onboarding';
export const notReadyText = (name: string, bl: readonly Blocker[]) =>
  `${name} cannot start yet. ${bl.length} outstanding. ${bl[0] ? `${bl[0].why}.` : ''}`.trim();
/* Refused on the server while start-stage blockers remain, whichever path asks. */
export function startProblem(name: string, c: OnboardingCase, ctx: BlockerContext): OnbRefusal | null {
  const bl = blockers(c, ctx, 'start');
  return bl.length ? { code: 'NOT_READY', message: notReadyText(name, bl), next: 'Chase them, or check the documents waiting on a check.' } : null;
}
export const noEmailText = (name: string) => `${name} has no email address, so there is nowhere to send an invitation. Add one on their record.`;

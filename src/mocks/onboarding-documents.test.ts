import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { OnboardingConfigSaved, OnboardingDetail, OnboardingSetup } from '@/contract/onboarding';
import { BUILT_IN_DOC, DOC_NAME_NEEDED, DOC_NAME_TAKEN } from '@/domain/onboarding';
import { audits, caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

/* Module 8 group 5: Onboarding setup's documents. A document can be switched
   off, so a new starter is not asked for it; the tenant adds its own, with a
   hint, renames and removes them. Each write carries If-Match on the config
   and writes one audit row. A built-in document is never renamed or removed,
   and one on anybody's onboarding is not removed (D2, usedBy). */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

type Call = ReturnType<typeof caller>;
const as = async (p: Persona) => caller(await tokenFor(p));
async function asEmail(email: string): Promise<Call> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  return caller(token);
}
const TOM = 'tom.achterberg@brightpath.org';
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['onboardingCases', 'onboardingConfig', 'audit'];
const docAudits = () => audits().filter(a => a.entity === 'onboardingConfig');
const setupOf = async (call: Call) => OnboardingSetup.parse((await call('GET', '/api/v1/onboarding/config')).body);
const DBS = { label: 'DBS check', hint: 'An enhanced certificate issued in the last three years.' };

test('an added document is optional, checked by HR and asked for; one audit row; a new starter sees it with its hint', async () => {
  const admin = await as('admin');
  const r = await admin('POST', '/api/v1/onboarding/documents', DBS, 1);
  expect(r.status).toBe(200);
  const saved = OnboardingConfigSaved.parse(r.body);
  expect(saved.summary).toBe('DBS check added. It is optional until you make it required and save.');
  expect(saved.record.documents.at(-1)).toEqual({ id: 'dbs-check', label: 'DBS check', hint: DBS.hint, req: false, verify: 'hr', blocks: false, expiry: false, on: true, custom: true });
  expect(docAudits().map(a => [a.act, a.after])).toEqual([['Onboarding document added',
    { document: 'dbs-check', label: 'DBS check', hint: DBS.hint, detail: saved.summary }]]);
  const mine = OnboardingDetail.parse((await (await asEmail(TOM))('GET', '/api/v1/onboarding/me')).body);
  expect(mine.documents.find(d => d.id === 'dbs-check')).toMatchObject({ label: 'DBS check', hint: DBS.hint, req: false });
});

test('a name is needed and no two share one; the config version is checked', async () => {
  const admin = await as('admin'), before = snapshot(...WRITES);
  expect(refusal(await admin('POST', '/api/v1/onboarding/documents', { label: '  ' }, 1))).toMatchObject({ field: 'label', message: DOC_NAME_NEEDED });
  expect(refusal(await admin('POST', '/api/v1/onboarding/documents', { label: 'proof of ADDRESS' }, 1))).toMatchObject({ field: 'label', message: DOC_NAME_TAKEN });
  expect((await admin('POST', '/api/v1/onboarding/documents', DBS, 7)).status).toBe(412);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('a document the tenant added is renamed with its hint; a built-in one is refused, and neither is removed', async () => {
  const admin = await as('admin');
  await admin('POST', '/api/v1/onboarding/documents', DBS, 1);
  const r = await admin('PATCH', '/api/v1/onboarding/documents/dbs-check', { label: 'Enhanced DBS check', hint: 'Issued in the last year.' }, 2);
  expect(r.status).toBe(200);
  expect(OnboardingConfigSaved.parse(r.body).record.documents.find(d => d.id === 'dbs-check')).toMatchObject({ label: 'Enhanced DBS check', hint: 'Issued in the last year.' });
  expect(docAudits().at(-1)).toMatchObject({ act: 'Onboarding document renamed', before: { label: 'DBS check' }, after: { label: 'Enhanced DBS check' } });
  const before = snapshot(...WRITES);
  for (const [method, body] of [['PATCH', { label: 'Passport' }], ['DELETE', undefined]] as const) {
    const built = await admin(method, '/api/v1/onboarding/documents/rtw', body, 3);
    expect(built.status).toBe(409);
    expect(refusal(built)).toMatchObject({ code: 'built-in', message: BUILT_IN_DOC });
  }
  expect((await admin('DELETE', '/api/v1/onboarding/documents/nope', undefined, 3)).status).toBe(404);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('a document nobody holds is removed with one audit row; one on somebody\'s onboarding is refused, naming them (D2)', async () => {
  const admin = await as('admin');
  await admin('POST', '/api/v1/onboarding/documents', DBS, 1);
  await admin('POST', '/api/v1/onboarding/documents', { label: 'Professional registration' }, 2);
  const gone = await admin('DELETE', '/api/v1/onboarding/documents/professional-reg', undefined, 3);
  expect(gone.status).toBe(200);
  expect(OnboardingConfigSaved.parse(gone.body).summary).toBe('Professional registration removed. New starters are no longer asked for it.');
  expect(docAudits().at(-1)).toMatchObject({ act: 'Onboarding document removed', after: null, before: { document: 'professional-reg' } });
  /* Tom uploads his DBS certificate */
  const tom = await asEmail(TOM);
  const mine = OnboardingDetail.parse((await tom('GET', '/api/v1/onboarding/me')).body);
  expect((await tom('POST', '/api/v1/onboarding/me/documents/dbs-check', { name: 'dbs.pdf', size: 90_000, type: 'application/pdf' }, mine.case.version)).status).toBe(200);
  const before = snapshot(...WRITES);
  const r = await admin('DELETE', '/api/v1/onboarding/documents/dbs-check', undefined, 4);
  expect(r.status).toBe(409);
  expect(refusal(r)).toMatchObject({ code: 'in-use', field: 'documents.dbs-check', next: 'Switch it off instead, so new starters are no longer asked for it.',
    usedBy: [{ kind: 'onboarding', count: 1, examples: ['Tom Achterberg'] }] });
  expect(refusal(r).message).toContain('Tom Achterberg');
  expect(snapshot(...WRITES)).toEqual(before);
});

test('a document switched off on Save is no longer asked for; its name cannot change through Save', async () => {
  const admin = await as('admin'), s = await setupOf(admin);
  const documents = s.config.documents.map(d => (d.id === 'licence' ? { ...d, on: false } : d));
  expect((await admin('PUT', '/api/v1/onboarding/config', { steps: s.config.steps, documents }, s.config.version)).status).toBe(200);
  const mine = OnboardingDetail.parse((await (await asEmail(TOM))('GET', '/api/v1/onboarding/me')).body);
  expect(mine.documents.map(d => d.id)).not.toContain('licence');
  const renamed = documents.map(d => (d.id === 'addr' ? { ...d, label: 'Address' } : d));
  expect(refusal(await admin('PUT', '/api/v1/onboarding/config', { steps: s.config.steps, documents: renamed }, s.config.version + 1)))
    .toMatchObject({ field: 'documents.addr' });
});

test('only Configure onboarding adds, renames or removes a document: the manager and the employee are refused and nothing moves', async () => {
  const admin = await as('admin');
  await admin('POST', '/api/v1/onboarding/documents', DBS, 1);
  const before = snapshot(...WRITES);
  for (const p of ['manager', 'employee'] as const) {
    const call = await as(p);
    for (const [method, path, body] of [
      ['POST', '/api/v1/onboarding/documents', { label: 'Fire safety' }],
      ['PATCH', '/api/v1/onboarding/documents/dbs-check', { label: 'DBS' }],
      ['DELETE', '/api/v1/onboarding/documents/dbs-check', undefined],
    ] as const) {
      const r = await call(method, path, body, 2);
      expect(r.status, `${p} ${method}`).toBe(403);
      expect(refusal(r).code).toBe('capability');
    }
  }
  expect(store.coll('onboardingConfig')).toEqual(before.onboardingConfig);
});

import social from './social.json';
import qnipay from './qnipay.json';
import {
  STEP_IDS, blockers, caseId, emptyCase, isStarterState, isStepId, isVerifier, nextPolVer, onbFeatures, progress, progressText,
  type OnboardingCase, type OnboardingConfig, type OnbPolicy,
} from '@/domain/onboarding';

type Rec = Record<string, unknown> & { id: string };
interface SeedFile { data: Record<string, Record<string, Rec>> }
interface Person extends Rec { code: string; state: string }
interface Tenant extends Rec { modules: Record<string, boolean>; flags: Record<string, boolean> }
const vals = <T = Rec>(s: SeedFile, c: string) => Object.values(s.data[c] ?? {}) as T[];
const ONBOARDING = ['onboardingConfig', 'onboardingPolicies', 'onboardingCases'];
/* The keys a money field would carry, anywhere in the onboarding collections. */
const MONEY_KEY = /"(rate|amount|cost|pay|salary|wage|value|price|offer|bank\w*)"\s*:/i;
const STARTERS: Record<string, [string, string][]> = {
  qnipay: [['EMP002', 'candidate'], ['EMP003', 'preboard']],
  social: [['CP-1501', 'candidate'], ['CP-1502', 'preboard']],
};

for (const [name, raw] of Object.entries({ social, qnipay })) {
  const seed = raw as unknown as SeedFile;
  const cfg = seed.data.onboardingConfig?.onboardingConfig as Rec & OnboardingConfig;
  const policies = vals<Rec & OnbPolicy>(seed, 'onboardingPolicies');
  const cases = vals<Rec & OnboardingCase>(seed, 'onboardingCases');
  const people = vals<Person>(seed, 'people');
  const tenant = seed.data.tenant?.tenant as Tenant;
  const features = onbFeatures(tenant.modules, tenant.flags);

  describe(`seed ${name} for module 5`, () => {
    test('the config is one versioned record with the prototype\'s seven steps and five documents, and no icons', () => {
      expect([cfg.id, cfg.version]).toEqual(['onboardingConfig', 1]);
      expect(Object.keys(seed.data.onboardingConfig ?? {})).toEqual(['onboardingConfig']);
      expect(cfg.steps.map(s => s.id)).toEqual([...STEP_IDS]);
      expect(cfg.steps.every(s => isStepId(s.id) && s.on)).toBe(true);
      expect(cfg.steps.filter(s => s.fixed).map(s => s.id)).toEqual(['personal', 'contact', 'review']);
      expect(cfg.documents.map(d => [d.id, d.req, d.verify, d.blocks, d.expiry])).toEqual([
        ['rtw', true, 'hr', true, true], ['addr', true, 'hr', false, false], ['photo', true, 'either', false, false],
        ['licence', false, 'mgr', false, true], ['cert', false, 'mgr', false, true]]);
      expect(cfg.documents.every(d => isVerifier(d.verify))).toBe(true);
      for (const x of [...cfg.steps, ...cfg.documents]) expect(Object.keys(x), x.id).not.toContain('ic');
    });
    test('each policy is its own row, pol_<id>, with its version, summary, text and place, and no file', () => {
      expect(policies.map(p => [p.id, p.label, p.ver, p.order])).toEqual([
        ['pol_conduct', 'Code of conduct', 'v4.1', 0], ['pol_privacy', 'Privacy notice', 'v2.0', 1],
        ['pol_handbook', 'Employee handbook', 'v7.3', 2], ['pol_itsec', 'IT and data security', 'v3.2', 3]]);
      for (const p of policies) {
        expect([p.version, p.body.length, p.sum.length > 0, 'file' in p], p.id).toEqual([1, 4, true, false]);
        expect(nextPolVer(p.ver), p.id).toMatch(/^v\d+\.\d+$/);
      }
    });
    test('the text reads as British sentences: no em-dash or middle-dot asides, each ending in a full stop', () => {
      const texts = [...cfg.steps.map(s => s.desc), ...cfg.documents.map(d => d.hint), ...policies.flatMap(p => [p.sum, ...p.body])];
      for (const t of texts) {
        expect(t, t).not.toMatch(/[—·]/);
        expect(t, t).toMatch(/\.$/);
        expect(t, t).not.toMatch(/\.\s+[a-z]/);
      }
      expect(policies[0]?.body[1]).toBe('Tell your manager about anything that could be a conflict of interest, for example a second job, '
        + 'a family connection to a supplier, a financial interest in a client. Declaring it is not a problem. Not declaring it is.');
    });
    test('every starter, and only a starter, has an empty case of their own', () => {
      const starters = people.filter(p => isStarterState(p.state));
      expect(starters.map(p => [p.code, p.state])).toEqual(STARTERS[name]);
      expect(cases.map(c => c.id).sort()).toEqual(starters.map(p => caseId(p.code)).sort());
      for (const c of cases) {
        const { id, version, updatedAt, ...rest } = c;
        expect([id, version, typeof updatedAt], id).toEqual([caseId(c.personCode), 1, 'string']);
        expect(rest, id).toEqual(emptyCase(c.personCode));
      }
      for (const p of people.filter(x => !isStarterState(x.state))) expect(seed.data.onboardingCases?.[caseId(p.code)], p.code).toBeUndefined();
    });
    test('an empty case has every step but review and every required document outstanding, and nothing done', () => {
      expect(features).toEqual({ rtw: true, conv: true, wtd: true, qual: true, pol: true, sign: true, verify: true });
      for (const c of cases) {
        expect(blockers(c, { config: cfg, features }, 'submit').map(b => b.id), c.id).toEqual(
          ['personal', 'contact', 'emergency', 'additional', 'documents', 'policies', 'rtw', 'addr', 'photo']);
        expect(progressText(progress(c, { config: cfg, features })), c.id).toBe('0 of 7 done');
      }
    });
    test('no money in any onboarding collection', () => {
      expect(JSON.stringify(ONBOARDING.map(c => seed.data[c]))).not.toMatch(MONEY_KEY);
    });
  });
}

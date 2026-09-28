/* Reads the prototype's own data, so no sample record is retyped. Two routes:
   the store the prototype writes to localStorage (every persisted collection),
   and, for constants that are never persisted, the literal in its source. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.PROTOTYPE_PATH || resolve(here, '../../Qnipay workforce cc/mockup/qnipay-workforce-v15.html');
const html = readFileSync(SRC, 'utf8');
const OUT = resolve(here, '../src/mocks/seed');
/* Built in UTC, not with local-time arguments: the latter makes FROZEN.getTime()
   (and so STAMP, and so every record's updatedAt) shift with the host machine's
   timezone offset, which means a re-run on a different machine rewrites every
   record for no real change. Date.UTC pins the instant so STAMP is always
   2026-08-13T14:30:00.000Z, matching the fixed clock used elsewhere (e.g.
   src/mocks/store.test.ts) regardless of where this script runs. */
const FROZEN = new Date(Date.UTC(2026, 7, 13, 14, 30, 0));   // the date the sample data was authored around
const STAMP = FROZEN.toISOString();
const KEY = 'qnipay.workforce.v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Polls localStorage rather than trusting a fixed delay: saveState() in the
   prototype debounces its write by 400ms, so a fixed sleep is either a guess
   or a race. This also doubles as the loud-failure guard for a no-op action —
   if a selector stops matching, nothing re-saves, raw never changes, and this
   throws instead of silently reading stale (or absent) data. */
async function waitForStoreChange(w, prevRaw, label, timeoutMs = 3000, everyMs = 20) {
  const start = Date.now();
  for (;;) {
    const raw = w.localStorage.getItem(KEY);
    if (raw !== null && raw !== prevRaw) return raw;
    if (Date.now() - start > timeoutMs)
      throw new Error(`extractor: localStorage under ${KEY} did not change within ${timeoutMs}ms after ${label} — a selector likely stopped matching`);
    await sleep(everyMs);
  }
}

/* ---- constants from the source: the text of `const NAME=<literal>;`, evaluated alone ---- */
function literal(name) {
  const at = html.search(new RegExp(`(?:const|let) ${name}\\s*=`));
  if (at < 0) throw new Error('literal not found: ' + name);
  const open = html.slice(at).search(/[[{]/) + at;
  let depth = 0, quote = null;
  for (let j = open; j < html.length; j++) {
    const c = html[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) {
      /* functions inside (e.g. needs:()=>flagOn(...)) evaluate to functions and are dropped by JSON */
      return JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.slice(open, j + 1) + ')', { flagOn: () => true })));
    }
  }
  throw new Error('unclosed literal: ' + name);
}

/* ---- the prototype, run the way its own suite runs it ---- */
function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local/',
    beforeParse(w) {
      const Real = w.Date;
      function Frozen(...a) { return a.length ? new Real(...a) : new Real(FROZEN.getTime()); }
      Frozen.prototype = Real.prototype; Frozen.now = () => FROZEN.getTime(); Frozen.parse = Real.parse; Frozen.UTC = Real.UTC;
      w.Date = Frozen; w.scrollTo = () => {};
    } });
  const w = dom.window, d = w.document;
  /* Loud on purpose: `el && el.dispatchEvent(...)` would make a missing
     selector a silent no-op — sign-in would leave the store empty, or
     switchTemplate would leave it exactly as qnipay left it, and both would
     write plausible-looking JSON that is quietly wrong. Naming the selector
     in the error is what makes step 4's "fix only the extractor" workable. */
  const must = (label, el) => { if (!el) throw new Error('extractor: could not find ' + label); return el; };
  const click = (label, el) => { must(label, el).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const act = a => [...d.querySelectorAll('[data-act]')].find(b => b.getAttribute('data-act') === a);
  const signInAdmin = () => {
    const acc = d.querySelector('#lg-accounts');
    if (acc && acc.classList.contains('hidden')) click('"show-accounts" button', act('show-accounts'));
    const row = must('an admin account row in #lg-accounts (text matching /Configuration, modules/)',
      [...d.querySelectorAll('#lg-accounts .acct')].find(b => /Configuration, modules/.test(b.textContent)));
    must('#lg-em input', d.querySelector('#lg-em')).value = row.getAttribute('data-em');
    must('#lg-pw input', d.querySelector('#lg-pw')).value = 'Qnipay@123';
    click('"signin" button', act('signin'));
  };
  /* named switchTemplate, not useTenant: an identifier starting with `use`
     trips react-hooks/rules-of-hooks (applied lint-wide, not just to JSX)
     when called at the top level of the module. */
  const switchTemplate = k => {
    click('setup nav button [data-mod-k="setup"]',
      [...d.querySelectorAll('[data-mod-k]')].find(b => b.getAttribute('data-mod-k') === 'setup'));
    click('organisation setup section [data-setupsec="org"]',
      [...d.querySelectorAll('[data-setupsec]')].find(b => b.getAttribute('data-setupsec') === 'org'));
    click(`template button [data-tpl="${k}"]`,
      [...d.querySelectorAll('[data-tpl]')].find(b => b.getAttribute('data-tpl') === k));
  };
  return { w, signInAdmin, switchTemplate };
}

const meta = (r, extra = {}) => ({ version: 1, updatedAt: STAMP, ...r, ...extra });
const byId = arr => Object.fromEntries(arr.map(r => [r.id, r]));
const dim = (prefix, list) => byId((list || []).map(x => meta({ ...x }, { id: `${prefix}_${x.code}` })));

function shape(tenantKey, data, PERMS_META, PERM_GROUPS) {
  const ROLE_OF = { emp: 'employee', mgr: 'manager', adm: 'admin' };
  const people = (data.PEOPLE || []).map(p => meta({
    id: `per_${p.id}`, code: p.id, name: p.nm, email: (p.email || '').toLowerCase(),
    jobProfile: p.job || '', employeeType: p.type || '', category: p.cat || '', location: p.loc || '',
    department: p.dept || '', manager: p.mgr && p.mgr !== '—' ? p.mgr : '', contractedHours: p.con ?? 0,
    maxHours: p.max ?? 48, state: p.state || 'active', start: p.start || '', end: p.end || '' }));
  const accounts = Object.entries(data.USERS || {}).map(([email, u]) => meta({
    id: `acc_${email}`, email, personCode: u.eid, userType: u.role, grants: [], revocations: [] }));
  const perms = data.PERMS || PERMS_META;
  const userTypes = Object.entries(ROLE_OF).map(([col, role]) => meta({
    id: role, name: (data.ROLE_NAMES || {})[role] || role[0].toUpperCase() + role.slice(1),
    description: { employee: 'Their own work: timesheet, shifts and leave', manager: 'Everything an employee can do, plus their team', admin: 'Configure how this workforce operates' }[role],
    capabilities: perms.filter(p => p[col]).map(p => p.c) }));
  const capabilities = perms.map(p => meta({ id: p.c, group: p.g, label: p.label, gate: p.gate,
    lockedFor: (p.lock || []).map(k => ROLE_OF[k]) }));
  /* The matrix's row groups, served through the contract so no feature has to import the seed. */
  const capabilityGroups = PERM_GROUPS.map((g, i) => meta({ id: g.k, label: g.label, description: g.desc, order: i }));
  const tenant = meta({ id: 'tenant', name: (data.TENANT || {}).name || tenantKey, template: (data.CFG || {}).template || tenantKey,
    modules: (data.CFG || {}).modules || {}, flags: (data.CFG || {}).flags || {} });
  const notices = (data.NOTICES || []).map(n => meta({ ...n }, { id: n.id }));
  return { version: 'extracted', tenant: tenantKey, data: {
    people: byId(people), accounts: byId(accounts), userTypes: byId(userTypes), capabilities: byId(capabilities),
    capabilityGroups: byId(capabilityGroups), tenant: { tenant }, locations: dim('loc', data.LOCATIONS), departments: dim('dep', data.DEPARTMENTS),
    costCentres: dim('cc', data.COST_CENTRES), jobProfiles: dim('job', data.JOB_PROFILES), projects: dim('prj', data.PROJECTS),
    notices: byId(notices), audit: {} } };
}

/* A missing PEOPLE roster, or a `social` snapshot indistinguishable from
   `qnipay`, means an action above no-opped without tripping a missing-selector
   error (e.g. it clicked something, but not the thing that mattered). Both
   are checked explicitly rather than trusted from a non-empty write. */
function assertNonEmpty(data, label) {
  if (!(data.PEOPLE || []).length) throw new Error(`extractor: ${label} produced a store with no PEOPLE`);
}
function assertTenantChanged(before, after, label) {
  const beforeName = (before.TENANT || {}).name, afterName = (after.TENANT || {}).name;
  const beforeIds = (before.PEOPLE || []).map(p => p.id).sort().join(',');
  const afterIds = (after.PEOPLE || []).map(p => p.id).sort().join(',');
  if (beforeName === afterName && beforeIds === afterIds)
    throw new Error(`extractor: switching to '${label}' left the tenant name and roster identical to before — the template switch likely no-opped`);
}

const PERMS_META = literal('PERMS');
const PERM_GROUPS = literal('PERM_GROUPS');
const { w, signInAdmin, switchTemplate } = boot();

const rawBeforeSignIn = w.localStorage.getItem(KEY);   // null: nothing saved yet
signInAdmin();
const rawQnipay = await waitForStoreChange(w, rawBeforeSignIn, 'sign-in');
const qnipay = JSON.parse(rawQnipay).data;
assertNonEmpty(qnipay, 'sign-in');

switchTemplate('social');
const rawSocial = await waitForStoreChange(w, rawQnipay, "switching to 'social'");
const social = JSON.parse(rawSocial).data;
assertNonEmpty(social, "switching to 'social'");
assertTenantChanged(qnipay, social, 'social');

/* The prototype names its default tenant `qcic` (template key and client
   name). This app calls that tenant `qnipay`, so the rename is applied to the
   extracted JSON rather than by retyping any record. */
const renameTenant = json => json.replace(/qcic/g, 'qnipay').replace(/QCIC/g, 'Qnipay');
writeFileSync(resolve(OUT, 'qnipay.json'), renameTenant(JSON.stringify(shape('qnipay', qnipay, PERMS_META, PERM_GROUPS), null, 1)) + '\n');
writeFileSync(resolve(OUT, 'social.json'), JSON.stringify(shape('social', social, PERMS_META, PERM_GROUPS), null, 1) + '\n');
writeFileSync(resolve(OUT, 'meta.json'), JSON.stringify({
  flags: literal('FLAGS'), modules: literal('MODULES'), permGroups: literal('PERM_GROUPS'), empStates: literal('EMP_STATES') }, null, 1) + '\n');
console.log('seed written: qnipay', (qnipay.PEOPLE || []).length, 'people; social', (social.PEOPLE || []).length, 'people');
w.close();

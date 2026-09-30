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
function literal(name, context = { flagOn: () => true }) {
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
      return JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.slice(open, j + 1) + ')', context)));
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

/* ---- plan 1b: the contract's field names, and the collections 1b reads ---- */
const iso = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const noDash = s => (s === '—' ? '' : (s ?? ''));
/* D13: the worker category a type's people usually have; everything else is Contracted */
const TYPE_CATEGORY = { casual: 'Bank', salaried: 'Salaried' };
const SELF_KEY = { phone: 'phone', addr: 'address', emgName: 'emergencyName', emgPhone: 'emergencyPhone', bankAcc: 'bankAccount', bankSort: 'bankSortCode' };
const SENSITIVE = new Set(['bankAcc', 'bankSort']);
/* Not in the prototype (plan 1b decision D3): payroll's half of a bank detail change. */
const BANK_VERIFY = { c: 'bank_verify', g: 'team', label: 'Verify bank detail changes',
  gate: 'The bank detail queue on Qnipay setup → People', emp: 0, mgr: 0, adm: 1 };

function shape(tenantKey, data, PERMS_META, PERM_GROUPS, PROFILE_CHANGES) {
  const ROLE_OF = { emp: 'employee', mgr: 'manager', adm: 'admin' };
  const people = (data.PEOPLE || []).map(p => meta({
    id: `per_${p.id}`, code: p.id, name: p.nm, email: (p.email || '').toLowerCase(),
    phone: p.phone || '', address: p.addr || '', emergencyName: p.emgName || '', emergencyPhone: p.emgPhone || '',
    bankAccount: p.bankAcc || '', bankSortCode: p.bankSort || '',
    jobProfile: p.job || '', employeeType: p.type || '', category: p.cat || 'Contracted', location: p.loc || '',
    department: p.dept || '', manager: p.mgr && p.mgr !== '—' ? p.mgr : '', contractedHours: p.con ?? 0,
    maxHours: p.max ?? 48, night: !!p.night, resource: String(p.resource || '').toUpperCase(), cis: !!p.cis,
    state: p.state || 'active', start: iso(p.start), end: iso(p.end) }));
  const accounts = Object.entries(data.USERS || {}).map(([email, u]) => meta({
    id: `acc_${email}`, email, personCode: u.eid, userType: u.role, grants: [], revocations: [] }));
  const base = data.PERMS || PERMS_META;
  const perms = base.some(p => p.c === BANK_VERIFY.c) ? base : [...base, BANK_VERIFY];
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
  const rows = (prefix, list, fn) => byId((list || []).map(x => meta(fn(x), { id: `${prefix}_${x.code}` })));
  const locations = rows('loc', data.LOCATIONS, x => ({ code: x.code, name: x.name, area: noDash(x.area), department: x.dept || '',
    costCentre: x.cc || '', level: x.level || '', minPerShift: x.min ?? 1, manager: x.manager || '', address: x.address || '', active: x.active !== false }));
  const departments = rows('dep', data.DEPARTMENTS, x => ({ code: x.code, name: x.name, manager: x.manager || '' }));
  const costCentres = rows('cc', data.COST_CENTRES, x => ({ code: x.code, name: x.name }));
  const jobProfiles = rows('job', data.JOB_PROFILES, x => ({ code: x.code, name: x.name, night: !!x.night }));
  const projects = rows('prj', data.PROJECTS, x => ({ code: x.code, name: x.name, client: noDash(x.client), costCentre: x.cc || '',
    manager: x.manager || '', status: x.status || 'Active', start: iso(x.start), end: iso(x.end),
    budgetHours: noDash(x.budget), billable: !!x.billable, location: x.loc || '' }));
  const employeeTypes = byId(Object.entries(data.TYPES || {}).map(([k, t]) => meta({
    id: `typ_${k}`, code: k, name: t.name, category: TYPE_CATEGORY[k] || 'Contracted',
    mode: t.mode || 'form', uom: t.uom || 'hour', capabilities: t.caps || [] })));
  const codesHere = new Set(people.map(p => p.code));
  const profileChanges = byId(PROFILE_CHANGES.filter(c => codesHere.has(c.eid)).map(c => meta({
    id: `pfc_${c.id}`, personCode: c.eid, field: SELF_KEY[c.k],
    /* D22: a proposal starts from the record's value; the prototype's literal 'from' does not match its own roster */
    from: (people.find(p => p.code === c.eid) || {})[SELF_KEY[c.k]] ?? '', to: c.to, note: c.note || '',
    raisedAt: `${iso(c.raised)}T00:00:00.000Z`, status: 'pending', stage: 'manager',
    route: SENSITIVE.has(c.k) ? ['manager', 'payroll'] : ['manager'], decisions: [] })));
  return { version: 'extracted', tenant: tenantKey, data: {
    people: byId(people), accounts: byId(accounts), userTypes: byId(userTypes), capabilities: byId(capabilities),
    capabilityGroups: byId(capabilityGroups), tenant: { tenant }, locations, departments, costCentres, jobProfiles, projects,
    employeeTypes, profileChanges, personHistory: {}, notices: byId(notices), audit: {} } };
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
/* never persisted by the prototype, so read from its source */
const PROFILE_CHANGES = literal('PROFILE_CHANGES');
const { w, signInAdmin, switchTemplate } = boot();
/* TYPE_LIB builds each type's field set with helper calls (mkFieldCfg over
   the FLD_* lists). Only the fields below are read, so the helpers are stubbed. */
const TYPE_LIB = literal('TYPE_LIB', new Proxy({}, { has: () => true, get: (_t, k) => (k === 'mkFieldCfg' ? () => ({}) : []) }));
const typeArchetypes = Object.entries(TYPE_LIB).map(([key, t]) =>
  ({ key, name: t.name, mode: t.mode || 'form', uom: t.uom || 'hour', capabilities: t.caps || [] }));

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
writeFileSync(resolve(OUT, 'qnipay.json'), renameTenant(JSON.stringify(shape('qnipay', qnipay, PERMS_META, PERM_GROUPS, PROFILE_CHANGES), null, 1)) + '\n');
writeFileSync(resolve(OUT, 'social.json'), JSON.stringify(shape('social', social, PERMS_META, PERM_GROUPS, PROFILE_CHANGES), null, 1) + '\n');
writeFileSync(resolve(OUT, 'meta.json'), JSON.stringify({
  flags: literal('FLAGS'), modules: literal('MODULES'), permGroups: literal('PERM_GROUPS'), empStates: literal('EMP_STATES'),
  supportLevels: literal('SUPPORT_LEVELS'), typeArchetypes, typeCapabilities: literal('CAPS'), selfFields: literal('SELF_FIELDS'),
}, null, 1) + '\n');
console.log('seed written: qnipay', (qnipay.PEOPLE || []).length, 'people,', Object.keys(qnipay.TYPES || {}).length, 'types; social',
  (social.PEOPLE || []).length, 'people,', Object.keys(social.TYPES || {}).length, 'types');
w.close();

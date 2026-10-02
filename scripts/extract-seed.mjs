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
    employeeTypes, profileChanges, personHistory: {}, notices: byId(notices), audit: {}, ...timesheets(data, people) } };
}

/* ---- module 2: timesheets ---- */
/* No money crosses into the app (brief D11): an allowance's £ value, a flat pay
   code's value, a rule value in pounds and the expenses-to-claim field all stay behind. */
const MONEY_FIELDS = new Set(['expenses']);
const isMoney = v => /£/.test(String(v ?? ''));
/* The copy rule: an em-dash aside becomes its own sentence. */
const plain = s => String(s || '').replace(/\s+—\s+(\w)/g, (_m, c) => `. ${c.toUpperCase()}`);
/* 'dd/mm HH:MM' in London summer time (the sample data is all August 2026) to UTC. */
const londonStamp = (dm, hm, year = 2026) => {
  const [d, m] = String(dm).split('/').map(Number), [h, mi] = String(hm).split(':').map(Number);
  return new Date(Date.UTC(year, m - 1, d, h - 1, mi)).toISOString();
};
/* Decisions in the sample data land no later than 09:00 on the prototype's frozen day (its clock reads 13/08/2026 09:12). */
const LAST_DECISION = '2026-08-13T08:00:00.000Z';
const hmToMin = s => { const m = /(\d+)h\s*(\d+)?/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2] || 0) : 0; };
const clockMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const clockAdd = (hm, min) => { const t = (((clockMin(hm) + min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
/* The rota line a submission names gives its start time (the shift_code options
   in FIELDS: Early 07:00–15:00, Late 14:30–22:00, Night 22:00–07:00). The
   prototype held only the hours, so the times are rebuilt from them: a shift
   longer than the hours takes the difference as one break four hours in, and a
   shorter one runs on to make up the hours. */
const SHIFT_TIMES = { E: ['07:00', '15:00'], L: ['14:30', '22:00'], N: ['22:00', '07:00'] };
function entryFor(shift, minutes) {
  const [start, finish] = SHIFT_TIMES[shift] || SHIFT_TIMES.E;
  const span = (((clockMin(finish) - clockMin(start)) % 1440) + 1440) % 1440;
  if (span > minutes) return { start, finish, breaks: [{ start: clockAdd(start, 240), end: clockAdd(start, 240 + span - minutes) }], fields: {} };
  return { start, finish: clockAdd(start, minutes), breaks: [], fields: {} };
}
/* weekLabel's inverse: 'Week 32 · 03–09 Aug 2026' or 'Week 31 · 27 Jul – 02 Aug 2026' to the Monday. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function weekStartOf(label) {
  const m = /·\s*(\d{2})(?:\s+([A-Z][a-z]{2}))?\s*–\s*\d{2}\s+([A-Z][a-z]{2})\s+(\d{4})/.exec(label);
  if (!m) throw new Error('extractor: cannot read the week in ' + label);
  return new Date(Date.UTC(Number(m[4]), MONTHS.indexOf(m[2] || m[3]), Number(m[1]))).toISOString().slice(0, 10);
}
const addIsoDays = (isoDate, n) => new Date(Date.parse(isoDate + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function timesheets(data, people) {
  const CFG = data.CFG || {}, TENANT = data.TENANT || {}, TYPES = data.TYPES || {};
  const byCode = new Map(people.map(p => [p.code, p]));
  /* Names are matched with their spacing normalised: the roster spells Manish
     Nepal with a no-break space, and his reports' manager field with a plain one. */
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const byName = new Map(people.map(p => [norm(p.name), p]));
  const actor = p => ({ personCode: p.code, name: p.name });
  /* D10: the prototype's submissions name care ids (CP-1042...). Where the roster
     has them (social) they are used as they are. Where it does not (qnipay), the
     six rows go, in order, to the six people who report to the managing admin at
     the manager location: not a manager themselves, and still employed. */
  const subs = data.TS_SUBMISSIONS || [];
  const managers = new Set(Object.values(data.USERS || {}).filter(u => u.role === 'manager').map(u => u.eid));
  let owners = subs.map(s => byCode.get(s.eid));
  if (owners.some(o => !o)) {
    const lead = byName.get('Manish Nepal');
    if (!lead) throw new Error('extractor: D10 needs Manish Nepal in the roster');
    const reports = people.filter(p => norm(p.manager) === norm(lead.name) && p.location === lead.location && !managers.has(p.code)
      && p.state === 'active');
    if (reports.length < subs.length) throw new Error(`extractor: D10 needs ${subs.length} reports to ${lead.name}, found ${reports.length}`);
    owners = reports.slice(0, subs.length);
  }
  const managerOf = p => byName.get(norm(p.manager)) || p;
  const days = {}, attempts = {};
  subs.forEach((s, i) => {
    const p = owners[i], date = iso(s.date), id = `tsd_${p.code}_${date}`, mgr = managerOf(p);
    const [dm, hm] = String(s.sub).split(' ');
    const submittedAt = londonStamp(dm, hm);
    /* a decision follows a day after the submission, and never after the frozen clock */
    const decidedAt = new Date(Math.min(Date.parse(submittedAt) + 86400000, Date.parse(LAST_DECISION))).toISOString();
    const proxy = !!s.proxy;
    const parts = String(s.el || '').split('+').map(x => x.trim());
    const allowances = parts.slice(1);
    const reason = s.reason ? plain(s.reason).replace(/([^.?!])$/, '$1.') : '';
    const history = [{ from: 'draft', to: 'pend', by: actor(proxy ? mgr : p), at: submittedAt, reason: proxy ? 'Submitted on their behalf' : '' }];
    if (s.st === 'ok' || s.st === 'back') history.push({ from: 'pend', to: s.st, by: actor(mgr), at: decidedAt, reason: s.st === 'back' ? reason : '' });
    let integrationAttemptId = '';
    if (s.st === 'ok') {
      integrationAttemptId = `int_ts${s.id}`;
      attempts[integrationAttemptId] = meta({ id: integrationAttemptId, event: 'Post to buffer', ref: `${p.name} · ${s.date}`,
        summary: s.el, state: s.bc === 'posted' ? 'posted' : 'queued', attempt: 1, simulated: true, dayId: id, at: decidedAt });
    }
    days[id] = meta({ id, personCode: p.code, date, state: s.st, entries: [entryFor(s.shift, hmToMin(s.hrs))],
      workType: parts[0].split(' ')[0] || 'STD', allowances, shift: s.shift || '', nonWorkingReason: '',
      captureSource: proxy ? 'proxy' : 'self', enteredBy: proxy ? mgr.code : p.code, submittedAt, returnReason: s.st === 'back' ? reason : '',
      warnings: [], history, integrationAttemptId });
  });
  /* TS_MULTIWEEK: past weeks still in draft, as the days they are made of (D1),
     for the person who owns the first submission. 7h 30m a day from Monday. */
  const mwOwner = owners[0];
  if (mwOwner) for (const w of literalTsMultiweek) {
    const start = weekStartOf(w.w), total = hmToMin(w.hrs);
    for (let n = 0; n * 450 < total; n++) {
      const date = addIsoDays(start, n), id = `tsd_${mwOwner.code}_${date}`;
      days[id] = meta({ id, personCode: mwOwner.code, date, state: w.st, workType: 'STD', allowances: [], shift: '',
        entries: [{ start: '09:00', finish: '17:00', breaks: [{ start: '12:30', end: '13:00' }], fields: {} }], nonWorkingReason: '',
        captureSource: 'self', enteredBy: mwOwner.code, submittedAt: '', returnReason: '', warnings: [], history: [], integrationAttemptId: '' });
    }
  }
  /* The one failed posting in INTLOG, so the retry endpoint has something to re-queue.
     The posted rows name care staff from another roster and are left behind. */
  for (const r of data.INTLOG || []) if (r.st === 'failed') {
    const id = `int_${String(r.id).replace(/^INT-/, '')}`;
    const [dm, hm] = String(r.t).split(' ');
    attempts[id] = meta({ id, event: r.ev, ref: r.ref, summary: r.pay, state: 'failed', attempt: r.att || 1, simulated: true,
      cause: r.cause || '', reason: r.reason || r.cause || '', dayId: '', at: londonStamp(dm, hm) });
  }
  const types = Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, {
    fields: Object.fromEntries(Object.entries(t.fields || {}).filter(([c]) => !MONEY_FIELDS.has(c))),
    allowances: t.allow || [],
    rules: (t.rules || []).map(r => ({ trigger: plain(r.trig), when: r.when || '', code: r.code, value: isMoney(r.val) ? '' : (r.val || ''), how: r.how || 'Auto (BC)' })),
    overtime: (t.uom || 'hour') === 'day' ? null : {
      threshold: Number(t.ot?.threshold ?? 40), multiplier: Number(t.ot?.mult ?? 1.5), weekendMultiplier: Number(t.ot?.wbh ?? 1.5) },
  }]));
  const allowances = Object.fromEntries(Object.entries(literalAllowanceLib).map(([code, a]) => [code,
    { code, label: a.label, payCode: a.pay, tier: a.tier, element: `PE-${code.split('_')[0]}`, basis: 'flat' }]));
  const config = meta({ id: 'timesheetConfig', rules: data.TS_RULES || {}, cutoff: TENANT.cutoff || 'Monday 12:00',
    timeFormat: TENANT.timeFmt === 'HH:MM' ? 'HH:MM' : 'h m', returnReasonRequired: TENANT.returnReason !== false,
    weekGrid: CFG.weekGrid || 'hours', weekLayout: CFG.weekLayout || 'classic',
    fieldDefaults: Object.fromEntries(Object.entries(CFG.fields || {}).filter(([c]) => !MONEY_FIELDS.has(c))),
    allowances, types });
  const payCodes = byId((data.BASE_CODES || []).map(b => meta({ id: `pc_${b.code}`, code: b.code, basis: b.basis,
    value: b.basis === 'flat' || isMoney(b.value) ? '' : String(b.value ?? ''), element: b.element, label: b.label || b.code, workType: !!b.wt })));
  return { timesheetConfig: { timesheetConfig: config }, payCodes, timesheetDays: days, integrationAttempts: attempts };
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
const literalAllowanceLib = literal('ALLOWANCE_LIB');
const literalTsMultiweek = literal('TS_MULTIWEEK');
/* The capture field catalogue, less any money: the £ value on each allowance and the expenses-to-claim field. */
const timesheetFields = literal('FIELDS').filter(f => !MONEY_FIELDS.has(f.c))
  .map(f => Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'amt')));
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
  timesheetFields, timesheetRepeats: literal('REPEATS'),
}, null, 1) + '\n');
console.log('seed written: qnipay', (qnipay.PEOPLE || []).length, 'people,', Object.keys(qnipay.TYPES || {}).length, 'types; social',
  (social.PEOPLE || []).length, 'people,', Object.keys(social.TYPES || {}).length, 'types');
w.close();

import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { FlagChanged, ModuleSwitched, Tenant, getTenant, updateTenantSettings } from '@/contract/tenant';
import { renameUserType } from '@/contract/access';
import { Session } from '@/contract/session';
import { isAbsence } from '@/domain/rota';
import { accountOf, audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));
const as = async (p: Persona) => caller(await tokenFor(p));
const T = '/api/v1/tenant';
const MOD = (c: string) => `${T}/modules/${c}`;
const FLAG = (c: string) => `${T}/flags/${c}`;
const SETTINGS = `${T}/settings`;
const WRITES = ['tenant', 'rotaWeeks', 'rotaSetAside', 'employeeTypes', 'timesheetConfig', 'rotaConfig', 'userTypes', 'audit'];

interface Week { id: string; version: number; lines: Record<string, string[]> }
const tenant = () => {
  const t = store.coll<{ version: number; modules: Record<string, boolean>; flags: Record<string, boolean> }>('tenant').tenant;
  if (!t) throw new Error('no tenant');
  return t;
};
const ver = () => tenant().version;
const weeks = () => Object.fromEntries(Object.values(store.coll<Week>('rotaWeeks')).map(w => [w.id, structuredClone(w.lines)]));
const shiftCells = (ws: Record<string, Record<string, string[]>>) =>
  Object.values(ws).flatMap(l => Object.values(l).flat()).filter(c => c && !isAbsence(c)).length;
const read = async () => getTenant.response.parse((await (await as('admin'))('GET', T)).body);
const typeCaps = () => Object.fromEntries(Object.values(store.coll<{ code: string; capabilities: string[] }>('employeeTypes')).map(t => [t.code, [...t.capabilities]]));

describe('reading the tenant', () => {
  test('the GET carries the catalogue state, company, calendar, horizon and the extras from their homes', async () => {
    const t = Tenant.parse(await read());
    expect(t.company).toMatchObject({ registration: '09876543', country: 'United Kingdom', payFrequency: 'Fortnightly', firstPayDate: '2026-08-21' });
    expect(t.company).not.toHaveProperty('currency');
    expect(t.financialYear).toEqual({ start: '2026-04-01', end: '2027-03-31', label: '2026/27' });
    expect(t.weekStart).toBe('Monday');
    expect(t.bankHolidays.map(b => b.date)).toEqual(['2026-08-31', '2026-12-25', '2026-12-28']);
    expect(t.rotaHorizon).toBe(12);
    expect(t.extras).toEqual({ weekGrid: 'times', weekLayout: 'classic', breaksMax: 5, vehiclesMax: 4 });
    expect([t.restore, t.rotaSetAside]).toEqual([{}, 0]);
  });
  test('anyone signed in reads it (every module reader depends on it)', async () => {
    expect((await (await as('employee'))('GET', T)).status).toBe(200);
  });
});

describe('who may switch (Review Focus 1)', () => {
  test('modules and features need Module configuration; a manager and an employee are refused and nothing changes', async () => {
    const calls = { manager: await as('manager'), employee: await as('employee') }, before = snapshot(...WRITES);
    for (const p of ['manager', 'employee'] as const) {
      const call = calls[p];
      for (const [url, body] of [[MOD('L'), { on: false }], [FLAG('NOTICES'), { on: false }], [SETTINGS, { rotaHorizon: 6 }]] as const) {
        const r = await call('PATCH', url, body, ver());
        expect(r.status, `${p} ${url}`).toBe(403);
        expect(Refusal.parse(r.body).code).toBe('capability');
      }
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('settings need Workforce master data, not Module configuration', async () => {
    const acc = store.coll<{ revocations: string[] }>('accounts')[`acc_${accountOf('admin').email}`];
    if (!acc) throw new Error('no admin account');
    acc.revocations = ['master_data'];
    const call = await as('admin');
    const r = await call('PATCH', SETTINGS, { rotaHorizon: 6 }, ver());
    expect([r.status, Refusal.parse(r.body).message]).toEqual([403, 'This needs "Workforce master data", which your access does not include.']);
    expect((await call('PATCH', MOD('L'), { on: false }, ver())).status).toBe(200);
    acc.revocations = ['mod_cfg'];
    const c2 = await as('admin');
    expect((await c2('PATCH', MOD('L'), { on: true }, ver())).status).toBe(403);
    expect((await c2('PATCH', SETTINGS, { rotaHorizon: 6 }, ver())).status).toBe(200);
  });
  test('every write needs the tenant\'s version: missing is 428, stale is 412, and nothing changes', async () => {
    const call = await as('admin'), before = snapshot(...WRITES);
    for (const [url, body] of [[MOD('L'), { on: false }], [FLAG('NOTICES'), { on: false }], [SETTINGS, { rotaHorizon: 6 }]] as const) {
      expect((await call('PATCH', url, body)).status).toBe(428);
      expect((await call('PATCH', url, body, ver() + 1)).status).toBe(412);
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a fault on each write leaves no change and no audit row (Review Focus 7)', async () => {
    const call = await as('admin');
    for (const [url, body] of [[MOD('R'), { on: false }], [MOD('C'), { on: false }], [FLAG('WEEKLY'), { weekLayout: 'days' }], [SETTINGS, { rotaHorizon: 6 }]] as const) {
      const before = snapshot(...WRITES);
      await fault('PATCH', url);
      expect((await call('PATCH', url, body, ver())).status, url).toBe(500);
      expect(snapshot(...WRITES), url).toEqual(before);
    }
  });
});

describe('modules (Review Focus 2)', () => {
  test('Workforce core is LOCKED: nothing changes and no audit row', async () => {
    const call = await as('admin'), before = snapshot(...WRITES);
    const r = await call('PATCH', MOD('CORE'), { on: false }, ver());
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'LOCKED', message: 'Workforce core cannot be switched off. Everything else depends on it.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('an unknown module is 404', async () => {
    expect((await (await as('admin'))('PATCH', MOD('XX'), { on: true }, ver())).status).toBe(404);
  });
  test('switching to the state it is in writes nothing and no audit row', async () => {
    const call = await as('admin'), before = snapshot(...WRITES);
    const out = ModuleSwitched.parse((await call('PATCH', MOD('R'), { on: true }, ver())).body);
    expect(out.auditId).toBeNull();
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('Timesheet off remembers its capture methods, a capture method then refuses MODULE_OFF, and on restores exactly them', async () => {
    const call = await as('admin');
    await call('PATCH', MOD('B'), { on: false }, ver());
    const off = ModuleSwitched.parse((await call('PATCH', MOD('TS'), { on: false }, ver())).body);
    expect(off.effect.capturesRemembered).toEqual(['A', 'C']);
    expect(off.record.restore).toEqual({ TS: ['A', 'C'] });
    expect([off.record.modules.TS, off.record.modules.A, off.record.modules.B, off.record.modules.C]).toEqual([false, false, false, false]);
    expect(off.effect.kept).toEqual([{ what: 'timesheet days', count: Object.keys(store.coll('timesheetDays')).length }]);
    expect(audits().find(a => a.id === off.auditId)).toMatchObject({ act: 'Module turned off', entity: 'tenant', entityId: 'TS' });
    expect(Object.keys(store.coll('timesheetDays')).length).toBeGreaterThan(0);

    const before = snapshot(...WRITES);
    const refused = await call('PATCH', MOD('A'), { on: true }, ver());
    expect([refused.status, Refusal.parse(refused.body).code]).toEqual([409, 'MODULE_OFF']);
    expect(snapshot(...WRITES)).toEqual(before);

    const on = ModuleSwitched.parse((await call('PATCH', MOD('TS'), { on: true }, ver())).body);
    expect(on.effect.capturesRestored).toEqual(['A', 'C']);
    expect([on.record.modules.TS, on.record.modules.A, on.record.modules.B, on.record.modules.C]).toEqual([true, true, false, true]);
    expect(on.record.restore).toEqual({});
    expect(on.effect.message).toBe('Timesheet turned on with Manual time entry, Sites & locations. It is live for everyone now.');
    expect(audits().find(a => a.id === on.auditId)?.act).toBe('Module turned on');
  });
  test('Rota off clears every shift but leave and sickness, keeps them aside with a true count, and on restores them exactly', async () => {
    const call = await as('admin'), original = weeks(), shifts = shiftCells(original);
    expect(shifts).toBeGreaterThan(0);
    const off = ModuleSwitched.parse((await call('PATCH', MOD('R'), { on: false }, ver())).body);
    expect(off.effect.shiftsSetAside).toBe(shifts);
    expect(off.record.rotaSetAside).toBe(shifts);
    expect(off.effect.message).toContain(`${shifts} scheduled shifts cleared from the calendar`);
    expect(shiftCells(weeks())).toBe(0);
    /* leave and sickness stay where they were */
    const absences = (ws: Record<string, Record<string, string[]>>) => JSON.stringify(Object.values(ws).map(l => Object.values(l).map(x => x.map(c => (isAbsence(c) ? c : '')))));
    expect(absences(weeks())).toBe(absences(original));
    /* every record kept, with true counts */
    expect(off.effect.kept).toEqual([
      { what: 'rota weeks', count: Object.keys(store.coll('rotaWeeks')).length },
      { what: 'working patterns', count: Object.keys(store.coll('patterns')).length },
      { what: 'cover requests', count: Object.keys(store.coll('coverRequests')).length },
    ]);
    const mgr = await as('manager');
    expect((await mgr('GET', '/api/v1/rota/home')).status).toBe(403);

    const on = ModuleSwitched.parse((await call('PATCH', MOD('R'), { on: true }, ver())).body);
    expect(on.effect.shiftsRestored).toBe(shifts);
    expect(on.record.rotaSetAside).toBe(0);
    expect(weeks()).toEqual(original);
    expect(on.effect.message).toBe(`Rota turned on. It is live for everyone now. ${shifts} scheduled shifts restored to the calendar.`);
    expect((await mgr('GET', '/api/v1/rota/home')).status).toBe(200);
  });
  test('leave recorded on a cleared cell while Rota is off wins on restore, and the count says so', async () => {
    const call = await as('admin'), original = weeks(), shifts = shiftCells(original);
    await call('PATCH', MOD('R'), { on: false }, ver());
    const [id, lines] = Object.entries(original).find(([, l]) => Object.values(l).some(x => x.some(c => c && !isAbsence(c)))) ?? [];
    if (!id || !lines) throw new Error('no week with a shift');
    const [person, line] = Object.entries(lines).find(([, x]) => x.some(c => c && !isAbsence(c))) ?? [];
    if (!person || !line) throw new Error('no line with a shift');
    const day = line.findIndex(c => c && !isAbsence(c));
    const w = store.coll<Week>('rotaWeeks')[id];
    if (!w) throw new Error('week gone');
    const held = w.lines[person];
    if (!held) throw new Error('line gone');
    held[day] = 'V';
    const on = ModuleSwitched.parse((await call('PATCH', MOD('R'), { on: true }, ver())).body);
    expect(on.effect.shiftsRestored).toBe(shifts - 1);
    expect(store.coll<Week>('rotaWeeks')[id]?.lines[person]?.[day]).toBe('V');
  });
  /* I2: with Rota off, approving leave and recording sickness write nothing to the rota, so the cell is empty on restore */
  const AMARA_WEEK = 'rw_WH_2026-08-10';
  const amaraLine = () => store.coll<Week>('rotaWeeks')[AMARA_WEEK]?.lines['CP-1042'];
  async function offThenAbsent() {
    const admin = await as('admin'), mgr = await as('manager'), emp = await as('employee');
    expect(amaraLine()).toEqual(['E', 'E', '', 'N', 'N', '', '']);
    const shifts = shiftCells(weeks());
    await admin('PATCH', MOD('R'), { on: false }, ver());
    const asked = await emp('POST', '/api/v1/leave/requests', { type: 'AL', part: 'full', from: '2026-08-14', to: '2026-08-14' });
    expect(asked.status).toBe(200);
    const id = (asked.body as { record: { id: string } }).record.id;
    expect((await mgr('POST', `/api/v1/leave/requests/${id}/approve`, undefined, 1)).status).toBe(200);
    expect((await mgr('POST', '/api/v1/leave/sickness', { personCode: 'CP-1042', from: '2026-08-11', to: '2026-08-11', reason: 'Other' })).status).toBe(200);
    return { admin, shifts };
  }
  test('Rota on never puts a set-aside shift back over approved leave or sickness: the cell takes V or S with LV_ROTA on, and the count says so (I2)', async () => {
    const { admin, shifts } = await offThenAbsent();
    const on = ModuleSwitched.parse((await admin('PATCH', MOD('R'), { on: true }, ver())).body);
    expect(amaraLine()).toEqual(['E', 'S', '', 'N', 'V', '', '']);
    expect([on.effect.shiftsRestored, on.effect.shiftsNotRestored]).toEqual([shifts - 2, 2]);
    expect(on.effect.message).toBe(`Rota turned on. It is live for everyone now. ${shifts - 2} scheduled shifts restored to the calendar. `
      + '2 shifts were not put back because the person is on leave or off sick that day.');
    expect(audits().filter(a => a.id === on.auditId)).toHaveLength(1);
  });
  test('without LV_ROTA, a set-aside shift on an absence day stays empty on restore (I2)', async () => {
    const t = tenant();
    t.flags.LV_ROTA = false;
    const { admin, shifts } = await offThenAbsent();
    const on = ModuleSwitched.parse((await admin('PATCH', MOD('R'), { on: true }, ver())).body);
    expect(amaraLine()).toEqual(['E', '', '', 'N', '', '', '']);
    expect([on.effect.shiftsRestored, on.effect.shiftsNotRestored]).toEqual([shifts - 2, 2]);
  });
  test('Sites off takes the site capability off every employee type and says which; on does not put it back (as the prototype)', async () => {
    const call = await as('admin'), before = typeCaps();
    expect(Object.values(before).filter(c => c.includes('site')).length).toBe(2);
    const off = ModuleSwitched.parse((await call('PATCH', MOD('C'), { on: false }, ver())).body);
    expect(off.effect.siteRemovedFrom.sort()).toEqual(['Relief / Bank Worker', 'Support Worker'].sort());
    expect(Object.values(typeCaps()).some(c => c.includes('site'))).toBe(false);
    expect(audits().filter(a => a.id === off.auditId)).toHaveLength(1);
    ModuleSwitched.parse((await call('PATCH', MOD('C'), { on: true }, ver())).body);
    expect(Object.values(typeCaps()).some(c => c.includes('site'))).toBe(false);
  });
  test('Clock in / out off keeps every timesheet day and clock record, with true counts', async () => {
    const id = 'clk_CP-1042_2026-08-13';
    store.coll('clockRecords')[id] = { id, version: 1, updatedAt: '2026-08-13T06:00:00.000Z', personCode: 'CP-1042', date: '2026-08-13',
      events: [{ kind: 'in', at: '2026-08-13T06:00:00.000Z' }], late: false, closedLate: null };
    const call = await as('admin');
    const off = ModuleSwitched.parse((await call('PATCH', MOD('B'), { on: false }, ver())).body);
    expect(off.effect.kept).toEqual([
      { what: 'timesheet days', count: Object.keys(store.coll('timesheetDays')).length },
      { what: 'clock records', count: 1 },
    ]);
    expect(Object.keys(store.coll('clockRecords'))).toEqual([id]);
  });
  test('Leave off keeps every request and episode; Leave reads refuse until it is back on, then work', async () => {
    const call = await as('admin'), mgr = await as('manager');
    const off = ModuleSwitched.parse((await call('PATCH', MOD('L'), { on: false }, ver())).body);
    expect(off.effect.kept).toEqual([
      { what: 'leave requests', count: Object.keys(store.coll('leaveRequests')).length },
      { what: 'sickness episodes', count: Object.keys(store.coll('sickEpisodes')).length },
    ]);
    expect((await mgr('GET', '/api/v1/leave/me')).status).toBe(403);
    await call('PATCH', MOD('L'), { on: true }, ver());
    expect((await mgr('GET', '/api/v1/leave/me')).status).toBe(200);
  });
});

describe('features and their extras', () => {
  test('a feature of a module that is off is MODULE_OFF (qnipay runs without Rota), and nothing changes', async () => {
    resetTo('qnipay');
    const call = await as('admin'), before = snapshot(...WRITES);
    const r = await call('PATCH', FLAG('FULFIL'), { on: true }, ver());
    expect(r.status).toBe(409);
    expect(Refusal.parse(r.body)).toMatchObject({ code: 'MODULE_OFF', message: 'Rota is off, so its features cannot be changed.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a feature switch writes one Feature changed row', async () => {
    const out = FlagChanged.parse((await (await as('admin'))('PATCH', FLAG('NOTICES'), { on: false }, ver())).body);
    expect(out.record.flags.NOTICES).toBe(false);
    expect(out.message).toBe('Notice board off. It is live for everyone now.');
    expect(audits().filter(a => a.id === out.auditId)).toEqual([expect.objectContaining({ act: 'Feature changed', entityId: 'NOTICES', before: { on: true } })]);
  });
  test('the weekly layout and capture write through to Timesheet setup, which module 2 keeps reading', async () => {
    const call = await as('admin');
    const tcBefore = store.coll<{ version: number }>('timesheetConfig').timesheetConfig?.version ?? 0;
    const out = FlagChanged.parse((await call('PATCH', FLAG('WEEKLY'), { weekGrid: 'hours', weekLayout: 'days' }, ver())).body);
    expect(out.record.extras).toMatchObject({ weekGrid: 'hours', weekLayout: 'days' });
    expect(store.coll<{ version: number; weekLayout: string; weekGrid: string }>('timesheetConfig').timesheetConfig).toMatchObject({ weekGrid: 'hours', weekLayout: 'days', version: tcBefore + 1 });
    const setup = (await call('GET', '/api/v1/timesheet-config')).body as { config: { weekLayout: string } };
    expect(setup.config.weekLayout).toBe('days');
    expect(audits().filter(a => a.id === out.auditId)).toEqual([expect.objectContaining({ act: 'Feature changed', before: { weekGrid: 'times', weekLayout: 'classic' } })]);
  });
  test('the breaks stepper and vehicle maximum keep to their bounds; extras of a feature that is off are FLAG_OFF', async () => {
    const call = await as('admin');
    const ok = FlagChanged.parse((await call('PATCH', FLAG('BREAKS'), { breaksMax: 3 }, ver())).body);
    expect(ok.record.extras.breaksMax).toBe(3);
    const before = snapshot(...WRITES);
    const high = await call('PATCH', FLAG('BREAKS'), { breaksMax: 6 }, ver());
    expect([high.status, Refusal.parse(high.body).message]).toEqual([422, 'Breaks per entry must be between 1 and 5.']);
    const off = await call('PATCH', FLAG('VEHICLE'), { vehiclesMax: 2 }, ver());
    expect([off.status, Refusal.parse(off.body).code]).toEqual([409, 'FLAG_OFF']);
    const stray = await call('PATCH', FLAG('BREAKS'), { weekGrid: 'hours' }, ver());
    expect([stray.status, Refusal.parse(stray.body).field]).toEqual([422, 'weekGrid']);
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

describe('settings', () => {
  test('the rota horizon goes to Rota setup, its one home, with one audit row', async () => {
    const call = await as('admin');
    const out = updateTenantSettings.response.parse((await call('PATCH', SETTINGS, { rotaHorizon: 6 }, ver())).body);
    expect(out.record.rotaHorizon).toBe(6);
    expect(store.coll<{ horizon: number }>('rotaConfig').rotaConfig?.horizon).toBe(6);
    expect(audits().filter(a => a.id === out.auditId)).toEqual([expect.objectContaining({ act: 'Rota horizon changed', before: { rotaHorizon: 12 }, after: { rotaHorizon: 6 } })]);
    const bad = await call('PATCH', SETTINGS, { rotaHorizon: 7 }, ver());
    expect([bad.status, Refusal.parse(bad.body).message]).toEqual([422, 'Choose a rota horizon of 12, 6 or 3 months.']);
  });
  test('on a tenant that never set up Rota, the horizon creates Rota setup at its defaults', async () => {
    resetTo('qnipay');
    const out = updateTenantSettings.response.parse((await (await as('admin'))('PATCH', SETTINGS, { rotaHorizon: 3 }, ver())).body);
    expect(out.record.rotaHorizon).toBe(3);
    expect(store.coll<{ horizon: number; version: number }>('rotaConfig').rotaConfig).toMatchObject({ horizon: 3, version: 1 });
  });
  test('company details change, and a currency is not accepted', async () => {
    const call = await as('admin');
    const out = updateTenantSettings.response.parse((await call('PATCH', SETTINGS, { company: { payFrequency: 'Monthly' } }, ver())).body);
    expect(out.record.company.payFrequency).toBe('Monthly');
    expect(audits().find(a => a.id === out.auditId)?.act).toBe('Organisation settings changed');
    expect((await call('PATCH', SETTINGS, { company: { currency: 'EUR €' } }, ver())).status).toBe(422);
  });
});

describe('role names (D11)', () => {
  const URL = (id: string) => `/api/v1/user-types/${id}`;
  const typeVer = (id: string) => store.coll<{ version: number }>('userTypes')[id]?.version ?? -1;
  test('a rename changes only the name, writes Roles renamed, and the session\'s role name follows', async () => {
    const caps = store.coll<{ capabilities: string[] }>('userTypes').manager?.capabilities;
    const out = renameUserType.response.parse((await (await as('admin'))('PATCH', URL('manager'), { name: '  Service Manager ' }, typeVer('manager'))).body);
    expect(out.record).toMatchObject({ name: 'Service Manager', capabilities: caps });
    expect(audits().find(a => a.id === out.auditId)).toMatchObject({ act: 'Roles renamed', before: { name: 'Manager' }, after: { name: 'Service Manager' } });
    const s = Session.parse((await (await as('manager'))('GET', '/api/v1/session')).body);
    expect(s.account.roleName).toBe('Service Manager');
  });
  test('every role needs a name, at most 24 characters, and two roles cannot share one (ignoring case); nothing changes', async () => {
    const call = await as('admin'), before = snapshot(...WRITES);
    const blank = await call('PATCH', URL('employee'), { name: '  ' }, typeVer('employee'));
    expect([blank.status, Refusal.parse(blank.body)]).toEqual([422, expect.objectContaining({ field: 'name', message: 'Every role needs a name.' })]);
    const long = await call('PATCH', URL('employee'), { name: 'x'.repeat(25) }, typeVer('employee'));
    expect(long.status).toBe(422);
    const dup = await call('PATCH', URL('employee'), { name: 'ADMIN' }, typeVer('employee'));
    expect([dup.status, Refusal.parse(dup.body)]).toEqual([409, expect.objectContaining({ code: 'NAME_TAKEN', field: 'name', message: 'Two roles cannot share a name.' })]);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('it needs Permissions and role configuration, and a fault changes nothing', async () => {
    const mgr = await as('manager'), admin = await as('admin'), before = snapshot(...WRITES);
    const r = await mgr('PATCH', URL('employee'), { name: 'Support Worker' }, typeVer('employee'));
    expect([r.status, Refusal.parse(r.body).code]).toEqual([403, 'capability']);
    await fault('PATCH', URL('employee'));
    expect((await admin('PATCH', URL('employee'), { name: 'Support Worker' }, typeVer('employee'))).status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

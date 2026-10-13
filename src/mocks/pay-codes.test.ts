import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { PayCodeList, PayCodeRecord, createPayCode, updatePayCode } from '@/contract/pay-codes';
import { TimesheetSetup, TimesheetWeek } from '@/contract/timesheets';
import { audits, caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

/* social at the frozen clock. The administrator holds mod_cfg and
   master_data; the manager and the employee hold neither. STD is claimed by
   the hourly types and recorded on timesheet days; OT20 nothing uses. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const pcAudits = () => audits().filter(a => a.entity === 'payCode');
const OT_BH = { code: 'ot-bh', label: 'Overtime bank holiday', basis: 'multiplier', value: '2', element: 'pe-otbh', workType: true };
const create = async (body: unknown, p: Persona = 'admin') => (await as(p))('POST', '/api/v1/pay-codes', body);
async function list() {
  const r = await (await as('admin'))('GET', '/api/v1/pay-codes');
  expect(r.status).toBe(200);
  return PayCodeList.parse(r.body);
}
const stored = (id: string) => PayCodeRecord.parse(store.coll('payCodes')[id]);

describe('the list (mod_cfg)', () => {
  test('the base codes with who claims them and what uses them, then the allowance codes, and no amount anywhere', async () => {
    const l = await list();
    expect(l.codes.map(c => c.code)).toEqual(['STD', 'OT15', 'OT20', 'OT-WD', 'OT-SAT', 'OT-SUN', 'NIGHT', 'TRAVEL', 'DAY_RATE', 'UNSOC', 'ABS', 'LVE', 'SSP']);
    const std = l.codes.find(c => c.code === 'STD');
    expect(std?.claimedBy.map(t => t.code)).toEqual(['shift', 'casual']);
    expect(std?.usedBy.map(u => u.kind)).toEqual(['employee-types', 'timesheet-days']);
    expect(l.codes.find(c => c.code === 'OT20')?.usedBy).toEqual([]);
    expect(l.codes.filter(c => c.basis === 'flat' || c.basis === 'units').every(c => c.value === '')).toBe(true);
    expect(l.allowances.find(a => a.code === 'SLEEP_IN')).toEqual({ code: 'SLEEP_IN', label: 'Sleep-in', element: 'PE-SLEEP', claimedBy: [{ code: 'shift', name: 'Support Worker' }] });
    expect(JSON.stringify(l)).not.toMatch(/[£$€]|amount|currency/i);
  });
  test('a session without mod_cfg is refused', async () => {
    const r = await (await as('manager'))('GET', '/api/v1/pay-codes');
    expect([r.status, refusal(r).code]).toEqual([403, 'capability']);
  });
});

describe('create (master_data)', () => {
  test('a valid code is stored in capitals with one audit row carrying its basis and element, and is at once a rate type option', async () => {
    const r = await create(OT_BH);
    expect(r.status).toBe(200);
    const { record, auditId } = createPayCode.response.parse(r.body);
    expect(record).toMatchObject({ id: 'pc_OT-BH', version: 1, code: 'OT-BH', element: 'PE-OTBH', basis: 'multiplier', value: '2', workType: true });
    expect(pcAudits()).toEqual([expect.objectContaining({ id: auditId, act: 'Pay code created', entityId: 'OT-BH', before: null,
      after: { code: 'OT-BH', label: 'Overtime bank holiday', basis: 'multiplier', value: '2', element: 'PE-OTBH', workType: true } })]);
    const cfg = TimesheetSetup.parse((await (await as('admin'))('GET', '/api/v1/timesheet-config')).body);
    expect(cfg.payCodes.map(p => p.code)).toContain('OT-BH');
    const week = TimesheetWeek.parse((await (await as('employee'))('GET', '/api/v1/timesheets/CP-1042/weeks/2026-08-10')).body);
    expect(week.capture.payCodes.find(p => p.code === 'OT-BH')).toMatchObject({ label: 'Overtime bank holiday', workType: true });
  });
  test.each([
    ['no code', { code: '' }, 'code', 'A code is required.'],
    ['a malformed code', { code: 'x' }, 'code', 'A code is 2 to 12 characters: a letter first, then letters, digits, dashes or underscores, like OT-BH.'],
    ['a duplicate code', { code: 'std' }, 'code', 'STD already exists. Codes must be unique because Business Central matches on them.'],
    ['an element mapped to another code', { element: 'PE-STD' }, 'element', 'PE-STD is already mapped to STD. One element, one code.'],
    ['a multiplier with no value', { value: '' }, 'value', 'A value is required for a multiplier on base rate.'],
    ['a flat code with a value', { basis: 'flat', value: '21' }, 'value', 'A flat code has no value here. The amount is set in Business Central.'],
  ])('%s is refused with 422 on its field, and nothing is written', async (_, patch, field, message) => {
    const call = await as('admin');
    const before = snapshot('payCodes', 'audit');
    const r = await call('POST', '/api/v1/pay-codes', { ...OT_BH, ...patch });
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'invalid', field, message });
    expect(snapshot('payCodes', 'audit')).toEqual(before);
  });
  test('the contract refuses an amount: a currency value, and a body carrying an amount field', async () => {
    const pound = await create({ ...OT_BH, value: '£21' });
    expect([pound.status, refusal(pound).field]).toEqual([422, 'value']);
    const extra = await create({ ...OT_BH, amount: '21' });
    expect(extra.status).toBe(422);
    expect(refusal(extra).message).toMatch(/fields it should not: amount/);
    expect(createPayCode.request.safeParse({ ...OT_BH, value: '1.5' }).success).toBe(true);
    expect(createPayCode.request.safeParse({ ...OT_BH, value: '-1' }).success).toBe(false);
  });
  test('a session without master_data is refused', async () => {
    const r = await create(OT_BH, 'manager');
    expect([r.status, refusal(r).code]).toEqual([403, 'capability']);
    expect(pcAudits()).toEqual([]);
  });
});

describe('edit (If-Match)', () => {
  test('it says which fields changed and is audited as a diff; nothing changed writes nothing', async () => {
    const call = await as('admin');
    const r = await call('PATCH', '/api/v1/pay-codes/pc_OT20', { value: '2.5', workType: false, code: 'OT20' }, 1);
    expect(r.status).toBe(200);
    const d = updatePayCode.response.parse(r.body);
    expect([d.changed, d.record.version, d.record.value]).toEqual([['value', 'workType'], 2, '2.5']);
    expect(pcAudits()).toEqual([expect.objectContaining({ act: 'Pay code edited', entityId: 'OT20', before: { value: '2', workType: true }, after: { value: '2.5', workType: false } })]);
    const same = updatePayCode.response.parse((await call('PATCH', '/api/v1/pay-codes/pc_OT20', { value: '2.5' }, 2)).body);
    expect([same.changed, same.auditId, pcAudits().length]).toEqual([[], null, 1]);
  });
  test('the code cannot change, and an edit is checked as a create is', async () => {
    const call = await as('admin');
    const code = await call('PATCH', '/api/v1/pay-codes/pc_OT20', { code: 'OT25' }, 1);
    expect([code.status, refusal(code).field, refusal(code).message]).toEqual([422, 'code', 'The code cannot change once it exists. Postings already reference it.']);
    const clash = await call('PATCH', '/api/v1/pay-codes/pc_OT20', { element: 'PE-OT15' }, 1);
    expect(refusal(clash).message).toBe('PE-OT15 is already mapped to OT15. One element, one code.');
    expect(stored('pc_OT20').version).toBe(1);
  });
  test('a stale save is refused with 412 and changes nothing', async () => {
    const r = await (await as('admin'))('PATCH', '/api/v1/pay-codes/pc_OT20', { value: '3' }, 0);
    expect([r.status, refusal(r).code]).toEqual([412, 'stale']);
    expect(stored('pc_OT20').value).toBe('2');
    expect(pcAudits()).toEqual([]);
  });
});

describe('remove (If-Match, D2)', () => {
  test('a code in use is refused with 409 naming what uses it', async () => {
    const r = await (await as('admin'))('DELETE', '/api/v1/pay-codes/pc_STD', undefined, 1);
    expect(r.status).toBe(409);
    const x = refusal(r);
    expect(x.code).toBe('in-use');
    expect(x.message).toMatch(/^STD is used by 2 employee types and \d+ timesheet days\.$/);
    expect(x.usedBy?.map(u => u.kind)).toEqual(['employee-types', 'timesheet-days']);
    expect(store.coll('payCodes').pc_STD).toBeDefined();
  });
  test('an unused code is removed with one audit row and is gone from the list', async () => {
    const r = await (await as('admin'))('DELETE', '/api/v1/pay-codes/pc_OT20', undefined, 1);
    expect(r.status).toBe(200);
    expect(pcAudits()).toEqual([expect.objectContaining({ act: 'Pay code removed', entityId: 'OT20', after: null })]);
    expect((await list()).codes.map(c => c.code)).not.toContain('OT20');
  });
  test('a manager is refused, and a stale remove gets 412', async () => {
    const m = await (await as('manager'))('DELETE', '/api/v1/pay-codes/pc_OT20', undefined, 1);
    expect([m.status, refusal(m).code]).toEqual([403, 'capability']);
    const s = await (await as('admin'))('DELETE', '/api/v1/pay-codes/pc_OT20', undefined, 5);
    expect(s.status).toBe(412);
    expect(store.coll('payCodes').pc_OT20).toBeDefined();
  });
});

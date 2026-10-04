import {
  CANCELLED_TOAST, CHOOSE_TYPE, DEFAULT_LEAVE_CONFIG, DEFAULT_TYPE_LEAVE, LAST_BEFORE_FIRST, OVER_BALANCE, PICK_BOTH_DATES, REASON_REQUIRED, ROTA_OFF_IMPACT,
  RTW_ALREADY, RTW_TOAST, SELF_APPROVAL, SETTLED_IN_PAYROLL, absenceBlockedProblem, absenceHeldReason, absenceCellPlan, absenceCellWrites, bookedLeaveDates, datesCellPlan, sicknessDates, absenceMark, absenceOn, approvedNotice,
  approvedToast, balanceOf, balanceText, bradford, cancelTip, cancelWindowAdvisory, cancelledNotice, coverImpact, dailyHours, daysReturnedNotice,
  daysReturnedToast, daysToTakeText, declineReasonProblem, declinedNotice, declinedToast, entitlement, episodeDays, episodeEnd, escalationText,
  giveBackProblem, giveBackRow, halfDaySingle, latestAbsenceText, leaveCan, leaveConfigProblem, leaveCoverReason, leaveRange, leaveRotaWhy, leaveShape,
  leaveTransitionProblem, leaveTypeName, leaveWritesRota, leaveYear, ledgerQty, monthsWorked, moreThanLeft, newLeaveStage, newLeaveType, nextStepText,
  noticeAdvisory, policyBy, proRataSimulation, reconcileLeaver, recordSicknessPlan, renumberLeaveStages, requestDays, requestProblem, requestedNotice,
  requestedToast, rtwNotices, rtwProblem, selfApprovalProblem, sentNotice, serviceBonus, shortDays, sickDuringLeave, sicknessToast, slaBreachedText,
  slaOf, slaPillText, stageText, tellManagerToast, triggerBannerText, typeBalanceText, typeLeaveFor, wouldRemain, yearBalance, yearShares, yearsService,
  type LeavePolicy, type LeaveRecord, type LeaveStage, type LeaveType, type LedgerRow,
} from './leave';
import { emptyWeek, setCells } from './rota';

const TODAY = '2026-08-13';
const STD: LeavePolicy = { code: 'STD', name: 'Standard annual leave', method: 'Statutory + service', unit: 'days', base: 24, statutory: 28,
  serviceRule: '+1 day per 3 years, capped at 5', prorata: 'By contracted hours ÷ full-time hours', carry: 5, approval: true, sla: 5, escalate: true, bh: 'On top of entitlement' };
const ACC: LeavePolicy = { ...STD, code: 'ACC', name: 'Accrual (bank / flexible)', method: '12.07% of hours worked', unit: 'hours', base: 0, serviceRule: 'Not applied' };
const FIX: LeavePolicy = { ...STD, code: 'FIX', name: 'Fixed allowance', method: 'Fixed days per year', base: 5, serviceRule: 'Not applied' };
const NONE: LeavePolicy = { ...STD, code: 'NONE', name: 'No entitlement', method: 'Unpaid, no balance', base: 0, serviceRule: 'Not applied' };
const HRIS: LeavePolicy = { ...STD, code: 'HRIS', name: 'Held in the HRIS', method: 'Statutory scheme, managed outside Workforce', unit: 'weeks', base: 0, serviceRule: 'Per statute' };
const SICKP: LeavePolicy = { ...NONE, code: 'SICK', name: 'Sickness absence', method: 'Occupational scheme' };
const TOILP: LeavePolicy = { ...NONE, code: 'TOIL', name: 'Time off in lieu', method: 'Banked from approved overtime', unit: 'hours' };
const POLICIES = [STD, ACC, TOILP, FIX, NONE, HRIS, SICKP];
const type = (code: string, o: Partial<LeaveType> = {}): LeaveType => ({ code, name: code, icon: '•', short: code, policy: 'STD', paid: true, evidence: false, unit: 'days', active: true, ...o });
const TYPES: LeaveType[] = [type('AL', { name: 'Annual leave' }), type('TOIL', { name: 'Time off in lieu', policy: 'TOIL', unit: 'hours' }),
  type('SICK', { name: 'Sickness', policy: 'SICK' }), type('PAR', { name: 'Parental leave', policy: 'HRIS', unit: 'weeks' }), type('OLD', { active: false })];
const STAGES: LeaveStage[] = [
  { n: 1, who: 'Employee', action: 'Request submitted and validated against balance', wait: 0, channel: 'In-app' },
  { n: 2, who: 'Line manager', action: 'Decision required', wait: 5, channel: 'In-app + email' },
  { n: 3, who: 'Service Manager', action: 'Escalated. SLA breached', wait: 2, channel: 'In-app + email' },
  { n: 4, who: 'HR administrator', action: 'Final escalation and manual resolution', wait: 2, channel: 'Email' }];
const rec = (o: Partial<LeaveRecord> & { id?: string } = {}): LeaveRecord & { id: string } =>
  ({ id: 'lr_1', type: 'AL', from: '2026-08-17', to: '2026-08-18', part: 'full', qty: 2, unit: 'days', state: 'approved', ...o });
const ME = { personCode: 'CP-1001', name: 'Rachel Hussain' };
const AT = '2026-08-13T08:12:00.000Z';

describe('types, policies and the leave year', () => {
  test('policyBy falls back to the first policy; a type with no leave setting uses Standard in days', () => {
    expect(policyBy(POLICIES, 'ACC')?.code).toBe('ACC');
    expect(policyBy(POLICIES, 'ZZZ')?.code).toBe('STD');
    expect(policyBy([], 'STD')).toBeUndefined();
    expect(typeLeaveFor({ casual: { policy: 'ACC', unit: 'hours' } }, 'casual')).toEqual({ policy: 'ACC', unit: 'hours' });
    expect(typeLeaveFor({}, 'shift')).toEqual(DEFAULT_TYPE_LEAVE);
    expect(typeLeaveFor({}, '__proto__')).toEqual(DEFAULT_TYPE_LEAVE);
    expect([leaveTypeName(TYPES, 'AL'), leaveTypeName(TYPES, 'XYZ')]).toEqual(['Annual leave', 'XYZ']);
  });
  test('a day of leave is a fifth of the contracted week, or 7.5 hours on no fixed hours', () => {
    expect([dailyHours(37.5), dailyHours(22.5), dailyHours(0)]).toEqual([7.5, 4.5, 7.5]);
  });
  test('what each type draws on, as the request form lists it', () => {
    const toil = { hours: 6, useBy: '2026-09-30' };
    expect(typeBalanceText(type('AL'), STD, '13.5 of 25 days left', toil)).toBe('13.5 of 25 days left');
    expect(typeBalanceText(type('TOIL'), undefined, '', toil)).toBe('6 hours built up · use by 30/09/2026');
    expect(typeBalanceText(type('TOIL'), undefined, '', { hours: 0, useBy: '' })).toBe('0 hours built up');
    expect(typeBalanceText(type('UNP'), NONE, '', toil)).toBe('No limit. Unpaid.');
    expect(typeBalanceText(type('COMP'), FIX, '', toil)).toBe('5 days a year');
    expect(typeBalanceText(type('PAR'), HRIS, '', toil)).toBe('Held in the HRIS');
    expect(typeBalanceText(type('SICK'), SICKP, '', toil)).toBe('Occupational scheme applies');
    expect(typeBalanceText(type('X'), STD, '', toil)).toBe('—');
  });
  test('the leave year runs from finYearStart', () => {
    expect(leaveYear(TODAY, '01/04')).toEqual({ start: '2026-04-01', end: '2027-03-31', label: '2026/27' });
    expect(leaveYear('2026-02-10', '01/04')).toEqual({ start: '2025-04-01', end: '2026-03-31', label: '2025/26' });
    expect(leaveYear('2026-08-13', '01/01').label).toBe('2026/26');
  });
  test('leave reaches the rota only with Rota on and LV_ROTA on', () => {
    expect(leaveWritesRota({ R: true }, { LV_ROTA: true })).toBe(true);
    expect(leaveWritesRota({ R: false }, { LV_ROTA: true })).toBe(false);
    expect(leaveWritesRota({ R: true }, { LV_ROTA: false })).toBe(false);
  });
});

describe('leave setup (D11)', () => {
  const ok = () => leaveConfigProblem(DEFAULT_LEAVE_CONFIG, TYPES, POLICIES, STAGES, { shift: { policy: 'STD', unit: 'days' } }, ['shift']);
  const cfg = (o: Partial<typeof DEFAULT_LEAVE_CONFIG>) => leaveConfigProblem({ ...DEFAULT_LEAVE_CONFIG, ...o }, TYPES, POLICIES, STAGES, {}, []);
  test('the seeded setup passes', () => { expect(ok()).toBeNull(); });
  test('each setting is checked, with a plain message naming the field', () => {
    expect(cfg({ slaDays: 0 })).toMatchObject({ code: 'VALIDATION', field: 'slaDays', message: 'The approval SLA is a whole number of days from 1 to 60.' });
    expect(cfg({ escalateTo: 'Nobody' })?.field).toBe('escalateTo');
    expect(cfg({ unit: 'Weeks' })?.field).toBe('unit');
    expect(cfg({ carry: -1 })?.field).toBe('carry');
    expect(cfg({ toilMax: 401 })?.field).toBe('toilMax');
    expect(cfg({ toilWindow: 4 })?.field).toBe('toilWindow');
    expect(cfg({ finYearStart: '31/02' })).toMatchObject({ field: 'finYearStart', message: 'The leave year starts on a day and month, like 01/04.' });
    expect(cfg({ absenceTrigger: 0.5 })?.field).toBe('absenceTrigger');
    expect(cfg({ minNotice: -1 })?.field).toBe('minNotice');
    expect(cfg({ cancelWindow: 1.5 })?.field).toBe('cancelWindow');
  });
  test('types, policies, stages and per-type policy are checked', () => {
    const run = (o: { types?: LeaveType[]; policies?: LeavePolicy[]; stages?: LeaveStage[]; tl?: Record<string, { policy: string; unit: 'days' | 'hours' }> }) =>
      leaveConfigProblem(DEFAULT_LEAVE_CONFIG, o.types ?? TYPES, o.policies ?? POLICIES, o.stages ?? STAGES, o.tl ?? {}, ['shift']);
    expect(run({ types: [type('AL', { name: ' ' })] })?.message).toBe('Leave type AL needs a name.');
    expect(run({ types: [type('AL', { policy: 'ZZ' })] })?.message).toBe('Leave type AL names a policy that does not exist.');
    expect(run({ types: [type('AL'), type('AL')] })?.message).toBe('Two leave types share a code.');
    expect(run({ types: [type('AL')], policies: [{ ...STD, base: -1 }] })?.field).toBe('policies.0');
    /* the field names the row, so the screen marks the control that holds it */
    expect(run({ types: [type('AL'), type('TR', { name: '' })] })?.field).toBe('types.1.name');
    expect(run({ stages: [...STAGES.slice(0, 2), { ...newLeaveStage(3), wait: 1.5 }] })?.field).toBe('stages.2.wait');
    expect(run({ tl: { shift: { policy: 'ZZ', unit: 'days' } } })?.field).toBe('typeLeave.shift.policy');
    expect(run({ stages: STAGES.slice(0, 1) })).toMatchObject({ field: 'stages', message: 'Keep the first two workflow stages.' });
    expect(run({ stages: [...STAGES.slice(0, 2), { ...newLeaveStage(3), channel: 'Pigeon' }] })?.message).toBe('Choose how stage 3 notifies from the list.');
    expect(run({ stages: [...STAGES.slice(0, 2), { ...newLeaveStage(3), who: '' }] })?.message).toBe('Stage 3 needs an approver and an action.');
    expect(run({ tl: { casual: { policy: 'STD', unit: 'days' } } })?.message).toBe('There is no employee type with the code casual.');
    expect(run({ tl: { shift: { policy: 'ZZ', unit: 'days' } } })?.message).toBe('The leave policy for shift does not exist.');
  });
  test('a new type starts inactive on the fixed allowance; stages renumber after a removal', () => {
    expect(newLeaveType(8)).toMatchObject({ code: 'NEW8', name: 'New leave type', policy: 'FIX', active: false });
    expect(renumberLeaveStages([STAGES[0], STAGES[2]].filter(s => !!s)).map(s => s.n)).toEqual([1, 2]);
  });
});

describe('entitlement (D3)', () => {
  test('service years run from the start date to the clock passed in; no start date means none', () => {
    expect(yearsService('2022-02-14', TODAY)).toBe(4);
    expect(yearsService('2022-02-14', '2030-08-13')).toBe(8);
    expect(yearsService('', TODAY)).toBe(0);
    expect(yearsService('2027-01-01', TODAY)).toBe(0);
  });
  test('service bonus: a day per three years, capped at five, only where the policy has a service rule', () => {
    expect([0, 2, 3, 6, 15, 30].map(y => serviceBonus(STD, y))).toEqual([0, 0, 1, 2, 5, 5]);
    expect(serviceBonus(FIX, 9)).toBe(0);
    expect(serviceBonus(SICKP, 9)).toBe(0);
    expect(serviceBonus({ serviceRule: '+2 days per 5 years' }, 12)).toBe(4);
  });
  test('Standard: base plus service, pro-rata by contracted hours, with the calculation shown', () => {
    const e = entitlement({ contractedHours: 37.5, start: '2022-02-14' }, STD, TODAY);
    expect([e.days, e.hours, e.years]).toEqual([25, 187.5, 4]);
    expect(e.lines).toEqual([
      { label: 'Policy base', value: '24 days' }, { label: 'Service (4 years)', value: '+1 day' },
      { label: 'Contracted hours', value: '37.5 h of 37.5 h full time' }, { label: 'Pro-rata factor', value: '100.0%' },
      { label: 'Entitlement', value: '25 days · 187.50 hours' }]);
    expect(entitlement({ contractedHours: 22.5, start: '2024-01-11' }, STD, TODAY)).toMatchObject({ days: 14.4, hours: 64.8 });
    expect(entitlement({ contractedHours: 40, start: '' }, STD, TODAY).days).toBe(24);
    expect(entitlement({ contractedHours: 0, start: '2020-01-01' }, STD, TODAY).days).toBe(0);
    expect(entitlement({ contractedHours: 37.5, start: '2025-01-01' }, STD, TODAY).lines[1]).toEqual({ label: 'Service (1 year)', value: 'no addition' });
  });
  test('the reference date is the clock: a year later the bonus moves', () => {
    expect(entitlement({ contractedHours: 37.5, start: '2023-08-14' }, STD, TODAY).days).toBe(24);
    expect(entitlement({ contractedHours: 37.5, start: '2023-08-14' }, STD, '2026-08-14').days).toBe(25);
  });
  test('Accrual: hours accrued at 12.07%, shown in hours and days', () => {
    const e = entitlement({ contractedHours: 0, start: '2026-06-06', accruedHours: 38.6 }, ACC, TODAY);
    expect([e.hours, e.days]).toEqual([38.6, 5.1]);
    expect(e.lines.map(l => l.label)).toEqual(['Hours worked to date', 'Accrual rate', 'Entitlement accrued']);
    expect(e.lines[1]?.value).toBe('12.07%');
  });
  test('No entitlement and HRIS policies hold nothing and say why', () => {
    expect(entitlement({ contractedHours: 37.5, start: '' }, NONE, TODAY)).toMatchObject({ days: 0, hours: 0, lines: [{ label: 'Policy', value: 'Unpaid, no balance' }] });
    expect(entitlement({ contractedHours: 37.5, start: '' }, HRIS, TODAY).lines[0]?.value).toBe('Statutory scheme, managed outside Workforce');
  });
  test('the hours-change simulation computes before and after and writes nothing', () => {
    const s = proRataSimulation({ contractedHours: 37.5, start: '2022-02-14' }, 22.5, STD, TODAY);
    expect([s.before.days, s.after.days, s.delta, s.text]).toEqual([25, 15, -10, '-10 days']);
    expect(proRataSimulation({ contractedHours: 22.5, start: '' }, 37.5, STD, TODAY).text).toBe('+9.6 days');
  });
});

describe('requests: state machine (D1)', () => {
  test('pending moves to approved, declined or cancelled, and nothing moves after', () => {
    expect(['approved', 'declined', 'cancelled'].every(t => leaveCan('pending', t))).toBe(true);
    for (const f of ['approved', 'declined', 'cancelled']) for (const t of ['pending', 'approved', 'declined', 'cancelled']) expect(leaveCan(f, t)).toBe(false);
    expect(leaveCan('Pending', 'approved')).toBe(false);
  });
  test('a refused move says why in a plain sentence', () => {
    expect(leaveTransitionProblem('pending', 'approved')).toBeNull();
    expect(leaveTransitionProblem('approved', 'cancelled')).toEqual({ code: 'TRANSITION_NOT_ALLOWED',
      message: 'This request is approved. Only a waiting request can be cancelled.', next: 'Ask your manager if the dates need to change.' });
    expect(leaveTransitionProblem('declined', 'approved')).toEqual({ code: 'TRANSITION_NOT_ALLOWED',
      message: 'This request is declined. Only a waiting request can be approved.', next: 'Send a new request if you still need the time off.' });
    expect(leaveTransitionProblem('cancelled', 'declined')?.message).toBe('This request is cancelled. Only a waiting request can be declined.');
    expect(leaveTransitionProblem('pending', 'pending')?.message).toBe('This request is already waiting for a decision.');
    expect(leaveTransitionProblem('lost', 'approved')?.message).toBe('This request is not known. Only a waiting request can be approved.');
  });
  test('nobody decides their own request; a decline needs a reason', () => {
    expect(selfApprovalProblem('CP-1001', 'CP-1001')).toEqual({ code: 'SELF_APPROVAL', message: SELF_APPROVAL, next: 'Ask another approver at your location.' });
    expect(SELF_APPROVAL).toBe('You cannot decide your own leave request.');
    expect(selfApprovalProblem('CP-1042', 'CP-1001')).toBeNull();
    expect(declineReasonProblem('  ')).toEqual({ code: 'REASON_REQUIRED', message: REASON_REQUIRED, next: 'Say why the request cannot be granted.', field: 'reason' });
    expect(declineReasonProblem('Cover is short that week')).toBeNull();
  });
});

describe('requests: shape and validation (D2)', () => {
  const shape = (o: Partial<{ from: string; to: string; part: 'full' | 'am' | 'pm' | 'hours' }>, unit: 'days' | 'hours' | 'weeks' = 'days', con = 37.5) =>
    leaveShape({ type: 'AL', from: '2026-09-03', to: '2026-09-04', part: 'full', ...o }, unit, con);
  test('full days count every calendar day, weekends and bank holidays included', () => {
    const s = shape({ from: '2026-08-24', to: '2026-08-30' });
    expect(s.ok && [s.shape.days, s.shape.span, s.shape.hours, s.shape.label, s.shape.qty, s.shape.unit]).toEqual([7, 7, 52.5, '7 days · 52.50 hours', 7, 'days']);
    const one = shape({ to: '2026-09-03' });
    expect(one.ok && one.shape.label).toBe('1 day · 7.50 hours');
  });
  test('a half day is 0.5 at the person\'s day length; hours part is recorded in hours', () => {
    const am = shape({ to: '2026-09-03', part: 'am' }, 'days', 22.5);
    expect(am.ok && [am.shape.days, am.shape.hours, am.shape.label]).toEqual([0.5, 2.25, '0.5 days · 2.25 hours']);
    const h = shape({ part: 'hours' });
    expect(h.ok && [h.shape.days, h.shape.label, h.shape.note]).toEqual([2, '15.00 hours', 'recorded in hours']);
  });
  test('a type held in hours stores hours; one held in weeks stores days', () => {
    const toil = shape({ to: '2026-09-03' }, 'hours');
    expect(toil.ok && [toil.shape.qty, toil.shape.unit, toil.shape.label]).toEqual([7.5, 'hours', '7.50 hours']);
    const par = shape({}, 'weeks');
    expect(par.ok && [par.shape.qty, par.shape.unit]).toEqual([2, 'days']);
  });
  test('the prototype\'s three date refusals, as sentences', () => {
    expect(shape({ from: '' })).toEqual({ ok: false, field: 'from', message: PICK_BOTH_DATES });
    expect(shape({ to: '2026-02-31' })).toEqual({ ok: false, field: 'to', message: 'Pick both dates.' });
    expect(shape({ to: '2026-09-02' })).toEqual({ ok: false, field: 'to', message: LAST_BEFORE_FIRST });
    expect(LAST_BEFORE_FIRST).toBe('The last day is before the first day.');
    expect(shape({ part: 'am' })).toEqual({ ok: false, field: 'part', message: 'Morning only applies to a single day. Set both dates the same.' });
    expect(halfDaySingle('pm')).toBe('Afternoon only applies to a single day. Set both dates the same.');
  });
  test('requestProblem: an active type, the shape, and the annual leave balance when it is checked', () => {
    const ctx = { types: TYPES, contractedHours: 37.5, checkBalance: true, today: TODAY, finYearStart: '01/04', leftIn: () => 2.5 };
    const input = { type: 'AL', from: '2026-09-03', to: '2026-09-04', part: 'full' as const };
    expect(requestProblem(input, ctx)).toMatchObject({ ok: true, hint: '0.5 days would remain.' });
    expect(requestProblem({ ...input, to: '2026-09-05' }, ctx)).toEqual({ ok: false,
      problem: { code: 'OVER_BALANCE', message: 'That is more than the 2.5 days you have left.', next: 'Ask for fewer days, or talk to your manager.', field: 'to' } });
    expect(requestProblem({ ...input, to: '2026-09-05' }, { ...ctx, checkBalance: false }).ok).toBe(true);
    expect(requestProblem({ ...input, type: 'TOIL', to: '2026-09-05' }, ctx).ok).toBe(true);
    expect(requestProblem({ ...input, type: 'OLD' }, ctx)).toMatchObject({ ok: false, problem: { code: 'VALIDATION', field: 'type', message: CHOOSE_TYPE } });
    expect(requestProblem({ ...input, type: 'NOPE' }, ctx)).toMatchObject({ ok: false, problem: { field: 'type' } });
    expect(requestProblem({ ...input, part: 'week' as never }, ctx)).toMatchObject({ ok: false, problem: { field: 'part', message: 'Choose how much of each day.' } });
    expect(requestProblem({ ...input, from: '' }, ctx)).toMatchObject({ ok: false, problem: { code: 'VALIDATION', field: 'from', message: PICK_BOTH_DATES } });
    expect(requestProblem({ ...input, type: 'AL', part: 'hours' }, { ...ctx, checkBalance: false })).toMatchObject({ ok: true, hint: 'recorded in hours' });
  });
  /* review I2: a request is charged to the leave year its days fall in */
  test('requestProblem checks each leave year the request touches against that year, and names a year other than this one', () => {
    const left: Record<string, number> = { '2026-04-01': 2.5, '2027-04-01': 20 };
    const ctx = { types: TYPES, contractedHours: 37.5, checkBalance: true, today: TODAY, finYearStart: '01/04', leftIn: (y: { start: string }) => left[y.start] ?? null };
    const al = (from: string, to: string) => requestProblem({ type: 'AL', from, to, part: 'full' }, ctx);
    expect(al('2027-04-05', '2027-04-16')).toMatchObject({ ok: true, hint: '8 days would remain in the 2027/28 leave year.' });
    expect(al('2027-04-05', '2027-04-30')).toMatchObject({ ok: false,
      problem: { code: 'OVER_BALANCE', message: 'That is more than the 20 days you have left in the 2027/28 leave year.', field: 'to' } });
    /* 30/03-02/04/2027: two days in this year, two in the next */
    expect(al('2027-03-30', '2027-04-02')).toMatchObject({ ok: true, hint: '0.5 days would remain. 18 days would remain in the 2027/28 leave year.' });
    expect(al('2027-03-29', '2027-04-02')).toMatchObject({ ok: false, problem: { message: 'That is more than the 2.5 days you have left.' } });
    /* a year the caller holds no balance for is left to the server */
    expect(al('2028-04-03', '2028-04-04')).toMatchObject({ ok: true, hint: '' });
  });
  test('yearShares splits a request by leave year in calendar days', () => {
    expect(yearShares({ from: '2027-03-30', to: '2027-04-02' }, { days: 4, hours: 30 }, '01/04').map(s => [s.year.label, s.days, s.hours]))
      .toEqual([['2026/27', 2, 15], ['2027/28', 2, 15]]);
    expect(yearShares({ from: '2026-09-03', to: '2026-09-03' }, { days: 0.5, hours: 3.75 }, '01/04').map(s => [s.year.label, s.days])).toEqual([['2026/27', 0.5]]);
  });
  test('the balance strings, verbatim but for the full stop', () => {
    expect(moreThanLeft(13.5)).toBe('That is more than the 13.5 days you have left.');
    expect(moreThanLeft(4, '2027/28')).toBe('That is more than the 4 days you have left in the 2027/28 leave year.');
    expect(wouldRemain(4, 1, '2027/28')).toBe('3 days would remain in the 2027/28 leave year.');
    expect(OVER_BALANCE).toBe('That is more than your remaining balance.');
    expect(wouldRemain(13.5, 2)).toBe('11.5 days would remain.');
    expect(wouldRemain(0.3, 0.1)).toBe('0.2 days would remain.');
  });
  test('a request reads in days and hours, and its range in dd/mm/yyyy', () => {
    expect(requestDays({ qty: 7.5, unit: 'hours' }, 37.5)).toEqual({ days: 1, hours: 7.5 });
    expect(requestDays({ qty: 2, unit: 'days' }, 30)).toEqual({ days: 2, hours: 12 });
    expect([leaveRange('2026-08-21', '2026-08-21'), leaveRange('2026-08-24', '2026-08-28')]).toEqual(['21/08/2026', '24/08/2026 – 28/08/2026']);
  });
});

describe('balance (D3): derived from base, requests and ledger', () => {
  const ent = entitlement({ contractedHours: 37.5, start: '2022-02-14' }, STD, TODAY);
  const base = { unit: 'days' as const, taken: 7.5, toil: 6, toilBy: '2026-09-30' };
  const bal = (requests: LeaveRecord[], ledger: LedgerRow[] = []) =>
    balanceOf({ ent, base, contractedHours: 37.5, requests, ledger, today: TODAY, finYearStart: '01/04' });
  test('Amara: 25 days, taken 9.5, 2 waiting, 13.5 left', () => {
    const b = bal([rec(), rec({ id: 'lr_2', from: '2026-09-03', to: '2026-09-04', state: 'pending' })]);
    expect([b.takenD, b.takenH, b.pending, b.leftD, b.leftH]).toEqual([9.5, 71.25, 2, 13.5, 101.25]);
    expect(balanceText(b)).toBe('13.5 of 25 days left');
  });
  test('declined, cancelled, other types and other leave years do not count', () => {
    const b = bal([rec({ state: 'declined' }), rec({ state: 'cancelled' }), rec({ type: 'COMP' }), rec({ from: '2026-03-30', to: '2026-03-31' })]);
    expect([b.takenD, b.pending, b.leftD]).toEqual([7.5, 0, 17.5]);
  });
  /* review I2 */
  test('a request across the year end counts only its days in this year; the next year holds the rest', () => {
    const across = rec({ from: '2027-03-30', to: '2027-04-02', qty: 4, state: 'pending' });
    expect(bal([across]).pending).toBe(2);
    const facts = { contractedHours: 37.5, start: '2022-02-14' }, o = { facts, policy: STD, base, requests: [across], ledger: [], today: TODAY, finYearStart: '01/04' };
    const now = yearBalance(o, leaveYear(TODAY, '01/04')), next = yearBalance(o, leaveYear('2027-04-01', '01/04'));
    expect([now.ent.days, now.takenD, now.pending, now.leftD]).toEqual([25, 7.5, 2, 15.5]);
    /* next year: the same policy and hours, five years' service at 01/04/2027, nothing taken before it, no carry-over */
    expect([next.ent.years, next.ent.days, next.takenD, next.pending, next.leftD]).toEqual([5, 25, 0, 2, 23]);
  });
  test('approving moves waiting to taken; cancelling releases it; each exactly once', () => {
    const waiting = bal([rec({ state: 'pending' })]), approved = bal([rec()]), cancelled = bal([rec({ state: 'cancelled' })]);
    expect([waiting.leftD, approved.leftD, cancelled.leftD]).toEqual([15.5, 15.5, 17.5]);
    expect([waiting.pending, approved.pending, approved.takenD]).toEqual([2, 0, 9.5]);
  });
  test('a counted ledger row returns days; an informational one does not', () => {
    const back: LedgerRow = { date: TODAY, type: 'Days returned', qty: 1, unit: 'days', why: '', counts: true };
    const info: LedgerRow = { date: '2026-04-01', type: 'Opening entitlement', qty: 24, unit: 'days', why: '', counts: false };
    expect(bal([rec()], [back, info]).takenD).toBe(8.5);
  });
  test('TOIL draws on the TOIL bank in hours, and waiting TOIL is held back', () => {
    const b = bal([rec({ type: 'TOIL', qty: 4, unit: 'hours' }), rec({ type: 'TOIL', qty: 1, unit: 'hours', state: 'pending' })]);
    expect([b.toil, b.toilPending, b.toilLeft, b.leftD]).toEqual([2, 1, 1, 17.5]);
  });
  test('a bank worker holds the balance in hours', () => {
    const e = entitlement({ contractedHours: 0, start: '2026-03-12', accruedHours: 52.1 }, ACC, TODAY);
    const b = balanceOf({ ent: e, base: { unit: 'hours', taken: 7.5, toil: 0, toilBy: '' }, contractedHours: 0, requests: [rec({ from: '2026-08-20', to: '2026-08-20', qty: 1 })],
      ledger: [{ date: TODAY, type: 'Days returned', qty: 7.5, unit: 'hours', why: '', counts: true }], today: TODAY, finYearStart: '01/04' });
    expect([b.takenH, b.takenD, b.leftH]).toEqual([7.5, 1, 44.6]);
    expect(balanceText(b)).toBe('44.6 of 52.1 hours left');
  });
  test('the days-to-take card and ledger quantities', () => {
    const b = bal([rec()]);
    expect(daysToTakeText(b, '2027-03-31', true)).toBe('15.5 days to take by 31/03/2027 · 6 hours TOIL expires 30/09/2026');
    expect(daysToTakeText(b, '2027-03-31', false)).toBe('15.5 days to take by 31/03/2027');
    expect([ledgerQty({ qty: 24, unit: 'days' }), ledgerQty({ qty: -2, unit: 'days' }), ledgerQty({ qty: 0, unit: 'hours' })]).toEqual(['+24 days', '-2 days', '0 hours']);
  });
});

describe('SLA, stage and notice (D6)', () => {
  test('days left count down from the date raised; seeded requests match the prototype', () => {
    expect(slaOf({ raised: '2026-08-08', escalated: true }, 5, TODAY, 4)).toEqual({ daysLeft: 0, escalated: true, stage: 3, tone: 'err' });
    expect(slaOf({ raised: '2026-08-11' }, 5, TODAY, 4)).toEqual({ daysLeft: 3, escalated: false, stage: 2, tone: 'warn' });
    expect(slaOf({ raised: '2026-08-12' }, 5, TODAY, 4).daysLeft).toBe(4);
    expect(slaOf({ raised: '2026-08-09' }, 5, TODAY, 4).tone).toBe('err');
  });
  test('a request past its SLA is escalated without a timer; the stage never passes the last', () => {
    expect(slaOf({ raised: '2026-08-01' }, 5, TODAY, 4)).toMatchObject({ daysLeft: -7, escalated: true, stage: 3 });
    expect(slaOf({ raised: '2026-08-01' }, 5, TODAY, 2).stage).toBe(2);
  });
  test('pill, banner, exceptions and stage texts', () => {
    expect(slaPillText(slaOf({ raised: '2026-08-11' }, 5, TODAY, 4), 5, 'Service Manager')).toBe('3 of 5 days left');
    expect(slaPillText(slaOf({ raised: '2026-08-01' }, 5, TODAY, 4), 5, 'Service Manager')).toBe('Escalated · Service Manager');
    expect([slaBreachedText(1, 5), slaBreachedText(2, 5)]).toEqual(['1 request has breached the 5-day approval SLA', '2 requests have breached the 5-day approval SLA']);
    expect(escalationText('Service Manager')).toBe('Approval SLA breached. Escalated to Service Manager.');
    expect(stageText(STAGES, 3)).toBe('Stage 3 of 4 · Service Manager');
  });
  test('short notice and the cancellation window advise, never block', () => {
    expect(noticeAdvisory('2026-08-21', '2026-08-11', 7)).toBeNull();
    expect(noticeAdvisory('2026-08-14', '2026-08-11', 7)).toBe('Requested with 3 days\' notice, less than the 7 days the policy asks for.');
    expect(noticeAdvisory('2026-08-11', '2026-08-11', 7)).toBe('Requested with 0 days\' notice, less than the 7 days the policy asks for.');
    expect(cancelWindowAdvisory('2026-08-17', TODAY, 7)).toBe('This leave starts in 4 days, inside the 7-day window for changes.');
    expect(cancelWindowAdvisory('2026-09-03', TODAY, 7)).toBeNull();
    expect(cancelTip(7)).toBe('You can change or cancel up to 7 days before it starts.');
  });
  test('effect on cover, worked out when the request is sent', () => {
    expect(coverImpact([{ date: '2026-08-24', onShift: 4, working: true, min: 4 }])).toEqual({ text: '24 Aug drops to 3 of 4. Cover needed.', short: true });
    expect(coverImpact([{ date: '2026-08-21', onShift: 6, working: true, min: 4 }, { date: '2026-08-22', onShift: 5, working: false, min: 4 }]))
      .toEqual({ text: 'Cover is met. 5 on shift.', short: false });
    expect(coverImpact([])).toEqual({ text: 'No rota stored for these days yet.', short: false });
    expect(ROTA_OFF_IMPACT).toBe('Cover is not checked. This tenant does not use Rota.');
  });
});

describe('notifications, audit and toasts (D12)', () => {
  test('the texts each move sends', () => {
    expect(requestedNotice('Amara Okafor', 'Annual leave', '03/09/2026 – 04/09/2026', '2 days · 15.00 hours', 5)).toEqual({ title: 'Leave requested',
      body: 'Amara Okafor · Annual leave · 03/09/2026 – 04/09/2026 · 2 days · 15.00 hours · decide within 5 days' });
    expect(sentNotice('21/08/2026', '7.50 hours', 'Rachel Hussain')).toEqual({ title: 'Leave request sent', body: '21/08/2026 · 7.50 hours · with Rachel Hussain' });
    expect(approvedNotice('17/08/2026 – 18/08/2026', 'Annual leave')).toEqual({ title: 'Leave approved', body: '17/08/2026 – 18/08/2026 · Annual leave' });
    expect(declinedNotice('24/08/2026', ' Cover is short ')).toEqual({ title: 'Leave declined', body: '24/08/2026 · Cover is short' });
    expect(cancelledNotice('Amara Okafor', '2026-09-03')).toEqual({ title: 'Leave request cancelled', body: 'Amara Okafor · 03/09/2026' });
    expect(daysReturnedNotice(1)).toEqual({ title: 'Entitlement changed', body: '1 day returned to your annual leave balance' });
    expect(rtwNotices('Rachel Hussain', 'Willow House')).toEqual({
      employee: { title: 'Return-to-work meeting requested', body: 'Your manager has asked to arrange a return-to-work meeting' },
      admin: { title: 'Return-to-work meeting requested', body: 'Requested by Rachel Hussain · Willow House' } });
  });
  test('toasts, with the prototype\'s em-dash asides as sentences', () => {
    expect(requestedToast('Annual leave', '2 days · 15.00 hours', 'Rachel Hussain')).toBe('Annual leave requested · 2 days · 15.00 hours · sent to Rachel Hussain');
    expect(CANCELLED_TOAST).toBe('Request cancelled. Your manager has been told.');
    expect(declinedToast('Priya')).toBe('Priya’s request declined. They have been told the reason.');
    expect(approvedToast('Priya', true, true)).toBe('Priya’s leave approved. The rota now shows them unavailable and a cover request has opened.');
    expect(approvedToast('Priya', true, false)).toBe('Priya’s leave approved. The rota shows them unavailable.');
    expect(approvedToast('Priya', false, false)).toBe('Priya’s leave approved');
    expect([sicknessToast(true), sicknessToast(false)]).toEqual(['Sickness recorded. Shift removed from the rota and a cover request opened.', 'Sickness recorded. Shift removed from the rota.']);
    expect(RTW_TOAST).toBe('Return-to-work meeting requested. The colleague and HR have been notified.');
    expect(daysReturnedToast(2, 'Marcus Reilly')).toBe('2 days returned to Marcus Reilly’s annual leave balance');
    expect(tellManagerToast('Rachel Hussain')).toBe('Messaging is not built yet. Nothing has been sent to Rachel Hussain.');
  });
});

describe('sickness episodes and Bradford (D9)', () => {
  const ep = (id: string, from: string, to: string) => ({ id, personCode: 'CP-1088', from, to, reason: 'Other', note: '', rtw: null });
  test('an open episode runs to the clock', () => {
    expect([episodeEnd({ from: '2026-08-11', to: '' }, TODAY), episodeDays({ from: '2026-08-11', to: '' }, TODAY), episodeDays({ from: '2026-06-02', to: '2026-06-13' }, TODAY)])
      .toEqual([TODAY, 3, 12]);
    expect(episodeEnd({ from: '2026-08-20', to: '' }, TODAY)).toBe('2026-08-20');
  });
  test('a day next to an open or just-ended episode extends it; a day apart starts a new spell', () => {
    const eps = [ep('e1', '2026-08-10', '2026-08-11')];
    const r = (from: string, to = '') => recordSicknessPlan(eps, { from, to, reason: 'Cold or flu' }, TODAY);
    expect(r('2026-08-12', '2026-08-12')).toEqual({ ok: true, plan: { kind: 'extend', id: 'e1', from: '2026-08-10', to: '2026-08-12' } });
    expect(r('2026-08-09', '2026-08-09')).toEqual({ ok: true, plan: { kind: 'extend', id: 'e1', from: '2026-08-09', to: '2026-08-11' } });
    expect(r('2026-08-12')).toEqual({ ok: true, plan: { kind: 'extend', id: 'e1', from: '2026-08-10', to: '' } });
    expect(r('2026-08-13', '2026-08-13')).toEqual({ ok: true, plan: { kind: 'new', from: '2026-08-13', to: '2026-08-13' } });
    const open = recordSicknessPlan([ep('e2', '2026-08-10', '')], { from: '2026-08-13', to: '2026-08-13', reason: 'Other' }, TODAY);
    expect(open).toEqual({ ok: true, plan: { kind: 'extend', id: 'e2', from: '2026-08-10', to: '' } });
  });
  /* review I3 */
  test('a range that touches two episodes joins them into the earliest, open if either is', () => {
    const eps = [ep('b', '2026-08-06', '2026-08-07'), ep('a', '2026-08-03', '2026-08-04')];
    const r = (from: string, to: string, list = eps) => recordSicknessPlan(list, { from, to, reason: 'Other' }, TODAY);
    const joined = { ok: true, plan: { kind: 'extend', id: 'a', from: '2026-08-03', to: '2026-08-07', absorbed: ['b'] } };
    expect(r('2026-08-05', '2026-08-05')).toEqual(joined);
    expect(r('2026-08-05', '2026-08-07')).toEqual(joined);
    expect(r('2026-08-04', '2026-08-09')).toEqual({ ok: true, plan: { ...joined.plan, to: '2026-08-09' } });
    expect(r('2026-08-05', '')).toEqual({ ok: true, plan: { ...joined.plan, to: '' } });
    expect(r('2026-08-05', '2026-08-05', [ep('a', '2026-08-03', '2026-08-04'), ep('b', '2026-08-06', '')])).toEqual({ ok: true, plan: { ...joined.plan, to: '' } });
    const three = [...eps, ep('c', '2026-08-09', '2026-08-09')];
    expect(r('2026-08-05', '2026-08-08', three)).toEqual({ ok: true, plan: { ...joined.plan, to: '2026-08-09', absorbed: ['b', 'c'] } });
    /* one spell of five days, not two of five or seven */
    expect(bradford([ep('a', '2026-08-03', '2026-08-07')], TODAY, 100)).toMatchObject({ spells: 1, days: 5, score: 5 });
  });
  test('recording refuses a missing day, a backwards range, an unknown reason, and a day already recorded', () => {
    expect(recordSicknessPlan([], { from: '', to: '', reason: 'Other' }, TODAY)).toMatchObject({ ok: false, problem: { field: 'from', message: 'Pick the first day off.' } });
    expect(recordSicknessPlan([], { from: '2026-08-12', to: '2026-08-11', reason: 'Other' }, TODAY)).toMatchObject({ ok: false, problem: { field: 'to', message: LAST_BEFORE_FIRST } });
    expect(recordSicknessPlan([], { from: '2026-08-12', to: '', reason: 'Hangover' }, TODAY)).toMatchObject({ ok: false, problem: { field: 'reason', message: 'Choose the reason given.' } });
    expect(recordSicknessPlan([ep('e1', '2026-08-10', '2026-08-12')], { from: '2026-08-11', to: '2026-08-11', reason: 'Other' }, TODAY))
      .toMatchObject({ ok: false, problem: { code: 'ALREADY_RECORDED', message: 'Tue 11 Aug is already recorded as sickness.' } });
  });
  test('Bradford: spells squared times days over 52 weeks, triggered at the threshold', () => {
    const marcus = [ep('a', '2025-10-06', '2025-10-07'), ep('b', '2026-01-19', '2026-01-20'), ep('c', '2026-04-27', '2026-04-28'), ep('d', '2026-08-11', '2026-08-11')];
    expect(bradford(marcus, TODAY, 100)).toEqual({ spells: 4, days: 7, score: 112, triggered: true });
    expect(bradford([ep('x', '2026-06-02', '2026-06-13')], TODAY, 100)).toEqual({ spells: 1, days: 12, score: 12, triggered: false });
    expect(bradford([...marcus, ep('e', '2026-08-13', '2026-08-13')], TODAY, 100)).toMatchObject({ spells: 5, days: 8, score: 200 });
  });
  test('only the last 52 weeks count, clipped at the window edge, and nothing after the clock', () => {
    expect(bradford([ep('old', '2025-08-01', '2025-08-10')], TODAY, 100)).toMatchObject({ spells: 0, days: 0, score: 0 });
    expect(bradford([ep('edge', '2025-08-12', '2025-08-16')], TODAY, 100)).toMatchObject({ spells: 1, days: 2 });
    expect(bradford([ep('future', '2026-08-20', '2026-08-21')], TODAY, 100).spells).toBe(0);
    expect(bradford([ep('open', '2026-08-11', '')], TODAY, 100).days).toBe(3);
  });
  test('the board texts', () => {
    expect(latestAbsenceText({ from: '2026-08-11', to: '2026-08-11' }, TODAY)).toBe('11/08/2026 · 1 day');
    expect(latestAbsenceText({ from: '2026-06-02', to: '2026-06-13' }, TODAY)).toBe('02/06/2026 · 12 days');
    expect(nextStepText(true, { note: '', rtw: null })).toBe('Return-to-work meeting due');
    expect(nextStepText(true, { note: '', rtw: { requestedAt: AT, by: ME } })).toBe('Return-to-work meeting requested');
    expect(nextStepText(false, { note: 'Sick note held · 8-week check 28/08/2026', rtw: null })).toBe('Sick note held · 8-week check 28/08/2026');
    expect(nextStepText(false, undefined)).toBe('No action');
    expect(triggerBannerText('Marcus Reilly', 112, 100)).toBe('Marcus Reilly has reached the absence trigger. Score 112 of 100.');
  });
  test('a return to work is arranged once, for a recorded absence', () => {
    expect(rtwProblem(undefined)?.code).toBe('NO_ABSENCE');
    expect(rtwProblem({ rtw: { requestedAt: AT, by: ME } })).toEqual({ code: 'ALREADY_REQUESTED', message: RTW_ALREADY, next: 'Nothing more is needed.' });
    expect(rtwProblem({ rtw: null })).toBeNull();
  });
});

describe('give days back (D10)', () => {
  const leave = [rec({ id: 'lr_4', from: '2026-08-10', to: '2026-08-11' }), rec({ id: 'lr_9', from: '2026-08-12', to: '2026-08-12', part: 'am', qty: 0.5 }),
    rec({ id: 'lr_p', from: '2026-08-13', to: '2026-08-13', state: 'pending' })];
  const sick = [{ from: '2026-08-11', to: '' }];
  test('the approved leave days a sickness episode covers, less any already returned', () => {
    expect(sickDuringLeave(leave, sick, [], TODAY)).toEqual([{ requestId: 'lr_4', date: '2026-08-11', days: 1 }, { requestId: 'lr_9', date: '2026-08-12', days: 0.5 }]);
    expect(sickDuringLeave(leave, sick, ['2026-08-11'], TODAY)).toEqual([{ requestId: 'lr_9', date: '2026-08-12', days: 0.5 }]);
    expect(sickDuringLeave(leave, [], [], TODAY)).toEqual([]);
  });
  test('only those days can be picked, each once', () => {
    const c = sickDuringLeave(leave, sick, [], TODAY);
    expect(giveBackProblem([], c)).toMatchObject({ field: 'dates', message: 'Pick at least one day to give back.' });
    expect(giveBackProblem(['2026-08-10'], c)).toEqual({ code: 'NOT_SICK_ON_LEAVE', message: 'Mon 10 Aug is not a day of approved leave covered by recorded sickness.',
      next: 'Pick only days of approved annual leave with sickness recorded.', field: 'dates' });
    expect(giveBackProblem(['2026-08-11', '2026-08-11'], c)?.message).toBe('Each day can be given back once.');
    expect(giveBackProblem(['2026-08-11'], c)).toBeNull();
  });
  test('one ledger row returns exactly the picked days', () => {
    const c = sickDuringLeave(leave, sick, [], TODAY);
    expect(giveBackRow(['2026-08-12', '2026-08-11'], c, 'days', 30, TODAY)).toEqual({ date: TODAY, type: 'Days returned', qty: 1.5, unit: 'days',
      why: 'Sickness recorded across booked annual leave', counts: true, dates: ['2026-08-11', '2026-08-12'] });
    expect(giveBackRow(['2026-08-11'], c, 'hours', 30, TODAY)).toMatchObject({ qty: 6, unit: 'hours' });
  });
});

describe('leaver reconciliation (D13)', () => {
  test('months worked run from the later of the year start and the start date to the day after leaving', () => {
    expect(monthsWorked('2026-04-01', '2023-09-01', '2026-09-30')).toBe(6);
    expect(monthsWorked('2026-04-01', '2026-06-01', '2026-09-30')).toBe(4);
    expect(monthsWorked('2026-04-01', '', '2026-09-29')).toBe(5);
    expect(monthsWorked('2026-04-01', '', '2027-03-31')).toBe(12);
  });
  test('over-taken, under-taken and settled, in days and hours, with no money', () => {
    expect(reconcileLeaver({ fullDays: 14.4, takenDays: 16, months: 6, contractedHours: 22.5 })).toEqual({ full: 14.4, prorata: 7.2, taken: 16, diff: -8.8, hours: 39.6,
      verdict: 'Over-taken', action: 'Recover 8.8 days (39.60 h) through the final payroll' });
    expect(reconcileLeaver({ fullDays: 24, takenDays: 10, months: 6, contractedHours: 37.5 })).toMatchObject({ diff: 2, verdict: 'Under-taken',
      action: 'Pay 2 days (15.00 h) in lieu through the final payroll' });
    expect(reconcileLeaver({ fullDays: 24, takenDays: 12, months: 6, contractedHours: 37.5 })).toMatchObject({ diff: 0, verdict: 'Settled', action: 'No adjustment required' });
    expect(SETTLED_IN_PAYROLL).toBe('Workforce identifies the amount and the direction. The monetary settlement is made in payroll.');
  });
});

describe('leave to rota (D7)', () => {
  test('marks: V for leave, S for sickness, with the reason a cover request carries', () => {
    expect([absenceMark('AL'), absenceMark('TOIL'), absenceMark('SICK')]).toEqual(['V', 'V', 'S']);
    expect([leaveRotaWhy('V'), leaveRotaWhy('S'), leaveCoverReason('V'), leaveCoverReason('S')]).toEqual(['Leave approved', 'Sickness recorded', 'Annual leave cover', 'Sickness']);
  });
  test('the cell plan covers every day, across weeks, at the person\'s location', () => {
    expect(absenceCellPlan('WH', '2026-08-24', '2026-08-28')).toEqual([{ location: 'WH', weekStart: '2026-08-24', weekId: 'rw_WH_2026-08-24', days: [0, 1, 2, 3, 4] }]);
    expect(absenceCellPlan('WH', '2026-08-15', '2026-08-18')).toEqual([
      { location: 'WH', weekStart: '2026-08-10', weekId: 'rw_WH_2026-08-10', days: [5, 6] },
      { location: 'WH', weekStart: '2026-08-17', weekId: 'rw_WH_2026-08-17', days: [0, 1] }]);
    expect(absenceCellPlan('WH', '2026-08-12', '2026-08-11')).toEqual([]);
    expect(datesCellPlan('BC', ['2026-08-18', '2026-08-11', '2026-08-11', 'x'])).toEqual([
      { location: 'BC', weekStart: '2026-08-10', weekId: 'rw_BC_2026-08-10', days: [1] },
      { location: 'BC', weekStart: '2026-08-17', weekId: 'rw_BC_2026-08-17', days: [1] }]);
  });
  test('sickness on a day of booked leave leaves the V until the day is given back', () => {
    const reqs = [rec({ from: '2026-08-10', to: '2026-08-11' }), rec({ from: '2026-08-12', to: '2026-08-12', state: 'declined' })];
    expect([...bookedLeaveDates(reqs, [])]).toEqual(['2026-08-10', '2026-08-11']);
    expect([...bookedLeaveDates(reqs, ['2026-08-11'])]).toEqual(['2026-08-10']);
    expect(sicknessDates({ from: '2026-08-11', to: '' }, TODAY, bookedLeaveDates(reqs, []))).toEqual(['2026-08-12', '2026-08-13']);
    expect(sicknessDates({ from: '2026-08-11', to: '2026-08-11' }, TODAY, bookedLeaveDates(reqs, ['2026-08-11']))).toEqual(['2026-08-11']);
  });
  test('the writes go through the week path: a live week becomes an amendment, and a short day is found', () => {
    const [w] = absenceCellPlan('WH', '2026-08-10', '2026-08-11');
    if (!w) throw new Error('no plan');
    const writes = absenceCellWrites(w, { code: 'CP-1088', name: 'Marcus Reilly' }, 'V', ME, AT);
    expect(writes.map(x => [x.day, x.to, x.why])).toEqual([[0, 'V', 'Leave approved'], [1, 'V', 'Leave approved']]);
    const week = { ...emptyWeek('WH', '2026-08-10'), state: 'published' as const, publishVersion: 1,
      lines: { 'CP-1088': ['E', 'E', '', '', '', '', ''], 'CP-1042': ['E', '', '', '', '', '', ''] } };
    const r = setCells(week, writes);
    expect([r.week.lines['CP-1088'], r.week.state, r.amended, r.changes.length]).toEqual([['V', 'V', '', '', '', '', ''], 'amendment', true, 2]);
    expect(shortDays(Object.values(r.week.lines), w.days, 1)).toEqual([1]);
  });
});

describe('leave to timesheet (D8)', () => {
  test('a day\'s absence comes from booked leave, then sickness; a day given back reads as sickness', () => {
    const reqs = [rec({ from: '2026-08-10', to: '2026-08-11' }), rec({ from: '2026-08-12', to: '2026-08-12', state: 'pending' })];
    const eps = [{ from: '2026-08-11', to: '2026-08-11' }];
    expect(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'].map(d => absenceOn(d, reqs, eps, TODAY))).toEqual(['V', 'V', '', '']);
    expect(absenceOn('2026-08-11', reqs, eps, TODAY, ['2026-08-11'])).toBe('S');
    expect(absenceOn('2026-08-12', [rec({ type: 'SICK', from: '2026-08-12', to: '2026-08-12' })], [], TODAY)).toBe('S');
  });
  test('the block refusal names the absence and the way through', () => {
    expect(absenceBlockedProblem('V')).toEqual({ code: 'ABSENCE_BLOCKED',
      message: 'Annual leave is recorded for this day. Approved absence blocks timesheet capture while “Leave blocks timesheet capture” is on.',
      next: 'If you did work, mark the day non-working and tick “Called in and worked anyway”.' });
    expect(absenceBlockedProblem('S').message).toMatch(/^Sickness is recorded for this day\./);
  });
  /* review I1: a stored day a week submit or a catch-up would send is held back with this reason */
  test('a day held back for absence says which day and why', () => {
    expect(absenceHeldReason('2026-08-11', 'S')).toBe('Tue 11 Aug was held back. Sickness is recorded for that day, and approved absence blocks timesheet capture while “Leave blocks timesheet capture” is on.');
    expect(absenceHeldReason('2026-08-10', 'V')).toMatch(/^Mon 10 Aug was held back\. Annual leave is recorded for that day,/);
  });
});

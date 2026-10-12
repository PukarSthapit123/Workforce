import { useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CalendarDays, Plus, RefreshCw, Repeat, Ruler, Trash2 } from 'lucide-react';
import { tid } from '@/testids';
import {
  ActionBar, AdminCard, Button, Card, ConfirmModal, Empty, NavLink, PageHead, SettingRow, SettingSelect, SettingText, SubHead, SwitchField, UnitInput, toastInfo,
} from '@/ui';
import { useSaveLeaveConfig, type LeavePolicy, type LeaveSetup } from '@/api/leave';
import {
  ACCRUAL_RATE, BANK_HOLIDAY_HANDLING, BANK_HOLIDAY_HANDLING_LABEL, LEAVE_METHODS, LEAVE_METHOD_LABEL, LEAVE_UNITS, keepsBalance, type ServiceRule,
} from '@/domain/leave';
import { leaveMethod, leaveUnit, policiesWith, policyDraft, policyOf, samePolicy, type PolicyDraft, type PolicyNumKey } from './setup';
import { Control, Err, RefusalWarn, invalid } from './setupParts';

/* One leave policy on its own page (Leave setup's ?policy=CODE drill-in): the
   card on Leave setup is a summary, and each policy is a catalogue row (D1),
   saved here on its own. Save sends the whole list with this policy replaced,
   with If-Match, and writes one audit row; nothing changes on screen until the
   server has answered. The fields a method never reads are hidden, and the
   page says why. */
const CRUMB = 'Modules · Leave · Leave setup';
const LINK = 'text-xs font-semibold text-brand underline dark:text-brand-accent';
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const UNIT_SHORT = { days: 'd', hours: 'h', weeks: 'w' } as const;

export function PolicyPage({ setup, code, fullTimeWeeklyHours }: { setup: LeaveSetup; code: string; fullTimeWeeklyHours: number }) {
  const { pathname } = useLocation();
  const i = setup.config.policies.findIndex(p => p.code === code);
  const policy = setup.config.policies[i];
  if (!policy) {
    return (
      <>
        <PageHead title="Leave policy" crumb={CRUMB} />
        <Card>
          <Empty testId={tid.mleave.policyMissing}>
            There is no leave policy with the code {code}. It may have been removed.
            <span className="mt-sm block"><NavLink testId={tid.mleave.policyBack} to={pathname} className={LINK}>Back to Leave setup</NavLink></span>
          </Empty>
        </Card>
      </>);
  }
  return <PolicyEditor setup={setup} policy={policy} i={i} fullTimeWeeklyHours={fullTimeWeeklyHours} />;
}

function PolicyEditor({ setup, policy, i, fullTimeWeeklyHours }: { setup: LeaveSetup; policy: LeavePolicy; i: number; fullTimeWeeklyHours: number }) {
  const { config } = setup;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [d, setD] = useState<PolicyDraft>(() => policyDraft(policy));
  const [leaving, setLeaving] = useState(false);
  const save = useSaveLeaveConfig();
  const next = policyOf(d);
  const dirty = !samePolicy(next, policy);
  const refusal = save.refusal;
  const fe = (field: string) => (refusal?.field === field ? refusal.message : undefined);
  const at = (key: string) => fe(`policies.${i}.${key}`);
  const numErr = fe(`policies.${i}`);
  const set = (patch: Partial<PolicyDraft>) => setD(p => ({ ...p, ...patch }));
  const setNum = (key: PolicyNumKey, v: string) => setD(p => ({ ...p, nums: { ...p.nums, [key]: v } }));
  const setRule = (j: number, patch: Partial<ServiceRule>) => setD(p => ({ ...p, serviceRules: p.serviceRules.map((r, n) => (n === j ? { ...r, ...patch } : r)) }));

  const submit = () => save.mutate({ config, body: { policies: policiesWith(config.policies, i, next) } }, { onSuccess: r =>
    toastInfo(r.auditId ? `${next.name.trim() || policy.name} saved. It applies across the tenant straight away.` : `${policy.name} · nothing changed`) });
  const cancel = () => { setD(policyDraft(policy)); save.clearFieldErrors(); };
  /* leaving with changes unsaved asks first */
  const guard = (e: MouseEvent) => { if (dirty) { e.preventDefault(); setLeaving(true); } };
  const back = <NavLink testId={tid.mleave.policyBack} to={pathname} onClick={guard} className={LINK}>Back to Leave setup</NavLink>;

  const balance = keepsBalance(d.method), fixed = d.method === 'fixed';
  const short = UNIT_SHORT[d.unit];
  const numInput = (key: PolicyNumKey, unit: string, label: string, step: string, placeholder?: string) => (
    <UnitInput testId={tid.mleave.policyNum(i, key)} unit={unit} aria-label={label} type="number" inputMode="decimal" min="0" step={step}
      placeholder={placeholder} value={d.nums[key]} aria-invalid={invalid(numErr)} onChange={e => setNum(key, e.target.value)} />);
  const ruleInput = (j: number, field: keyof ServiceRule, unit: string, label: string, value: number, error: string | undefined) => (
    <UnitInput testId={tid.mleave.serviceRule(i, j, field)} unit={unit} aria-label={`Service rule ${j + 1}: ${label}`} type="number" min="0"
      step={field === 'afterYears' ? '1' : '0.1'} value={value} aria-invalid={invalid(error)} onChange={e => setRule(j, { [field]: Number(e.target.value) })} />);

  return (
    <>
      <PageHead title={policy.name} crumb={`${CRUMB} · ${policy.name}`} actions={back} />

      <AdminCard testId={tid.mleave.card('policy-details')} icon={<Ruler />} title="Policy" desc="What the policy is called and how it works out entitlement">
        <SettingRow title="Name">
          <Control error={at('name')}>
            <SettingText testId={tid.mleave.policyName(i)} aria-label="Policy name" maxLength={60} value={d.name} aria-invalid={invalid(at('name'))}
              onChange={e => set({ name: e.target.value })} /></Control>
        </SettingRow>
        <SettingRow title="Code" desc="The code cannot be changed after the policy is created.">
          <span data-testid={tid.mleave.policyCode} className="font-mono text-sm">{policy.code}</span>
        </SettingRow>
        <SettingRow title="Method" desc="How entitlement is worked out for a colleague on this policy">
          <Control error={at('method')}>
            <SettingSelect testId={tid.mleave.policyMethod(i)} aria-label="Method" value={d.method} aria-invalid={invalid(at('method'))}
              onChange={e => { const method = leaveMethod(e.target.value); if (method) set({ method }); }}>
              {LEAVE_METHODS.map(m => <option key={m} value={m}>{LEAVE_METHOD_LABEL[m]}</option>)}</SettingSelect></Control>
        </SettingRow>
      </AdminCard>

      <AdminCard testId={tid.mleave.card('policy-entitlement')} icon={<RefreshCw />} title="Entitlement" desc="What a colleague on this policy is given each leave year">
        {!balance && <p data-testid={tid.mleave.policyNoBalance} className="text-sm text-text-secondary">
          {LEAVE_METHOD_LABEL[d.method]}. This method keeps no balance, so there is no allowance, pro-rata, service rule or carry-over to set.</p>}
        {d.method === 'accrual' && <p className="border-b pb-[11px] text-sm text-text-secondary">
          Entitlement builds up at {(ACCRUAL_RATE * 100).toFixed(2)}% of the hours worked, so there is no base allowance, pro-rata or service rule to set.</p>}
        {fixed && <>
          <SettingRow title="Base allowance" desc="A full-time year’s allowance, before pro-rata and service">
            <Control error={numErr ?? at('unit')}>
              <div className="flex flex-wrap items-center gap-sm">
                <SettingText testId={tid.mleave.policyNum(i, 'base')} aria-label="Base allowance" type="number" inputMode="decimal" min="0" step="0.1"
                  className="w-24 text-right tabular-nums" value={d.nums.base} aria-invalid={invalid(numErr)} onChange={e => setNum('base', e.target.value)} />
                <SettingSelect testId={tid.mleave.policyUnit(i)} aria-label="Unit" value={d.unit} aria-invalid={invalid(at('unit'))}
                  onChange={e => { const unit = leaveUnit(e.target.value); if (unit) set({ unit }); }}>
                  {LEAVE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</SettingSelect>
              </div></Control>
          </SettingRow>
          <SettingRow title="Pro-rata" desc={`Scale the allowance by contracted hours against the tenant’s full-time week of ${fullTimeWeeklyHours} hours`}>
            <SwitchField testId={tid.mleave.policyProrata(i)} aria-label="Pro-rata by contracted hours" checked={d.prorata} onCheckedChange={prorata => set({ prorata })} />
          </SettingRow>
          <SubHead>Service rules</SubHead>
          <p className="mb-sm text-xs text-text-muted">After so many whole years of service, add to the allowance, up to a cap. Each rule adds on its own.</p>
          {/* each rule reads as a sentence, which wraps on a phone rather than scrolling a table */}
          {d.serviceRules.length
            ? d.serviceRules.map((rule, j) => {
                const err = fe(`policies.${i}.serviceRules.${j}`);
                return (
                  <div key={j} data-testid={tid.mleave.policyRule(i, j)} className="border-b py-sm">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-xs text-sm">
                      <span>After</span>{ruleInput(j, 'afterYears', 'yrs', 'after years', rule.afterYears, err)}
                      <span>add</span>{ruleInput(j, 'add', short, 'add', rule.add, err)}
                      <span>up to</span>{ruleInput(j, 'cap', short, 'cap', rule.cap, err)}
                      <Button testId={tid.mleave.serviceRuleRemove(i, j)} kind="ghost" small className="ml-auto" aria-label={`Remove service rule ${j + 1}`}
                        onClick={() => set({ serviceRules: d.serviceRules.filter((_, n) => n !== j) })}><Trash2 aria-hidden="true" />Remove</Button>
                    </div>
                    <Err text={err} />
                  </div>);
              })
            : <p data-testid={tid.mleave.policyRulesNone} className="text-xs text-text-muted">No service rules. The allowance is the same however long someone has worked.</p>}
          <div className="mt-sm mb-md flex justify-end">
            <Button testId={tid.mleave.serviceRuleAdd(i)} kind="ghost" small
              onClick={() => set({ serviceRules: [...d.serviceRules, { afterYears: 1, add: 1, cap: 1 }] })}><Plus aria-hidden="true" />Add service rule</Button></div>
        </>}
        {balance && <SettingRow title="Carry-over cap" desc="The most unused days brought from the leave year before. 0 brings none.">
          <Control error={numErr}>{numInput('carry', 'days', 'Carry-over cap', '0.1')}</Control>
        </SettingRow>}
      </AdminCard>

      <AdminCard testId={tid.mleave.card('policy-approval')} icon={<Repeat />} title="Approval" desc="How a request on this policy is decided">
        <SettingRow title="Approval needed" desc="With approval off, a request is approved at once, unless its leave type needs evidence.">
          <SwitchField testId={tid.mleave.policyApproval(i)} aria-label="Approval needed" checked={d.approval} onCheckedChange={approval => set({ approval })} />
        </SettingRow>
        <SettingRow title="Approval SLA" desc={`Days a manager has to decide. Leave it blank to use the tenant default, ${days(config.slaDays)}, set under Escalation.`}>
          <Control error={numErr}>{numInput('sla', 'days', 'Approval SLA', '1', String(config.slaDays))}</Control>
        </SettingRow>
        <SettingRow title="Escalation"
          desc={`A request not decided within the SLA moves up the Escalation ladder on Leave setup (${config.stages.length} stages), the same for every policy.`}>
          <NavLink testId={tid.mleave.policyEscalation} to={pathname} onClick={guard} className={LINK}>Change it on Leave setup</NavLink>
        </SettingRow>
      </AdminCard>

      <AdminCard testId={tid.mleave.card('policy-bank-holidays')} icon={<CalendarDays />} title="Bank holidays" desc="How this policy treats a bank holiday">
        <SettingRow title="Bank-holiday handling"
          desc={!fixed ? 'Only a set allowance can have a bank holiday taken from it, so this changes nothing for this method.'
            : config.bhPaid ? 'Bank holidays are on top of entitlement for this tenant (Entitlement rules), so nothing is taken from the allowance.'
              : 'Bank holidays are not on top of entitlement for this tenant, so “Deduct scheduled working days” takes each working bank holiday from the allowance.'}>
          <SettingSelect testId={tid.mleave.policyBh(i)} className="max-w-full" aria-label="Bank-holiday handling" value={d.bankHolidayHandling}
            onChange={e => { const bh = BANK_HOLIDAY_HANDLING.find(x => x === e.target.value); if (bh) set({ bankHolidayHandling: bh }); }}>
            {BANK_HOLIDAY_HANDLING.map(bh => <option key={bh} value={bh}>{BANK_HOLIDAY_HANDLING_LABEL[bh]}</option>)}</SettingSelect>
        </SettingRow>
      </AdminCard>

      {refusal && <RefusalWarn testId={tid.mleave.policyWarn} refusal={refusal} />}
      <ActionBar stuck={dirty}>
        {dirty && <span data-testid={tid.mleave.policyDirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        <Button testId={tid.mleave.policyCancel} kind="ghost" disabled={!dirty || save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.mleave.policySave} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>
      <ConfirmModal open={leaving} onOpenChange={setLeaving} title="Discard your changes?" body="Your changes to this policy have not been saved."
        confirmLabel="Discard changes" cancelLabel="Keep editing" danger onConfirm={() => { setLeaving(false); void navigate(pathname); }} />
    </>);
}

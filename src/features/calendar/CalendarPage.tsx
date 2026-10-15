import { useState } from 'react';
import { CalendarDays, Folder } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Button, ConfirmModal, Page, PageHead, Pill, Row, SettingRow, SettingSelect, SettingText, UnitInput, toastInfo, toastRefusal } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useTenant, useUpdateTenantSettings, type Tenant } from '@/api/tenant';
import type { BankHolidayRecord } from '@/contract/tenant';
import { bankHolidaysFor, type BankHolidayRegion } from '@/domain/bank-holidays';
import { useLeaveConfig } from '@/api/leave';
import { BANK_HOLIDAY_HANDLING_LABEL } from '@/domain/leave';
import { useRotaConfig } from '@/api/rota';
import { useExportSavedData, useResetSavedData, useRestoreSavedData, useSavedData } from '@/api/saved-data';
import { useCaps } from '@/shell/useCaps';
import { downloadText } from '@/lib/download';
import { WEEK_STARTS, addMonths, DOW_SHORT, dowMon, formatDmy } from '@/domain/time';

/* Calendar: the prototype's admCalendarAll (qnipay-workforce-v15.html:9094-
   9098): the shared calendar and where the work is held. Calendar settings
   are versioned on the tenant; bank holiday dates remain separate from the
   selected region. */
const HORIZONS = [12, 6, 3] as const;
const REGIONS: readonly BankHolidayRegion[] = ['England & Wales', 'Scotland', 'Northern Ireland', 'None'];

export function CalendarPage() {
  const tenant = useTenant();
  return (
    <Page testId={tid.page('acal')}>
      <PageHead title="Calendar" crumb="Qnipay setup · Calendar" tipTestId={tid.head.tip('acal')}
        tip="The leave year, shared week start and bank holidays for this organisation" />
      {tenant.data
        ? <><YearCard key={tenant.data.version} tenant={tenant.data} /><HolidaysCard key={`holidays-${tenant.data.version}`} tenant={tenant.data} /></>
        : tenant.isError
          ? <p data-testid={tid.acal.error} role="alert" className="text-err">The calendar could not be loaded. Reload the page.</p>
          : <p data-testid={tid.acal.loading} className="text-text-secondary">Loading the calendar&hellip;</p>}
      <SavedDataCard />
    </Page>);
}

function YearCard({ tenant }: { tenant: Tenant }) {
  const save = useUpdateTenantSettings();
  const fy = tenant.financialYear;
  const [start, setStart] = useState(fy.start), [end, setEnd] = useState(fy.end), [weekStart, setWeekStart] = useState(tenant.weekStart);
  const [fullTime, setFullTime] = useState(String(tenant.fullTimeWeeklyHours));
  const fullTimeChanged = Number(fullTime) !== tenant.fullTimeWeeklyHours || fullTime.trim() === '';
  const dirty = start !== fy.start || end !== fy.end || weekStart !== tenant.weekStart || fullTimeChanged;
  const apply = () => {
    if (!dirty) return;
    save.mutate({ change: { financialYear: { start, end }, weekStart, ...(fullTimeChanged ? { fullTimeWeeklyHours: Number(fullTime) } : {}) }, ifMatch: tenant.version },
      { onSuccess: out => { if (out.auditId) toastInfo('Calendar settings saved.', 'They are live for everyone now.'); } });
  };
  const cancel = () => { setStart(fy.start); setEnd(fy.end); setWeekStart(tenant.weekStart); setFullTime(String(tenant.fullTimeWeeklyHours)); save.clearFieldErrors(); };
  const fullTimeError = save.fieldError('fullTimeWeeklyHours');
  const choose = (v: number) => {
    const h = HORIZONS.find(x => x === v);
    if (h === undefined || h === tenant.rotaHorizon) return;
    save.mutate({ change: { rotaHorizon: h }, ifMatch: tenant.version },
      { onSuccess: () => toastInfo(`Rota horizon: ${h} months.`, 'Patterns now generate up to this far ahead. It is live for everyone now.') });
  };
  return (
    <AdminCard testId={tid.acal.card('year')} icon={<CalendarDays />} title="Financial year and scheduling period" tipTestId={tid.acal.tip('year')}
      tip="Leave entitlement and leaver reconciliation use this year. The week start and rota horizon are shared settings.">
      <SettingRow title="Financial year" desc="Leave entitlement and leaver reconciliation run on this year">
        <div className="flex flex-wrap items-center gap-sm">
          <SettingText testId={tid.acal.finYearStart} aria-label="Financial year start" type="date" value={start} disabled={save.anyPending}
            aria-invalid={save.fieldError('financialYear') ? true : undefined} onChange={e => setStart(e.target.value)} />
          <span aria-hidden="true">to</span>
          <SettingText testId={tid.acal.finYearEnd} aria-label="Financial year end" type="date" value={end} disabled={save.anyPending}
            aria-invalid={save.fieldError('financialYear') ? true : undefined} onChange={e => setEnd(e.target.value)} />
          <span data-testid={tid.acal.finYear} className="text-xs text-text-muted tabular-nums">{formatDmy(fy.start)} – {formatDmy(fy.end)} ({fy.label})</span>
        </div>
      </SettingRow>
      <SettingRow title="Week starts on" desc="Shared by the rota week and the timesheet week. It cannot change while there are open timesheets or rota weeks.">
        <SettingSelect testId={tid.acal.weekStart} aria-label="Week starts on" value={weekStart} disabled={save.anyPending}
          onChange={e => { const choice = WEEK_STARTS.find(x => x === e.target.value); if (choice) setWeekStart(choice); }}>
          {WEEK_STARTS.map(day => <option key={day} value={day}>{day}</option>)}
        </SettingSelect>
      </SettingRow>
      {/* D3: the one full-time week, read by leave pro-rata and by Contracts' full or part time */}
      <SettingRow title="Full-time weekly hours" desc="Leave pro-rata and the Contracts page compare contracted hours with this">
        <div className="flex flex-col items-end max-md:items-start">
          <UnitInput testId={tid.acal.fullTimeHours} unit="hrs" aria-label="Full-time weekly hours" type="number" inputMode="decimal" min="1" max="80" step="0.5"
            value={fullTime} disabled={save.anyPending} aria-invalid={fullTimeError ? true : undefined} onChange={e => setFullTime(e.target.value)} />
          {fullTimeError && <p role="alert" className="mt-xs text-xs text-err">{fullTimeError}</p>}
        </div>
      </SettingRow>
      <SettingRow title="Rota horizon" desc="How far ahead rota entries are generated from patterns">
        <div className="flex flex-col items-end max-md:items-start">
          <SettingSelect testId={tid.acal.horizon} aria-label="Rota horizon" value={tenant.rotaHorizon} disabled={save.anyPending}
            aria-invalid={save.fieldError('rotaHorizon') ? true : undefined} onChange={e => choose(Number(e.target.value))}>
            {HORIZONS.map(h => <option key={h} value={h}>{h} months</option>)}</SettingSelect>
          {save.fieldError('rotaHorizon') && <p role="alert" className="mt-xs text-xs text-err">{save.fieldError('rotaHorizon')}</p>}
        </div>
      </SettingRow>
      {save.refusal && <p role="alert" className="mt-sm text-xs text-err">{save.refusal.message} {save.refusal.next}</p>}
      {dirty && <div className="mt-md flex justify-end gap-sm">
        <Button testId={tid.acal.settingsCancel} kind="ghost" small disabled={save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.acal.settingsSave} kind="primary" small pending={save.anyPending} onClick={apply}>Save calendar settings</Button>
      </div>}
    </AdminCard>);
}

/* Each module's treatment of a bank holiday, as the prototype words it: Leave
   from the standard policy, Rota from its enhanced-rate flag, Timesheet from
   the date. A module that is off, or whose setup cannot be read, says so. */
function useTreatment(tenant: Tenant): string {
  const caps = useCaps();
  const cfg = caps.has('mod_cfg');
  const leaveOn = tenant.modules.L === true, rotaOn = tenant.modules.R === true;
  const leave = useLeaveConfig(cfg && leaveOn), rota = useRotaConfig(cfg && rotaOn);
  const cfgLeave = leave.data?.config;
  const annual = cfgLeave?.types.find(t => t.code === 'AL');
  const policy = annual ? cfgLeave?.policies.find(p => p.code === annual.policy) : undefined;
  /* annual leave's policy: on top while bank holidays are paid on top (P's words), else how that policy handles them */
  const bh = policy ? (cfgLeave?.bhPaid ? 'On top of entitlement' : BANK_HOLIDAY_HANDLING_LABEL[policy.bankHolidayHandling]) : undefined;
  const lv = !leaveOn ? 'module off' : bh ?? 'see Leave setup';
  const rt = !rotaOn ? 'module off' : rota.data ? (rota.data.config.bhEnhanced ? 'enhanced rate flagged' : 'standard') : 'see Rota setup';
  return `Leave: ${lv} · Rota: ${rt} · Timesheet: date-derived premium`;
}

function HolidaysCard({ tenant }: { tenant: Tenant }) {
  const treatment = useTreatment(tenant);
  const save = useUpdateTenantSettings();
  const [date, setDate] = useState(''), [name, setName] = useState('');
  const [askFill, setAskFill] = useState(false);
  const region = tenant.company.bankHolidayRegion;
  const persist = (bankHolidays: BankHolidayRecord[], message: string, onSuccess?: () => void) =>
    save.mutate({ change: { bankHolidays }, ifMatch: tenant.version },
      { onSuccess: out => { if (out.auditId) toastInfo(message, 'It is live for everyone now.'); onSuccess?.(); } });
  const chooseRegion = (value: string) => {
    const selected = REGIONS.find(x => x === value);
    if (selected && selected !== region) save.mutate({ change: { company: { bankHolidayRegion: selected } }, ifMatch: tenant.version },
      { onSuccess: out => { if (out.auditId) toastInfo(`Bank-holiday region: ${selected}.`, 'The existing dates have not changed.'); } });
  };
  const nextYearEnd = addMonths(tenant.financialYear.end, 12);
  const generated = bankHolidaysFor(region, tenant.financialYear.start, nextYearEnd);
  const addHoliday = () => {
    if (!date || !name.trim()) return;
    persist([...tenant.bankHolidays, { date, name: name.trim() }].sort((a, b) => a.date.localeCompare(b.date)), 'Bank holiday added.',
      () => { setDate(''); setName(''); });
  };
  return (
    <AdminCard testId={tid.acal.card('holidays')} icon={<CalendarDays />} title="Bank holidays" tipTestId={tid.acal.tip('holidays')}
      tip="Shared across Leave, Rota and Timesheet">
      <SettingRow title="Region" desc="Changing the region does not change the dates already held.">
        <SettingSelect testId={tid.acal.region} aria-label="Bank-holiday region" value={region} disabled={save.anyPending} onChange={e => chooseRegion(e.target.value)}>
          {REGIONS.map(value => <option key={value} value={value}>{value}</option>)}
        </SettingSelect>
      </SettingRow>
      <SettingRow title="Fill from region" desc={`Use the shipped dates from ${formatDmy(tenant.financialYear.start)} to ${formatDmy(nextYearEnd)}.`}>
        <Button testId={tid.acal.fillRegion} kind="ghost" small disabled={save.anyPending || region === 'None'} onClick={() => setAskFill(true)}>Fill from region</Button>
      </SettingRow>
      <Table data-testid={tid.acal.holidays} variant="records">
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Day</TableHead><TableHead>Holiday</TableHead><TableHead>Treatment</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {tenant.bankHolidays.map(h => (
            <HolidayRow key={h.date} holiday={h} holidays={tenant.bankHolidays} treatment={treatment} save={save} persist={persist} />))}
          {!tenant.bankHolidays.length && <Row testId={tid.acal.noHolidays}><TableCell colSpan={5} className="text-center text-text-muted">No bank holidays are held for this tenant.</TableCell></Row>}
        </TableBody>
      </Table>
      <div className="mt-md flex flex-wrap items-end gap-sm">
        <label className="flex flex-col gap-xs text-xs font-semibold text-text-secondary">Date
          <SettingText testId={tid.acal.newHolidayDate} type="date" aria-label="New bank holiday date" value={date} disabled={save.anyPending} onChange={e => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-xs text-xs font-semibold text-text-secondary">Holiday
          <SettingText testId={tid.acal.newHolidayName} aria-label="New bank holiday name" value={name} maxLength={80} disabled={save.anyPending} onChange={e => setName(e.target.value)} />
        </label>
        <Button testId={tid.acal.addHoliday} kind="ghost" small disabled={save.anyPending || !date || !name.trim()} onClick={addHoliday}>Add bank holiday</Button>
      </div>
      {save.refusal && <p role="alert" className="mt-sm text-xs text-err">{save.refusal.message} {save.refusal.next}</p>}
      {askFill && <ConfirmModal open onOpenChange={open => { if (!open) setAskFill(false); }} title="Replace the bank holiday list?"
        body={`The list will be replaced with ${generated.length} ${region} bank holidays from ${formatDmy(tenant.financialYear.start)} to ${formatDmy(nextYearEnd)}. Dates outside the shipped 2026 to 2028 table will not be filled.`}
        busy={save.anyPending} confirmLabel="Replace dates" onConfirm={() => persist(generated, 'Bank holidays filled from the selected region.', () => setAskFill(false))} />}
    </AdminCard>);
}

function HolidayRow({ holiday, holidays, treatment, save, persist }: {
  holiday: BankHolidayRecord; holidays: readonly BankHolidayRecord[]; treatment: string;
  save: ReturnType<typeof useUpdateTenantSettings>; persist(rows: BankHolidayRecord[], message: string, onSuccess?: () => void): void;
}) {
  const [editing, setEditing] = useState(false), [date, setDate] = useState(holiday.date), [name, setName] = useState(holiday.name);
  const [remove, setRemove] = useState(false);
  const replace = () => {
    const rows = holidays.filter(h => h.date !== holiday.date);
    persist([...rows, { date, name: name.trim() }].sort((a, b) => a.date.localeCompare(b.date)), 'Bank holiday saved.', () => setEditing(false));
  };
  const cancel = () => { setDate(holiday.date); setName(holiday.name); setEditing(false); };
  return (
    <Row testId={tid.acal.holiday(holiday.date)}>
      <TableCell kind="title" className="tabular-nums">
        {editing ? <SettingText testId={tid.acal.holidayDate(holiday.date)} type="date" aria-label={`Date for ${holiday.name}`} value={date} disabled={save.anyPending}
          onChange={e => setDate(e.target.value)} /> : formatDmy(holiday.date)}
      </TableCell>
      <TableCell label="Day">{DOW_SHORT[dowMon(editing ? date : holiday.date)]}</TableCell>
      <TableCell label="Holiday">
        {editing ? <SettingText testId={tid.acal.holidayName(holiday.date)} aria-label={`Name for ${holiday.name}`} value={name} maxLength={80} disabled={save.anyPending}
          onChange={e => setName(e.target.value)} /> : <strong>{holiday.name}</strong>}
      </TableCell>
      <TableCell label="Treatment" data-testid={tid.acal.treatment(holiday.date)} className="text-xs text-text-muted">{treatment}</TableCell>
      <TableCell kind="foot" className="text-right whitespace-nowrap">
        {editing
          ? <span className="inline-flex gap-sm">
              <Button testId={tid.acal.holidaySave(holiday.date)} kind="ghost" small pending={save.anyPending} disabled={!date || !name.trim()} onClick={replace}>Save</Button>
              <Button testId={tid.acal.holidayCancel(holiday.date)} kind="ghost" small disabled={save.anyPending} onClick={cancel}>Cancel</Button>
            </span>
          : <span className="inline-flex gap-sm">
              <Button testId={tid.acal.holidayEdit(holiday.date)} kind="ghost" small disabled={save.anyPending} onClick={() => setEditing(true)}>Edit</Button>
              <Button testId={tid.acal.holidayRemove(holiday.date)} kind="ghost" small disabled={save.anyPending} onClick={() => setRemove(true)}>Remove</Button>
            </span>}
      </TableCell>
      {remove && <ConfirmModal open onOpenChange={open => { if (!open) setRemove(false); }} title={`Remove ${holiday.name}?`}
        body={`${holiday.name} will be removed from the shared bank holiday list.`} busy={save.anyPending} confirmLabel="Remove"
        onConfirm={() => persist(holidays.filter(h => h.date !== holiday.date), 'Bank holiday removed.', () => setRemove(false))} />}
    </Row>);
}

/* storeCard (v15:4649-4671): where the work is held, export, reset with a
   confirm, bring back a set-aside session, and the build. */
type Ask = 'reset' | 'restore' | null;
function SavedDataCard() {
  const status = useSavedData(), tenant = useTenant();
  const exp = useExportSavedData(), reset = useResetSavedData(), restore = useRestoreSavedData();
  const [ask, setAsk] = useState<Ask>(null);
  const s = status.data;
  const busy = reset.anyPending || restore.anyPending;
  const download = async () => {
    try {
      const file = await exp.run();
      const name = `qnipay-state-${(tenant.data?.name ?? file.tenant).replace(/\W+/g, '-').toLowerCase()}.json`;
      if (downloadText(name, JSON.stringify(file, null, 1), 'application/json')) toastInfo('Exported', 'Keep the file to restore this data elsewhere.');
      else toastRefusal({ message: 'This browser could not produce the file, so nothing was saved.', next: 'Try another browser.' });
    } catch (e) {
      if (e instanceof ApiError) toastRefusal(e.refusal);
    }
  };
  return (
    <AdminCard testId={tid.acal.card('saved')} icon={<Folder />} title="Saved data" tipTestId={tid.acal.tip('saved')}
      tip="Everything you change is kept in this browser on this device. It is not sent anywhere and not shared with anyone else using the app.">
      <SettingRow title="This browser, this device" desc={<span data-testid={tid.acal.size}>{s ? `Roughly ${s.sizeKb} KB held. ` : ''}Work survives a refresh, a closed tab and a restart. It does not follow you to another machine.</span>}>
        {s && <Pill testId={tid.acal.saving} tone={s.saving ? 'ok' : 'err'} glyph={s.saving ? '✓' : '✕'}>{s.saving ? 'Saving' : 'Not saving'}</Pill>}
      </SettingRow>
      <SettingRow title="Move it elsewhere" desc="Download everything as a file you can keep or hand over.">
        <Button testId={tid.acal.export} kind="ghost" small pending={exp.pending} onClick={() => void download()}>Export</Button>
      </SettingRow>
      <SettingRow title="Start again" desc="Clear everything and return to the data the app ships with. The cleared session is kept until the next reset, so it can be brought back once.">
        <Button testId={tid.acal.reset} kind="ghost" small pending={busy} onClick={() => setAsk('reset')}>Reset</Button>
      </SettingRow>
      {s?.setAside && <SettingRow title="Set aside earlier" desc={<span data-testid={tid.acalSetAside.why}>{s.setAsideBecause === 'newer-build'
        ? 'This version ships newer sample data, so the session saved in this browser was set aside. It can be brought back.'
        : 'A reset set the previous session aside. It can be brought back.'}</span>}>
        <Button testId={tid.acal.restore} kind="ghost" small pending={busy} onClick={() => setAsk('restore')}>Bring it back</Button>
      </SettingRow>}
      {s && <SettingRow title="Build" desc={`Sample data version ${s.version}. A new version supersedes a saved session rather than hiding behind it.`}>
        <Pill testId={tid.acal.build} tone="neu" className="tabular-nums">{s.version}</Pill>
      </SettingRow>}
      {ask === 'reset' && <ConfirmModal open onOpenChange={o => { if (!o) setAsk(null); }} title="Reset everything?" danger busy={busy}
        body="Every change made in this browser is removed and the app returns to the data it ships with. What is here now is set aside until the next reset, so it can be brought back once. Export first if you want to keep it for longer."
        confirmLabel="Reset" onConfirm={() => reset.mutate(null, { onSuccess: () => { setAsk(null); toastInfo('Reset', 'The app is back to the data it ships with. The earlier session was set aside.'); } })} />}
      {ask === 'restore' && <ConfirmModal open onOpenChange={o => { if (!o) setAsk(null); }} title="Bring back the earlier session?" busy={busy}
        body="The session set aside is loaded and whatever is here now is replaced. If this version ships newer sample data, that will be hidden again."
        confirmLabel="Bring it back" onConfirm={() => restore.mutate(null, { onSuccess: () => { setAsk(null); toastInfo('Earlier session brought back', 'What was here before it has been replaced.'); } })} />}
    </AdminCard>);
}

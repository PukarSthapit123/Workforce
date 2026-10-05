import { useState } from 'react';
import { CalendarDays, Folder } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Button, ConfirmModal, Page, PageHead, Pill, Row, SettingRow, SettingSelect, toastInfo, toastRefusal } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useTenant, useUpdateTenantSettings, type Tenant } from '@/api/tenant';
import { useLeaveConfig } from '@/api/leave';
import { useRotaConfig } from '@/api/rota';
import { useExportSavedData, useResetSavedData, useRestoreSavedData, useSavedData } from '@/api/saved-data';
import { useCaps } from '@/shell/useCaps';
import { downloadText } from '@/lib/download';
import { DOW_SHORT, dowMon, formatDmy } from '@/domain/time';

/* Calendar: the prototype's admCalendarAll (qnipay-workforce-v15.html:9094-
   9098): the shared calendar (admCalendar, 8300-8321) and where the work is
   held (storeCard, 4649-4671). The financial year, the week start and the
   bank holidays are read-only, seeded per tenant (D7); the rota horizon is
   the one setting here, saved as soon as it is chosen, with If-Match and one
   audit row. "Published to" and the current scheduling week are left out:
   neither is held anywhere this page can read. */
const HORIZONS = [12, 6, 3] as const;
const STD = 'STD';

export function CalendarPage() {
  const tenant = useTenant();
  return (
    <Page testId={tid.page('acal')}>
      <PageHead title="Calendar" crumb="Qnipay setup · Calendar" tipTestId={tid.head.tip('acal')}
        tip="The year every module reads, and where your work is held" />
      {tenant.data
        ? <><YearCard tenant={tenant.data} /><HolidaysCard tenant={tenant.data} /></>
        : tenant.isError
          ? <p data-testid={tid.acal.error} role="alert" className="text-err">The calendar could not be loaded. Reload the page.</p>
          : <p data-testid={tid.acal.loading} className="text-text-secondary">Loading the calendar&hellip;</p>}
      <SavedDataCard />
    </Page>);
}

function YearCard({ tenant }: { tenant: Tenant }) {
  const save = useUpdateTenantSettings();
  const fy = tenant.financialYear;
  const choose = (v: number) => {
    const h = HORIZONS.find(x => x === v);
    if (h === undefined || h === tenant.rotaHorizon) return;
    save.mutate({ change: { rotaHorizon: h }, ifMatch: tenant.version },
      { onSuccess: () => toastInfo(`Rota horizon: ${h} months.`, 'Patterns now generate up to this far ahead. It is live for everyone now.') });
  };
  return (
    <AdminCard testId={tid.acal.card('year')} icon={<CalendarDays />} title="Financial year and scheduling period" tipTestId={tid.acal.tip('year')}
      tip="Used by Leave for entitlement, by Timesheet for pay periods and by Rota for the horizon">
      <SettingRow title="Financial year" desc="Leave entitlement and leaver reconciliation run on this year">
        <span data-testid={tid.acal.finYear} className="text-xs text-text-muted tabular-nums">{formatDmy(fy.start)} – {formatDmy(fy.end)} ({fy.label})</span>
      </SettingRow>
      <SettingRow title="Week starts on" desc={`${tenant.weekStart}. Shared by the rota week and the timesheet week.`}>
        <span data-testid={tid.acal.weekStart} className="text-xs text-text-muted">{tenant.weekStart}</span>
      </SettingRow>
      <SettingRow title="Rota horizon" desc="How far ahead rota entries are generated from patterns">
        <div className="flex flex-col items-end max-md:items-start">
          <SettingSelect testId={tid.acal.horizon} aria-label="Rota horizon" value={tenant.rotaHorizon} disabled={save.anyPending}
            aria-invalid={save.fieldError('rotaHorizon') ? true : undefined} onChange={e => choose(Number(e.target.value))}>
            {HORIZONS.map(h => <option key={h} value={h}>{h} months</option>)}</SettingSelect>
          {save.fieldError('rotaHorizon') && <p role="alert" className="mt-xs text-xs text-err">{save.fieldError('rotaHorizon')}</p>}
        </div>
      </SettingRow>
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
  const policies = leave.data?.config.policies;
  const bh = (policies?.find(p => p.code === STD) ?? policies?.[0])?.bh;
  const lv = !leaveOn ? 'module off' : bh ?? 'see Leave setup';
  const rt = !rotaOn ? 'module off' : rota.data ? (rota.data.config.bhEnhanced ? 'enhanced rate flagged' : 'standard') : 'see Rota setup';
  return `Leave: ${lv} · Rota: ${rt} · Timesheet: date-derived premium`;
}

function HolidaysCard({ tenant }: { tenant: Tenant }) {
  const treatment = useTreatment(tenant);
  return (
    <AdminCard testId={tid.acal.card('holidays')} icon={<CalendarDays />} title="Bank holidays" tipTestId={tid.acal.tip('holidays')}
      tip="Shared across Leave, Rota and Timesheet">
      <Table data-testid={tid.acal.holidays} variant="records">
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Day</TableHead><TableHead>Holiday</TableHead><TableHead>Treatment</TableHead></TableRow></TableHeader>
        <TableBody>
          {tenant.bankHolidays.map(h => (
            <Row key={h.date} testId={tid.acal.holiday(h.date)}>
              <TableCell kind="title" className="tabular-nums">{formatDmy(h.date)}</TableCell>
              <TableCell label="Day">{DOW_SHORT[dowMon(h.date)]}</TableCell>
              <TableCell label="Holiday"><strong>{h.name}</strong></TableCell>
              <TableCell label="Treatment" data-testid={tid.acal.treatment(h.date)} className="text-xs text-text-muted">{treatment}</TableCell>
            </Row>))}
          {!tenant.bankHolidays.length && <Row testId={tid.acal.noHolidays}><TableCell colSpan={4} className="text-center text-text-muted">No bank holidays are held for this tenant.</TableCell></Row>}
        </TableBody>
      </Table>
    </AdminCard>);
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
      if (downloadText(name, JSON.stringify(file, null, 1), 'application/json')) toastInfo('Exported', 'Keep the file to restore this demonstration elsewhere.');
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

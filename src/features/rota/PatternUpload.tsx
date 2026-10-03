import { useState } from 'react';
import { tid } from '@/testids';
import { Button, Field, GroupLabel, Modal, NativeSelect, Row, Stat, Stats, TextInput, toastInfo, toastRefusal } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { downloadText, toCsv } from '@/lib/download';
import { HORIZONS } from '@/domain/rota';

/* Upload working patterns: the prototype's uploadBox, upload-import and
   upload-errors (qnipay-workforce-v15.html:10418-10446, 12241-12256, sample
   at 3646-3654). Mass upload is declared simulated, as the prototype says:
   the window shows the validation preview of a sample file, Import writes
   nothing and says so, and the error report is a real CSV file. */
const UPLOAD_SAMPLE = {
  file: 'working-patterns-2026-27.csv', rows: 248, valid: 244, invalid: 4,
  errors: [
    { row: 31, field: 'Location', msg: 'Unknown location code "WH-2". It is not in workforce master data.' },
    { row: 88, field: 'Job profile', msg: '"Night Suport" does not match a job profile.' },
    { row: 142, field: 'Cost centre', msg: 'CC-991 is not an active cost centre.' },
    { row: 207, field: 'Employee ID', msg: 'CP-9999 is not an employee record.' },
  ],
  warnings: [
    { row: 19, field: 'Cycle length', msg: '14-day cycle assigned to a 7-day pattern. The cycle wins.' },
    { row: 64, field: 'Start date', msg: 'Start date is in the past. Generation begins from today.' },
  ],
} as const;
export const UPLOAD_ERRORS_FILE = 'qnipay-upload-errors.csv';

export function PatternUploadDialog({ horizon, onClose }: { horizon: number; onClose: () => void }) {
  const U = UPLOAD_SAMPLE;
  const [ahead, setAhead] = useState(String((HORIZONS as readonly number[]).includes(horizon) ? horizon : HORIZONS[0]));
  const importRows = () => {
    onClose();
    toastInfo(`Simulated · ${U.valid} rows validated and would import. No patterns have been created.`,
      `Mass upload is simulated, not imported. ${U.invalid} rows were rejected.`);
  };
  const downloadErrors = () => {
    const rows = [['Row', 'Field', 'Reason'], ...U.errors.map(e => [e.row, e.field, e.msg]), ...U.warnings.map(w => [w.row, w.field, `WARNING: ${w.msg}`])];
    if (downloadText(UPLOAD_ERRORS_FILE, toCsv(rows))) toastInfo(`Downloaded · ${U.errors.length} errors and ${U.warnings.length} warnings as CSV`);
    else toastRefusal({ message: 'Download blocked by the browser. No file was produced.', next: 'Allow downloads for this site, then try again.' });
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Upload working patterns"
      footer={<>
        <Button testId={tid.patUpload.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.patUpload.download} kind="ghost" onClick={downloadErrors}>Download the {U.invalid} failed rows</Button>
        <Button testId={tid.patUpload.import} kind="primary" onClick={importRows}>Import {U.valid} valid rows</Button>
      </>}>
      <Field label="File">
        <TextInput testId={tid.patUpload.file} readOnly value={`${U.file} · ${U.rows} rows`} />
      </Field>
      <div className="mt-[14px]">
        <Stats>
          <Stat label="Rows read" testId={tid.patUpload.rows}>{U.rows}</Stat>
          <Stat label="Ready to import" testId={tid.patUpload.valid} tone="good">{U.valid}</Stat>
          <Stat label="Need fixing" testId={tid.patUpload.invalid} tone="bad">{U.invalid}</Stat>
        </Stats>
      </div>
      <GroupLabel className="mt-lg">Errors. These rows are not imported</GroupLabel>
      <Table>
        <TableHeader><TableRow><TableHead className="text-right">Row</TableHead><TableHead>Field</TableHead><TableHead>Problem</TableHead></TableRow></TableHeader>
        <TableBody>{U.errors.map(e => (
          <Row key={e.row} testId={tid.patUpload.error(e.row)}>
            <TableCell className="text-right font-mono">{e.row}</TableCell><TableCell>{e.field}</TableCell>
            <TableCell className="text-xs text-err">{e.msg}</TableCell>
          </Row>))}</TableBody>
      </Table>
      <GroupLabel className="mt-lg">Warnings. Imported, but check them</GroupLabel>
      <Table>
        <TableHeader><TableRow><TableHead className="text-right">Row</TableHead><TableHead>Field</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
        <TableBody>{U.warnings.map(w => (
          <Row key={w.row} testId={tid.patUpload.warning(w.row)}>
            <TableCell className="text-right font-mono">{w.row}</TableCell><TableCell>{w.field}</TableCell>
            <TableCell className="text-xs text-warn">{w.msg}</TableCell>
          </Row>))}</TableBody>
      </Table>
      <div className="mt-lg">
        <Field label="Generate the rota ahead by"
          hint="Validation runs against shared workforce master data, so a location, job profile, cost centre or employee ID that does not exist is rejected before anything is generated.">
          <NativeSelect testId={tid.patUpload.horizon} value={ahead} onChange={e => setAhead(e.target.value)}>
            {HORIZONS.map(m => <option key={m} value={m}>{m} months</option>)}</NativeSelect>
        </Field>
      </div>
    </Modal>);
}

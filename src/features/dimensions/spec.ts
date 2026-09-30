/* Ported from the prototype's DIMS, DIM_GROUPS and SUPPORT_LEVELS
   (qnipay-workforce-v15.html:9110-9227, IMP-019): one form renderer and one
   save path for every dimension, so no dimension behaves differently from
   another. */
import type { DimensionKind, DimensionRow } from '@/contract/dimensions';

export const SUPPORT_LEVELS = [
  { code: 'High', label: 'High support', min: 4 }, { code: 'Medium', label: 'Medium support', min: 3 },
  { code: 'Low', label: 'Low support', min: 2 }, { code: 'Floating', label: 'Floating support', min: 1 },
] as const;
export interface DimCtx { departments: DimensionRow[]; costCentres: DimensionRow[]; locations: DimensionRow[] }
export interface DimField {
  key: string; label: string; kind: 'text' | 'number' | 'bool' | 'select' | 'date';
  required?: boolean; code?: boolean; optional?: boolean; hint?: string; wide?: boolean;
  options?: (ctx: DimCtx) => { value: string; label: string }[];
}
export interface DimSpec { kind: DimensionKind; label: string; singular: string; desc: string; usedAs: string; icon: string; fields: DimField[] }
const rows = (list: DimensionRow[], withCode = false) => list.map(r => ({ value: r.code, label: withCode ? `${r.code} · ${r.name}` : r.name }));

export const DIM_SPECS: Record<DimensionKind, DimSpec> = {
  locations: { kind: 'locations', label: 'Locations', singular: 'location', icon: 'building', usedAs: 'the people and projects at each location',
    desc: 'Where the work happens. Carries the support level that decides minimum staffing.',
    fields: [
      { key: 'code', label: 'Code', kind: 'text', required: true, code: true, hint: 'Short and stable. Rota lines reference it.' },
      { key: 'name', label: 'Location name', kind: 'text', required: true },
      { key: 'area', label: 'Area', kind: 'text' },
      { key: 'department', label: 'Department', kind: 'select', optional: true, options: c => rows(c.departments) },
      { key: 'costCentre', label: 'Cost centre', kind: 'select', optional: true, options: c => rows(c.costCentres, true) },
      { key: 'level', label: 'Support level', kind: 'select', hint: 'Sets minimum staffing, which coverage is measured against.',
        options: () => SUPPORT_LEVELS.map(l => ({ value: l.code, label: `${l.label} · ${l.min} per shift` })) },
      { key: 'minPerShift', label: 'People per shift', kind: 'number' },
      { key: 'manager', label: 'Manager', kind: 'text' },
      { key: 'address', label: 'Address', kind: 'text', wide: true },
    ] },
  departments: { kind: 'departments', label: 'Departments', singular: 'department', icon: 'shield', usedAs: 'the locations and people in each department',
    desc: 'Who owns the work. Approval scope and manager visibility follow it.',
    fields: [
      { key: 'code', label: 'Code', kind: 'text', required: true, code: true },
      { key: 'name', label: 'Department name', kind: 'text', required: true },
      { key: 'manager', label: 'Manager', kind: 'text' },
    ] },
  'cost-centres': { kind: 'cost-centres', label: 'Cost centres', singular: 'cost centre', icon: 'money', usedAs: 'the locations and projects costed to each one',
    desc: 'What the work is costed to, and what crosses to Business Central.',
    fields: [
      { key: 'code', label: 'Code', kind: 'text', required: true, code: true, hint: 'Business Central matches on this.' },
      { key: 'name', label: 'Cost centre name', kind: 'text', required: true },
    ] },
  'job-profiles': { kind: 'job-profiles', label: 'Job profiles', singular: 'job profile', icon: 'users', usedAs: 'the people holding each profile',
    desc: 'The canonical role list. Rota assigns to it, Timesheet reports on it, approval scope follows it.',
    fields: [
      { key: 'code', label: 'Code', kind: 'text', required: true, code: true },
      { key: 'name', label: 'Job profile', kind: 'text', required: true },
      { key: 'night', label: 'Night-capable', kind: 'bool', hint: 'Only night-capable profiles are offered a night shift.' },
    ] },
  projects: { kind: 'projects', label: 'Projects', singular: 'project', icon: 'folder', usedAs: 'timesheet lines, which arrive with the Timesheet module',
    desc: 'What the time is charged to. Appears on every timesheet line that captures allocation.',
    fields: [
      { key: 'code', label: 'Project code', kind: 'text', required: true, code: true },
      { key: 'name', label: 'Project name', kind: 'text', required: true },
      { key: 'client', label: 'Client', kind: 'text' },
      { key: 'costCentre', label: 'Cost centre', kind: 'select', optional: true, options: c => rows(c.costCentres, true) },
      { key: 'manager', label: 'Project manager', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'select', options: () => ['Active', 'Open', 'Always open', 'Closed'].map(s => ({ value: s, label: s })) },
      { key: 'start', label: 'Starts', kind: 'date' },
      { key: 'end', label: 'Ends', kind: 'date' },
      { key: 'budgetHours', label: 'Budget (hours)', kind: 'text' },
      { key: 'billable', label: 'Billable', kind: 'bool' },
      { key: 'location', label: 'Location', kind: 'select', optional: true, options: c => rows(c.locations) },
    ] },
};
/* The prototype's grouping: three questions, in the order a reader asks them. */
export const DIM_GROUPS: { key: string; label: string; note: string; kinds: DimensionKind[] }[] = [
  { key: 'where', label: 'Where work happens', note: 'Sites and the teams attached to them. Rota coverage and manager scope follow these.', kinds: ['locations', 'departments'] },
  { key: 'what', label: 'What people do', note: 'The role list rota assigns to and timesheet reports on.', kinds: ['job-profiles'] },
  { key: 'charged', label: 'What work is charged to', note: 'What crosses to Business Central on every posted line.', kinds: ['cost-centres', 'projects'] },
];

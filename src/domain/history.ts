/* Field-level history: one entry per field that changed, before → after, in the
   words the audit log and the person record show. */
export const FIELD_LABELS: Record<string, string> = {
  code: 'Employee ID', name: 'Full name', email: 'Work email', phone: 'Mobile number', address: 'Home address',
  emergencyName: 'Emergency contact', emergencyPhone: 'Emergency number', bankAccount: 'Bank account number',
  bankSortCode: 'Sort code', jobProfile: 'Job profile', employeeType: 'Employee type', category: 'Basis',
  location: 'Location', department: 'Department', manager: 'Line manager', contractedHours: 'Contracted hours',
  maxHours: 'Maximum hours', night: 'Night work permitted', resource: 'Business Central resource no.',
  cis: 'Paid under CIS', start: 'Start date', end: 'End date', state: 'State', userType: 'User type',
};
export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

export function historyValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(historyValue).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, keys: readonly string[]) {
  return keys
    .map(field => ({ field, from: historyValue(before[field]), to: historyValue(after[field]) }))
    .filter(d => d.from !== d.to);
}

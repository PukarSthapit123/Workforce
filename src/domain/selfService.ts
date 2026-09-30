/* Self-service profile changes. Ported from the prototype's SELF_FIELDS and
   PROFILE_CHANGES. A proposal writes nothing to the person's record; it takes
   effect only when the last approver on its route says yes. Bank details also
   route to payroll (the prototype's approval chain: "Payroll · Only bank details"). */
export const SELF_FIELD_KEYS = ['phone', 'address', 'emergencyName', 'emergencyPhone', 'bankAccount', 'bankSortCode'] as const;
export type SelfFieldKey = (typeof SELF_FIELD_KEYS)[number];
export interface SelfFieldDef { key: SelfFieldKey; label: string; hint: string; sensitive: boolean; inputType: 'tel' | 'text' }

export const SELF_FIELDS: readonly SelfFieldDef[] = [
  { key: 'phone', label: 'Mobile number', hint: 'Used for shift offers and urgent cover', sensitive: false, inputType: 'tel' },
  { key: 'address', label: 'Home address', hint: 'Kept for payroll and statutory documents', sensitive: false, inputType: 'text' },
  { key: 'emergencyName', label: 'Emergency contact', hint: 'Who we call if something happens on shift', sensitive: false, inputType: 'text' },
  { key: 'emergencyPhone', label: 'Emergency number', hint: '', sensitive: false, inputType: 'tel' },
  { key: 'bankAccount', label: 'Bank account number', hint: 'Verified by payroll before it takes effect. Workforce never uses it.', sensitive: true, inputType: 'text' },
  { key: 'bankSortCode', label: 'Sort code', hint: '', sensitive: true, inputType: 'text' },
];
export function selfField(key: SelfFieldKey): SelfFieldDef {
  const f = SELF_FIELDS.find(x => x.key === key);
  if (!f) throw new Error(`unknown self-service field ${key}`);
  return f;
}

export type Stage = 'manager' | 'payroll';
export const STAGE_CAPABILITY: Record<Stage, string> = { manager: 'profile_appr', payroll: 'bank_verify' };
export const STAGE_CAPABILITY_LABEL: Record<Stage, string> = { manager: 'Approve profile changes', payroll: 'Verify bank detail changes' };

/* plan 1c replaces this with a lookup in the approval-chain framework */
export const routeFor = (key: SelfFieldKey): Stage[] => (selfField(key).sensitive ? ['manager', 'payroll'] : ['manager']);

export function afterDecision(change: { stage: Stage | 'done'; route: readonly Stage[] }, decision: 'approve' | 'decline'):
  { status: 'pending' | 'approved' | 'declined'; stage: Stage | 'done' } {
  if (change.stage === 'done') throw new Error('This change was already decided');
  if (decision === 'decline') return { status: 'declined', stage: 'done' };
  const next = change.route[change.route.indexOf(change.stage) + 1];
  return next ? { status: 'pending', stage: next } : { status: 'approved', stage: 'done' };
}

export const maskBank = (v: string) => (v ? `****${v.slice(-4)}` : '');

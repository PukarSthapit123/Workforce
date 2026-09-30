import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta } from './common';
import { Person } from './people';

export const SelfFieldKey = z.enum(['phone', 'address', 'emergencyName', 'emergencyPhone', 'bankAccount', 'bankSortCode']);
export const ApprovalStage = z.enum(['manager', 'payroll']);
export const ProfileChange = RecordMeta.extend({
  personCode: z.string(), personName: z.string(), field: SelfFieldKey, from: z.string(), to: z.string(), note: z.string(),
  raisedAt: IsoDateTime, status: z.enum(['pending', 'approved', 'declined']), stage: z.enum(['manager', 'payroll', 'done']),
  route: z.array(ApprovalStage),
  decisions: z.array(z.object({ stage: ApprovalStage, decision: z.enum(['approve', 'decline']),
    by: z.object({ personCode: z.string(), name: z.string() }), at: IsoDateTime, reason: z.string().optional() })),
});
export type ProfileChange = z.infer<typeof ProfileChange>;
export const SelfField = z.object({ key: SelfFieldKey, label: z.string(), hint: z.string(), sensitive: z.boolean(), inputType: z.enum(['tel', 'text']) });
export type SelfField = z.infer<typeof SelfField>;
export const Profile = z.object({ person: Person, fields: z.array(SelfField), pending: z.array(ProfileChange), selfEdit: z.boolean() });
export type Profile = z.infer<typeof Profile>;
export const ProposeChanges = z.object({ changes: z.array(z.object({ field: SelfFieldKey, to: z.string() })), note: z.string() });
export type ProposeChanges = z.infer<typeof ProposeChanges>;
export const Decision = z.object({ decision: z.enum(['approve', 'decline']), reason: z.string() });
export type Decision = z.infer<typeof Decision>;
const ChangeParams = z.object({ id: z.string().min(1) });

export const getProfile = defineEndpoint({ method: 'GET', path: '/api/v1/profile', response: Profile, capability: 'own_home',
  summary: 'Your own record, the fields you may propose changes to, and your changes awaiting a decision' });
export const proposeChanges = defineEndpoint({ method: 'POST', path: '/api/v1/profile-changes', request: ProposeChanges,
  response: z.object({ records: z.array(ProfileChange), auditId: z.string() }), capability: 'own_home', errors: [409],
  summary: 'Propose changes to your own contact, emergency or bank details. Nothing changes until approved.' });
/* No single capability: the manager stage needs profile_appr and the payroll
   stage bank_verify, which the handler checks. */
export const listProfileChanges = defineEndpoint({ method: 'GET', path: '/api/v1/profile-changes', response: z.array(ProfileChange), errors: [403],
  summary: 'Changes awaiting you: manager stage for your people (profile_appr), payroll stage (bank_verify)' });
export const decideProfileChange = defineEndpoint({ method: 'POST', path: '/api/v1/profile-changes/:id/decision', params: ChangeParams, request: Decision,
  response: z.object({ record: ProfileChange, person: Person.nullable(), auditId: z.string() }), versioned: true, errors: [404, 409],
  summary: 'Approve or decline one change (If-Match). The stage needs profile_appr or bank_verify. The last approval on its route writes it to the record.' });

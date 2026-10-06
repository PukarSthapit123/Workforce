/* Module 5 Onboarding: the reads and writes the onb portal, the tonb tracker
   and the monb setup page use. Writes go through useRecordMutation, so nothing
   changes on screen until the server has answered and the queries below have
   been read again. Every write to a case carries If-Match on the case (D1);
   the config and each policy carry their own version (D2). Invite and Start
   them move the person along the lifecycle, so they re-read people too. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { notificationKeys } from './notifications';
import { peopleKeys } from './people';
import {
  ackOnboardingPolicy, addOnboardingPolicy, chaseStarter, editOnboardingPolicy, getMyOnboarding, getOnboardingSetup, getStarterOnboarding,
  getTeamOnboarding, inviteStarter, readOnboardingPolicy, rejectOnboardingDocument, removeOnboardingPolicy, saveOnboardingStep, startStarter,
  submitOnboarding, updateOnboardingConfig, uploadOnboardingDocument, uploadOnboardingPolicy, verifyOnboardingDocument,
  type Blocker, type CaseChanged, type CaseSubmitted, type OnbDocumentRecord, type OnbDocumentView, type OnbFeatures, type OnbFileRecord,
  type OnboardingCaseRecord, type OnboardingConfigRecord, type OnboardingConfigSaved, type OnboardingDetail, type OnboardingSetup, type OnbPerson,
  type OnbPolicySetupView, type OnbPolicyView, type OnbProgress, type OnbQueueRow, type OnbStepRecord, type OnbStepView, type PolicyDraft,
  type PolicyRemoved, type PolicySaved, type PolicyUploaded, type SaveStep, type StarterChased, type StarterMoved, type SubmitOnboarding,
  type TeamOnboarding, type TrackerRow, type UpdateOnboardingConfig, type UploadFile,
} from '@/contract/onboarding';

export const onboardingKeys = {
  all: ['onboarding'] as const,
  mine: ['onboarding', 'me'] as const,
  team: ['onboarding', 'team'] as const,
  starter: (personCode: string) => ['onboarding', 'team', personCode] as const,
  setup: ['onboarding', 'setup'] as const,
};

/* ---------------------------------------------------------------- reads */
/* Only while the signed-in person is a candidate or preboarding: refused otherwise (NOT_ONBOARDING). */
export const useMyOnboarding = (enabled = true) => useQuery({ queryKey: onboardingKeys.mine, queryFn: () => api(getMyOnboarding), enabled });
export const useTeamOnboarding = (enabled = true) => useQuery({ queryKey: onboardingKeys.team, queryFn: () => api(getTeamOnboarding), enabled });
export const useStarterOnboarding = (personCode: string, enabled = true) => useQuery({
  queryKey: onboardingKeys.starter(personCode), queryFn: () => api(getStarterOnboarding, { params: { personCode } }), enabled: enabled && !!personCode,
});
export const useOnboardingSetup = (enabled = true) => useQuery({ queryKey: onboardingKeys.setup, queryFn: () => api(getOnboardingSetup), enabled });

/* --------------------------------------------------------------- writes */
type CaseRef = Pick<OnboardingCaseRecord, 'id' | 'version'>;
/* the starter's own writes, and the decisions that tell them */
const MINE = [onboardingKeys.all] as const;
const TELLS = [onboardingKeys.all, notificationKeys.all] as const;
/* Invite and Start them change the person record too. */
const MOVES = [onboardingKeys.all, peopleKeys.all, notificationKeys.all] as const;

/* All of one starter's case writes share its key, so a second waits for the first and sends the fresh version. */
export const useSaveOnboardingStep = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; step: string; body: SaveStep }) => api(saveOnboardingStep, { params: { step: v.step }, body: v.body, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: MINE,
});
export const useUploadOnboardingDocument = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; doc: string; file: UploadFile }) => api(uploadOnboardingDocument, { params: { doc: v.doc }, body: v.file, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: MINE,
});
export const useReadOnboardingPolicy = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; policy: string }) => api(readOnboardingPolicy, { params: { id: v.policy }, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: MINE,
});
export const useAckOnboardingPolicy = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; policy: string; on: boolean }) => api(ackOnboardingPolicy, { params: { id: v.policy }, body: { on: v.on }, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: MINE,
});
export const useSubmitOnboarding = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; body: SubmitOnboarding }) => api(submitOnboarding, { body: v.body, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: TELLS,
});

export const useVerifyOnboardingDocument = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; personCode: string; doc: string }) =>
    api(verifyOnboardingDocument, { params: { personCode: v.personCode, doc: v.doc }, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: TELLS,
});
export const useRejectOnboardingDocument = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; personCode: string; doc: string; reason: string }) =>
    api(rejectOnboardingDocument, { params: { personCode: v.personCode, doc: v.doc }, body: { reason: v.reason }, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: TELLS,
});
export const useInviteStarter = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; personCode: string }) => api(inviteStarter, { params: { personCode: v.personCode }, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: MOVES,
});
export const useStartStarter = () => useRecordMutation({
  mutationFn: (v: { case: CaseRef; personCode: string }) => api(startStarter, { params: { personCode: v.personCode }, ifMatch: v.case.version }),
  recordKey: v => `onboarding/case/${v.case.id}`, invalidates: MOVES,
});
export const useChaseStarter = () => useRecordMutation({
  mutationFn: (v: { personCode: string }) => api(chaseStarter, { params: { personCode: v.personCode } }),
  recordKey: v => `onboarding/chase/${v.personCode}`, invalidates: TELLS,
});

/* Onboarding setup (monb): the config applies on Save (D2); each policy is its own row. */
export const useSaveOnboardingConfig = () => useRecordMutation({
  mutationFn: (v: { config: Pick<OnboardingConfigRecord, 'version'>; body: UpdateOnboardingConfig }) => api(updateOnboardingConfig, { body: v.body, ifMatch: v.config.version }),
  recordKey: () => 'onboarding/config', invalidates: MINE,
});
export const useAddOnboardingPolicy = () => useRecordMutation({
  mutationFn: (body: PolicyDraft) => api(addOnboardingPolicy, { body }), recordKey: () => 'onboarding/policy/new', invalidates: MINE,
});
type PolicyRef = Pick<OnbPolicySetupView, 'id' | 'version'>;
export const useEditOnboardingPolicy = () => useRecordMutation({
  mutationFn: (v: { policy: PolicyRef; body: PolicyDraft }) => api(editOnboardingPolicy, { params: { id: v.policy.id }, body: v.body, ifMatch: v.policy.version }),
  recordKey: v => `onboarding/policy/${v.policy.id}`, invalidates: MINE,
});
export const useUploadOnboardingPolicy = () => useRecordMutation({
  mutationFn: (v: { policy: PolicyRef; file: UploadFile }) => api(uploadOnboardingPolicy, { params: { id: v.policy.id }, body: v.file, ifMatch: v.policy.version }),
  recordKey: v => `onboarding/policy/${v.policy.id}`, invalidates: MINE,
});
export const useRemoveOnboardingPolicy = () => useRecordMutation({
  mutationFn: (v: { policy: PolicyRef }) => api(removeOnboardingPolicy, { params: { id: v.policy.id }, ifMatch: v.policy.version }),
  recordKey: v => `onboarding/policy/${v.policy.id}`, invalidates: MINE,
});

export type {
  Blocker, CaseChanged, CaseSubmitted, OnbDocumentRecord, OnbDocumentView, OnbFeatures, OnbFileRecord, OnboardingCaseRecord, OnboardingConfigRecord,
  OnboardingConfigSaved, OnboardingDetail, OnboardingSetup, OnbPerson, OnbPolicySetupView, OnbPolicyView, OnbProgress, OnbQueueRow, OnbStepRecord,
  OnbStepView, PolicyDraft, PolicyRemoved, PolicySaved, PolicyUploaded, SaveStep, StarterChased, StarterMoved, SubmitOnboarding, TeamOnboarding,
  TrackerRow, UpdateOnboardingConfig, UploadFile,
};

import { z } from 'zod';
import { defineEndpoint } from './endpoints';

export const SessionAccount = z.object({ email: z.string(), userType: z.enum(['employee', 'manager', 'admin']), personCode: z.string(), name: z.string() });
/* The signed-in account as the account menu shows it: who, their role and
   what it is for, and where they work. */
export const SessionAccountView = SessionAccount.extend({ roleName: z.string(), roleDescription: z.string(), locationName: z.string() });
export const Session = z.object({
  token: z.string(), account: SessionAccountView, capabilities: z.array(z.string()),
  viewingAs: z.object({ personCode: z.string(), name: z.string(), userType: SessionAccount.shape.userType }).optional(),
  simulated: z.literal(true),   // honest label: this sign-in is not Entra ID yet
});
export type Session = z.infer<typeof Session>;
export const SignInRequest = z.object({ email: z.string().min(1), password: z.string().min(1) });
export const ViewAsRequest = z.object({ personCode: z.string() });
/* One person the account menu offers to view as: one per role (and one per
   employee type among employees), so the list shows how the app differs
   rather than listing the workforce. */
export const ViewAsPerson = z.object({ personCode: z.string(), name: z.string(), userType: SessionAccount.shape.userType,
  roleName: z.string(), locationName: z.string(), onboarding: z.boolean() });
export type ViewAsPerson = z.infer<typeof ViewAsPerson>;
export const DemoAccount = z.object({ email: z.string(), name: z.string(), userType: SessionAccount.shape.userType, personCode: z.string() });

export const createSession = defineEndpoint({ method: 'POST', path: '/api/v1/session', request: SignInRequest, response: Session, public: true, errors: [401], summary: 'Sign in (simulated; Entra ID in production)' });
export const getSession = defineEndpoint({ method: 'GET', path: '/api/v1/session', response: Session, summary: 'The current session' });
export const deleteSession = defineEndpoint({ method: 'DELETE', path: '/api/v1/session', response: z.null(), allowedWhileViewing: true, summary: 'Sign out' });
export const startViewAs = defineEndpoint({ method: 'POST', path: '/api/v1/session/view-as', request: ViewAsRequest, response: Session, capability: 'perm_cfg', summary: 'Look at the app as another person, as a preview in which changes are off; audited' });
export const listViewAsPeople = defineEndpoint({ method: 'GET', path: '/api/v1/session/view-as/people', response: z.array(ViewAsPerson), capability: 'perm_cfg', summary: 'Who the account menu offers to view as: at most five, one per role' });
export const endViewAs = defineEndpoint({ method: 'DELETE', path: '/api/v1/session/view-as', response: Session, allowedWhileViewing: true, summary: 'Return to your own account' });
export const listAccounts = defineEndpoint({ method: 'GET', path: '/api/v1/session/accounts', response: z.array(DemoAccount), public: true, summary: 'Demo account shortcuts (stub: not in production)' });

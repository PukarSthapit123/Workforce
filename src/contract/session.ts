import { z } from 'zod';
import { defineEndpoint } from './endpoints';

export const SessionAccount = z.object({ email: z.string(), userType: z.enum(['employee', 'manager', 'admin']), personCode: z.string(), name: z.string() });
export const Session = z.object({
  token: z.string(), account: SessionAccount, capabilities: z.array(z.string()),
  viewingAs: z.object({ personCode: z.string(), name: z.string(), userType: SessionAccount.shape.userType }).optional(),
  simulated: z.literal(true),   // honest label: this sign-in is not Entra ID yet
});
export type Session = z.infer<typeof Session>;
export const SignInRequest = z.object({ email: z.string().min(1), password: z.string().min(1) });
export const ViewAsRequest = z.object({ personCode: z.string() });
export const DemoAccount = z.object({ email: z.string(), name: z.string(), userType: SessionAccount.shape.userType, personCode: z.string() });

export const createSession = defineEndpoint({ method: 'POST', path: '/api/v1/session', request: SignInRequest, response: Session, public: true, errors: [401], summary: 'Sign in (simulated; Entra ID in production)' });
export const getSession = defineEndpoint({ method: 'GET', path: '/api/v1/session', response: Session, summary: 'The current session' });
export const deleteSession = defineEndpoint({ method: 'DELETE', path: '/api/v1/session', response: z.null(), allowedWhileViewing: true, summary: 'Sign out' });
export const startViewAs = defineEndpoint({ method: 'POST', path: '/api/v1/session/view-as', request: ViewAsRequest, response: Session, capability: 'perm_cfg', summary: 'Look at the app as another person, as a preview in which changes are off; audited' });
export const endViewAs = defineEndpoint({ method: 'DELETE', path: '/api/v1/session/view-as', response: Session, allowedWhileViewing: true, summary: 'Return to your own account' });
export const listAccounts = defineEndpoint({ method: 'GET', path: '/api/v1/session/accounts', response: z.array(DemoAccount), public: true, summary: 'Demo account shortcuts (stub: not in production)' });

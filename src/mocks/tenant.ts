import { store } from './store';
import { refuse } from './http';
import { serve } from './serve';
import { getTenant, type Tenant } from '@/contract/tenant';

export const tenantHandlers = [
  serve(getTenant, () => store.coll<Tenant>('tenant').tenant
    ?? refuse(404, { code: 'not-found', message: 'This tenant has no settings loaded.', next: 'Reload the page. If it keeps happening, report it.' })),
];

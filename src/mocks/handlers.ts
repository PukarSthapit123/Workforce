import { faultsHandler } from './faults';
import { devHandlers } from './dev';
import { sessionHandlers } from './session';
import { tenantHandlers } from './tenant';
import { accessHandlers } from './access';
import { auditHandlers } from './audit-handlers';
import { peopleHandlers } from './people';
/* Order matters: faults first, so they can pre-empt any endpoint. */
export const handlers = [faultsHandler, ...devHandlers, ...sessionHandlers, ...tenantHandlers, ...accessHandlers, ...auditHandlers, ...peopleHandlers /* feature handlers appended by later tasks */];

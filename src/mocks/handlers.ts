import { faultsHandler } from './faults';
import { devHandlers } from './dev';
import { sessionHandlers } from './session';
import { tenantHandlers } from './tenant';
/* Order matters: faults first, so they can pre-empt any endpoint. */
export const handlers = [faultsHandler, ...devHandlers, ...sessionHandlers, ...tenantHandlers /* feature handlers appended by later tasks */];

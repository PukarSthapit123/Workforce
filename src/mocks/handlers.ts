import { faultsHandler } from './faults';
import { devHandlers } from './dev';
import { sessionHandlers } from './session';
import { tenantHandlers } from './tenant';
import { accessHandlers } from './access';
import { auditHandlers } from './audit-handlers';
import { peopleHandlers } from './people';
import { transitionHandlers } from './transitions';
import { dimensionHandlers } from './dimensions';
import { employeeTypeHandlers } from './employee-types';
/* Order matters: faults first, so they can pre-empt any endpoint. */
export const handlers = [faultsHandler, ...devHandlers, ...sessionHandlers, ...tenantHandlers, ...accessHandlers, ...auditHandlers, ...peopleHandlers, ...transitionHandlers, ...dimensionHandlers, ...employeeTypeHandlers /* feature handlers appended by later tasks */];

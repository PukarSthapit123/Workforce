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
import { profileHandlers } from './profile';
import { timesheetHandlers } from './timesheets';
import { rotaHandlers } from './rota';
import { leaveHandlers } from './leave';
/* Order matters: faults first, so they can pre-empt any endpoint. */
export const handlers = [faultsHandler, ...devHandlers, ...sessionHandlers, ...tenantHandlers, ...accessHandlers, ...auditHandlers, ...peopleHandlers, ...transitionHandlers, ...dimensionHandlers, ...employeeTypeHandlers, ...profileHandlers, ...timesheetHandlers, ...rotaHandlers, ...leaveHandlers /* feature handlers appended by later tasks */];

import { faultsHandler } from './faults';
import { devHandlers } from './dev';
/* Order matters: faults first, so they can pre-empt any endpoint. */
export const handlers = [faultsHandler, ...devHandlers /* feature handlers appended by later tasks */];

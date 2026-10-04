import { z } from 'zod';
import { defineEndpoint } from './endpoints';

/* The demonstration's saved data (the prototype's storeCard, v15:4649-4671;
   D14). Everything this build holds lives in the browser, in the fake
   server's store, so these endpoints are the fake server's own: devOnly,
   left out of the production contract. */
export const SavedData = z.object({
  /* the seed this build ships; a store saved under another is set aside */
  version: z.string(),
  /* roughly how much is held, in KB */
  sizeKb: z.number().int().nonnegative(),
  /* false when the browser refused the last save */
  saving: z.boolean(),
  /* a session set aside by a reset or by a newer build, which can be brought back */
  setAside: z.boolean(),
});
export type SavedData = z.infer<typeof SavedData>;
/* The export file: every collection except the sign-in sessions. */
export const SavedDataExport = z.object({
  kind: z.literal('qnipay.state'), v: z.literal(1), at: z.string(), version: z.string(), tenant: z.string(),
  data: z.record(z.string(), z.record(z.string(), z.unknown())),
});
export type SavedDataExport = z.infer<typeof SavedDataExport>;

export const getSavedData = defineEndpoint({ method: 'GET', path: '/api/v1/saved-data', response: SavedData, capability: 'master_data', devOnly: true,
  summary: 'Where this demonstration holds its work: the build, roughly how much is held, whether it is saving, and whether a session was set aside' });
export const exportSavedData = defineEndpoint({ method: 'GET', path: '/api/v1/saved-data/export', response: SavedDataExport, capability: 'master_data', devOnly: true,
  summary: 'Everything held, as one file to keep or hand over (sign-in sessions left out)' });
export const resetSavedData = defineEndpoint({ method: 'POST', path: '/api/v1/saved-data/reset', response: SavedData, capability: 'master_data', devOnly: true,
  summary: 'Return to the data the app ships with. What was here is set aside, so it can be brought back once; sign-in sessions survive.' });
export const restoreSavedData = defineEndpoint({ method: 'POST', path: '/api/v1/saved-data/restore', response: SavedData, capability: 'master_data', devOnly: true,
  errors: [409], summary: 'Bring back the session set aside by a reset or a newer build (409 NOTHING_SET_ASIDE when there is none)' });

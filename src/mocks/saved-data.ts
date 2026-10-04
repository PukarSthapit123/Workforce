/* The demonstration's saved data (acal's Saved data card; the prototype's
   storeCard, exportState, resetState and restoreBackup, v15:4649-4671,
   4935-4963; D14). The store keeps everything in this browser; these
   handlers report on it, export it, reset it to the seed and bring back the
   session a reset or a newer build set aside. Sign-in sessions survive a
   reset or a restore, so the person doing it stays signed in, and each of
   the two writes leaves one audit row in the data it leaves behind. */
import { store, SEED_VERSION } from './store';
import { refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { exportSavedData, getSavedData, resetSavedData, restoreSavedData, type SavedData } from '@/contract/saved-data';

const SESSIONS = 'sessions';
function status(): SavedData {
  return { version: SEED_VERSION, sizeKb: Math.max(1, Math.round(store.persisted().length / 1024)), saving: store.saving, setAside: store.hasBackup() };
}
/* Runs a whole-store change and puts the sign-in sessions back afterwards. */
function keepingSessions(change: () => void) {
  const sessions = structuredClone(store.coll<Record<string, unknown>>(SESSIONS));
  change();
  store.db[SESSIONS] = sessions;
}

export const savedDataHandlers = [
  serve(getSavedData, () => status()),

  serve(exportSavedData, () => ({
    kind: 'qnipay.state' as const, v: 1 as const, at: store.now(), version: SEED_VERSION, tenant: store.tenant,
    data: Object.fromEntries(Object.entries(store.db).filter(([k]) => k !== SESSIONS)),
  })),

  serve(resetSavedData, ({ session }) => {
    keepingSessions(() => store.resetKeepingBackup());
    writeAudit({ who: actor(session), act: 'Saved data reset', entity: 'savedData', entityId: store.tenant,
      after: { detail: 'Returned to the data the app ships with. The earlier session was set aside.' } });
    store.save();
    return status();
  }),

  serve(restoreSavedData, ({ session }) => {
    if (!store.hasBackup()) refuse(409, { code: 'NOTHING_SET_ASIDE', message: 'Nothing was set aside to bring back.',
      next: 'Carry on with what is here. A reset, or a newer build, sets a session aside.' });
    let ok = false;
    keepingSessions(() => { ok = store.restoreBackup(); });
    if (!ok) refuse(409, { code: 'NOTHING_SET_ASIDE', message: 'The session set aside could not be read, so nothing was brought back.',
      next: 'Carry on with what is here.' });
    writeAudit({ who: actor(session), act: 'Earlier session brought back', entity: 'savedData', entityId: store.tenant,
      after: { detail: 'The session set aside was loaded in place of what was here.' } });
    store.save();
    return status();
  }),
];

/* Notifications are stored rows in one collection (module 3 D8, module 4 D12).
   There is no inbox screen yet (1c): a row is what a test, and later the inbox,
   reads. Ids are a zero-padded counter one past the highest stored, so they
   sort in write order under the frozen clock. */
import { store } from './store';

const NTF = /^ntf_(\d{12})$/;
export function notify(codes: Iterable<string>, n: { title: string; body: string }, area: string) {
  const coll = store.coll('notifications');
  let max = 0;
  for (const id of Object.keys(coll)) max = Math.max(max, Number(NTF.exec(id)?.[1] ?? 0));
  for (const personId of new Set(codes)) {
    const id = `ntf_${String(++max).padStart(12, '0')}`;
    coll[id] = { id, personId, area, title: n.title, body: n.body, at: store.now(), read: false };
  }
}

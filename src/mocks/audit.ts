import type { AuditEntry } from '@/contract/audit';
import { store } from './store';

/* Ids are a zero-padded counter, one past the highest already stored, so
   they sort in the order they were written even when the frozen clock gives
   many rows the same timestamp. Counting from the store, not a module
   variable, keeps them unique across a reload and across tabs (each tab
   re-reads the store before it handles a request). */
const ID = /^aud_(\d{12})$/;
export function nextAuditId(): string {
  let max = 0;
  for (const id of Object.keys(store.coll<AuditEntry>('audit'))) {
    const n = Number(ID.exec(id)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return `aud_${String(max + 1).padStart(12, '0')}`;
}
export function writeAudit(e: Omit<AuditEntry, 'id' | 'at'>): string {
  const id = nextAuditId();
  store.coll<AuditEntry>('audit')[id] = { id, at: store.now(), ...e };
  return id;
}

import type { AuditEntry } from '@/contract/audit';
import { store } from './store';

let seq = 0;
export function writeAudit(e: Omit<AuditEntry, 'id' | 'at'>): string {
  const id = `aud_${Date.now().toString(36)}${(seq++).toString(36)}`;
  store.coll<AuditEntry>('audit')[id] = { id, at: store.now(), ...e };
  return id;
}

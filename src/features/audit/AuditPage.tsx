import { tid } from '@/testids';

/* Filled in by Task 10. */
export function AuditPage() {
  return (
    <section data-testid={tid.page('iaudit')} className="mx-auto max-w-xl rounded-card border border-border bg-surface-card p-xl">
      <h1 className="text-[length:var(--qp-text-20)] font-semibold">Audit log</h1>
      <p className="text-text-secondary">This screen is filled in by a later task in this plan.</p>
    </section>);
}

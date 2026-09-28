import { toast } from 'sonner';
import { tid } from '@/testids';
import type { Refusal } from '@/contract/common';

/* A toast states the consequence and what to do next. `next` is not optional on a
   refusal, so a refusal can never be shown without it. */
export function toastInfo(message: string, next?: string) {
  toast.custom(() => (
    <div data-testid={tid.toast.info} role="status" className="rounded-card bg-surface-inverse p-md text-text-on-brand shadow-lg">
      <div>{message}</div>{next && <div data-testid={tid.toast.next} className="opacity-80">{next}</div>}
    </div>), { duration: 5000 });
}
export function toastRefusal(r: Pick<Refusal, 'message' | 'next'>) {
  toast.custom(() => (
    <div data-testid={tid.toast.error} role="alert" className="rounded-card bg-err p-md text-primary-foreground shadow-lg">
      <div>{r.message}</div><div data-testid={tid.toast.next} className="opacity-90">{r.next}</div>
    </div>), { duration: 8000 });
}

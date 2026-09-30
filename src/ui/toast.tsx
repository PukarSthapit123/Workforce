import { toast } from 'sonner';
import { tid } from '@/testids';
import type { Refusal } from '@/contract/common';

/* The prototype's .toast (qnipay-workforce-v15.html:632-640): the inverse
   surface with its pale ink, 11px 18px, radius 8, 14px, shadow-lg, as wide
   as its words and centred. An error is the error colour with white ink; in
   dark theme that colour is a light coral, so its ink turns dark to stay
   readable (the prototype kept white there, at about 2.3:1).

   A toast states the consequence and what to do next. `next` is not optional
   on a refusal, so a refusal can never be shown without it. */
const BOX = 'mx-auto w-fit max-w-full rounded-control px-[18px] py-[11px] text-sm shadow-lg';
export function toastInfo(message: string, next?: string) {
  toast.custom(() => (
    <div data-testid={tid.toast.info} role="status" className={`${BOX} bg-surface-inverse text-text-on-inverse`}>
      <div>{message}</div>{next && <div data-testid={tid.toast.next} className="opacity-80">{next}</div>}
    </div>), { duration: 5000 });
}
export function toastRefusal(r: Pick<Refusal, 'message' | 'next'>) {
  toast.custom(() => (
    <div data-testid={tid.toast.error} role="alert" className={`${BOX} bg-err text-text-on-brand dark:text-text-on-accent`}>
      <div>{r.message}</div><div data-testid={tid.toast.next} className="opacity-90">{r.next}</div>
    </div>), { duration: 8000 });
}

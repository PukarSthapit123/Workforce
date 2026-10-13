import type { VarianceTone } from '@/domain/hours';

/* .hp up, .hp dn and .hp ok (qnipay-workforce-v15.html:1526-1529): over in the
   warning ink, under in the information ink, level in the success ink. */
export const VARIANCE_CLASS: Record<VarianceTone, string> = { up: 'font-semibold text-warn', dn: 'font-semibold text-info', ok: 'font-semibold text-ok' };

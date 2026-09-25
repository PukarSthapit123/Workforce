import type { ReactNode } from 'react';
export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neu';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-surface text-ok', warn: 'bg-warn-surface text-warn', err: 'bg-err-surface text-err',
  info: 'bg-info-surface text-info', neu: 'bg-neu-surface text-neu' };
export function Pill({ testId, tone, children }: { testId: string; tone: Tone; children: ReactNode }) {
  return <span data-testid={testId} data-tone={tone}
    className={`inline-flex items-center gap-xs rounded-pill px-sm py-xs text-xs font-semibold ${TONE[tone]}`}>{children}</span>;
}

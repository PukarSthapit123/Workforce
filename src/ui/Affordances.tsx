import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/ui/shadcn/tooltip';
/* i: explains the thing beside it, one or two sentences, never over ~170 characters */
export function Tip({ testId, text }: { testId: string; text: string }) {
  if (import.meta.env.DEV && text.length > 170) console.warn(`Tip over 170 characters belongs behind ?: ${testId}`);
  return (
    <TooltipProvider delayDuration={200}><Tooltip>
      <TooltipTrigger asChild>
        <button type="button" data-testid={testId} aria-label="More information"
          className="inline-grid size-4 place-items-center rounded-pill border border-border text-[length:var(--qp-text-12)] text-text-secondary">i</button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip></TooltipProvider>);
}
/* ?: opens the guide for the page */
export function HelpButton({ testId, label, onOpen }: { testId: string; label: string; onOpen: () => void }) {
  return <button type="button" data-testid={testId} aria-label={label} onClick={onOpen}
    className="inline-grid size-7 place-items-center rounded-pill border border-border font-semibold">?</button>;
}
/* ⚠: a standing caution, always true of this area */
export function Caution({ testId, text }: { testId: string; text: string }) {
  return <span data-testid={testId} role="note" className="inline-flex items-center gap-xs text-warn">⚠ {text}</span>;
}

import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/ui/shadcn/tooltip';
/* i: explains the thing beside it, one or two sentences, never over ~170 characters.
   The trigger's own aria-label only ever says "More information": it names what
   the control is, not what it says. Radix only puts the tooltip's content in the
   accessibility tree while it is open (on hover or focus), so a screen reader
   user tabbing past it with no time to trigger that would hear a label and
   nothing else. A permanently present, visually hidden span carries the text
   itself, referenced by aria-describedby, so it is exposed regardless of
   whether the visual bubble is currently open. */
export function Tip({ testId, text }: { testId: string; text: string }) {
  if (import.meta.env.DEV && text.length > 170) console.warn(`Tip over 170 characters belongs behind ?: ${testId}`);
  const descId = `${testId}-text`;
  return (
    <TooltipProvider delayDuration={200}><Tooltip>
      <TooltipTrigger asChild>
        <button type="button" data-testid={testId} aria-label="More information" aria-describedby={descId}
          className="inline-grid size-4 place-items-center rounded-pill border border-border text-[length:var(--qp-text-12)] text-text-secondary">i</button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
      <span id={descId} className="sr-only">{text}</span>
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

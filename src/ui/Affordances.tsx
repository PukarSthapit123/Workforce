import { TriangleAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/ui/shadcn/tooltip';

/* The prototype sizes its three header affordances so a header reads
   consistently (qnipay-workforce-v15.html:10065-10073):
     ⚠  a caution that is always true of this area   (Caution, .warnbtn)
     ?  a guide you can open                          (HelpButton, .helpbtn)
     i  an inline explanation of the thing beside it  (Tip, .tip)
   Each keeps its drawn size and takes a phone's 44px tap on a transparent
   pseudo-element around it, never by growing. */

/* i: explains the thing beside it, one or two sentences, never over ~170 characters.
   The prototype's .tip (v15:553-557): 15px, a strong border, 12px/700 muted,
   filled brand on hover and focus. The trigger's own aria-label only ever says
   "More information": it names what the control is, not what it says. Radix
   only puts the tooltip's content in the accessibility tree while it is open
   (on hover or focus), so a screen reader user tabbing past it with no time
   to trigger that would hear a label and nothing else. A permanently present,
   visually hidden span carries the text itself, referenced by
   aria-describedby, so it is exposed regardless of whether the visual bubble
   is currently open. */
export function Tip({ testId, text }: { testId: string; text: string }) {
  if (import.meta.env.DEV && text.length > 170) console.warn(`Tip over 170 characters belongs behind ?: ${testId}`);
  const descId = `${testId}-text`;
  return (
    <TooltipProvider delayDuration={400}><Tooltip>
      <TooltipTrigger asChild>
        <button type="button" data-testid={testId} aria-label="More information" aria-describedby={descId}
          className="relative ml-[5px] inline-grid size-[15px] shrink-0 place-items-center rounded-full border border-border-strong align-[1px] text-xs leading-none font-bold tracking-normal text-text-muted normal-case transition-colors before:absolute before:-inset-[14.5px] hover:border-brand hover:bg-brand hover:text-text-on-brand focus-visible:border-brand focus-visible:bg-brand focus-visible:text-text-on-brand">i</button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
      <span id={descId} className="sr-only">{text}</span>
    </Tooltip></TooltipProvider>);
}
/* ?: opens the guide for the page. The prototype's .helpbtn (v15:651-660). */
export function HelpButton({ testId, label, onOpen }: { testId: string; label: string; onOpen: () => void }) {
  return <button type="button" data-testid={testId} aria-label={label} onClick={onOpen}
    className="relative inline-grid size-8 shrink-0 place-items-center rounded-full border bg-surface-card text-sm font-semibold text-text-muted transition-colors before:absolute before:-inset-[6px] hover:border-brand hover:bg-brand hover:text-text-on-brand">?</button>;
}
/* ⚠: a standing caution, always true of this area. The prototype's .warnbtn
   (v15:645-649): a 32px warning disc whose text shows on hover and focus. Not
   a button: it opens nothing. It is focusable so a keyboard can read it, and
   the text is also in the document, visually hidden, so a screen reader has
   it without opening anything. The sign comes from the shared icon set, not
   an emoji. */
export function Caution({ testId, text }: { testId: string; text: string }) {
  return (
    <TooltipProvider delayDuration={400}><Tooltip>
      <TooltipTrigger asChild>
        <span data-testid={testId} role="note" tabIndex={0}
          className="relative inline-grid size-8 shrink-0 cursor-help place-items-center rounded-full border border-warn bg-warn-surface text-warn before:absolute before:-inset-[6px]">
          <TriangleAlert aria-hidden="true" className="size-4" /><span className="sr-only">{text}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent aria-hidden="true">{text}</TooltipContent>
    </Tooltip></TooltipProvider>);
}

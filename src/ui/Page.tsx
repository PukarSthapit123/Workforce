import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tip } from './Affordances';

/* The page frame every routed screen sits in: the prototype's .page
   (qnipay-workforce-v15.html:388-389, 1524-1525), at most 1360px wide and
   centred, 24px all round, 16px 12px below 1024px. A page never adds outer
   padding or a max width of its own; `narrow` is the prototype's
   .page.narrow, 520px, for a single form or statement. */
export function Page({ testId, narrow, className, children }: { testId: string; narrow?: boolean; className?: string; children: ReactNode }) {
  return (
    <section data-testid={testId}
      className={cn('mx-auto w-full p-xl max-lg:px-md max-lg:py-lg', narrow ? 'max-w-[520px]' : 'max-w-[1360px]', className)}>
      {children}
    </section>);
}

/* The page head: the prototype's aHead (v15:7963-7975, .crumb and .pagehead
   at 364 and 394-395). A crumb in 12px muted ink naming the route, "Area ·
   Page", 5px above; the title at 24px/600 with an optional `i` tip beside it;
   the page's actions on the right, 8px apart; 16px under the whole head.
   There is no lede paragraph: what would have been one goes in the tip
   (170 characters at most) or behind `?`. The crumb is left out where it
   would only repeat the title. */
export function PageHead({ title, crumb, tip, tipTestId, actions }: {
  title: string; crumb?: string; tip?: string; tipTestId?: string; actions?: ReactNode;
}) {
  return (
    <>
      {crumb && <div className="mb-[5px] text-xs text-text-muted">{crumb}</div>}
      <div className="mb-lg flex flex-wrap items-start gap-md max-md:gap-y-[10px]">
        <div><h1>{title}{tip && tipTestId && <Tip testId={tipTestId} text={tip} />}</h1></div>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-sm">{actions}</div>}
      </div>
    </>);
}

/* A titled section inside a page: the prototype's h2 (v15:241), 18px/600,
   24px above and 12px below. */
export function SectionHead({ title, tip, tipTestId }: { title: string; tip?: string; tipTestId?: string }) {
  return <h2 className="mt-xl mb-md">{title}{tip && tipTestId && <Tip testId={tipTestId} text={tip} />}</h2>;
}

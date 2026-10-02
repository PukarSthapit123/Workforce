import { useState } from 'react';
import { tid } from '@/testids';
import { Button } from './Button';
import { HelpButton } from './Affordances';
import { Modal } from './Modal';
import { GUIDES } from './guides';

/* The page `?`: the prototype's guideBtn and guideModal (qnipay-workforce-v15.html:
   10061-10079). It opens the view's guide in a modal, one titled section after
   another (.gsec: a 14px/650 heading over 14px secondary text at 1.6, 16px
   between sections), closed by one primary button. A view with no guide gets
   no `?` at all, never a hollow one. */
export function GuideButton({ view }: { view: string }) {
  const [open, setOpen] = useState(false);
  const g = GUIDES[view];
  if (!g) return null;
  return (
    <>
      <HelpButton testId={tid.guide.open(view)} label={g.label} onOpen={() => setOpen(true)} />
      <Modal open={open} onOpenChange={setOpen} title={g.title}
        footer={<Button testId={tid.guide.close} kind="primary" onClick={() => setOpen(false)}>Close</Button>}>
        {g.sections.map(([h, b]) => (
          <section key={h} className="mb-lg last:mb-0">
            <h4 className="mb-xs text-sm font-[650] tracking-normal">{h}</h4>
            <p className="text-sm leading-[1.6] text-text-secondary">{b}</p>
          </section>))}
      </Modal>
    </>);
}

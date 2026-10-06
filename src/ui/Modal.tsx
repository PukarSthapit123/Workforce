import type { ReactNode } from 'react';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, type DialogWidth } from '@/ui/shadcn/dialog';
import { tid } from '@/testids';
import { Button } from './Button';
import { ScopeBadge } from './Pill';

/* The prototype's .modal: .mh (title, close), .mb (the description, then the
   content) and .mf (the buttons, primary last). Radix traps focus and returns
   it on close, which the prototype never did. Without a description Radix
   is told so explicitly, rather than warning that one is missing. A scope
   (the .mh .scope badge, such as whose document is being checked) sits
   between the title and the close button. */
export function Modal({ open, onOpenChange, title, scope, description, children, footer, width }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; scope?: string; description?: string; children?: ReactNode; footer?: ReactNode;
  width?: DialogWidth;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={tid.modal.root} width={width} {...(description ? {} : { 'aria-describedby': undefined })}>
        <DialogHeader closeTestId={tid.modal.close}><DialogTitle data-testid={tid.modal.title}>{title}</DialogTitle>{scope && <span className="shrink-0"><ScopeBadge>{scope}</ScopeBadge></span>}</DialogHeader>
        {(description || children) && <DialogBody>
          {description && <DialogDescription className={children ? 'mb-lg text-sm text-text-secondary' : 'text-sm text-text-secondary'}>{description}</DialogDescription>}
          {children}
        </DialogBody>}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>);
}
export function ConfirmModal({ open, onOpenChange, title, body, confirmLabel, cancelLabel = 'Keep it as it is', danger, busy, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; confirmLabel: string;
  cancelLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void;
}) {
  return <Modal open={open} onOpenChange={onOpenChange} title={title} description={body} footer={<>
    <Button testId={tid.modal.cancel} kind="ghost" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
    <Button testId={tid.modal.confirm} kind={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
  </>} />;
}

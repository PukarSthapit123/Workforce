import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/ui/shadcn/dialog';
import { tid } from '@/testids';
import { Button } from './Button';

/* Radix traps focus and returns it on close, which the prototype never did. */
export function Modal({ open, onOpenChange, title, description, children, footer }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={tid.modal.root}>
        <DialogHeader><DialogTitle data-testid={tid.modal.title}>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        {children}
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

"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

/* The prototype's modal (qnipay-workforce-v15.html:572-626):

   - .scrim: the brand-tinted scrim at z 100, the dialog above it at 110,
     both clear of the phone's bottom bar (80).
   - .modal: min(620px, 100vw - 32px) wide (900 wide, 1160 extra wide),
     radius 16, shadow-lg, at most 88vh tall and scrolling inside itself.
   - .mh / .mb / .mf: a header with a border under it and a 30px close
     button, a 24px body, a footer with a border over it and its buttons on
     the right. Header and footer stay put while the body scrolls.
   - Below 768px it is a sheet from the bottom: full width, top corners
     rounded, at most 92dvh, the footer clear of the home indicator. */

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-[100] bg-scrim", className)}
      {...props}
    />
  )
}

const WIDTH = {
  normal: "md:w-[min(620px,calc(100vw-32px))]",
  wide: "md:w-[min(900px,calc(100vw-32px))]",
  xwide: "md:w-[min(1160px,calc(100vw-32px))]",
} as const
export type DialogWidth = keyof typeof WIDTH

function DialogContent({
  className,
  children,
  width = "normal",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { width?: DialogWidth }) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed z-[110] block overflow-auto bg-surface-card text-text-primary shadow-lg outline-none",
          "md:top-1/2 md:left-1/2 md:max-h-[88vh] md:-translate-1/2 md:rounded-overlay",
          "max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[92dvh] max-md:w-full max-md:rounded-t-overlay",
          WIDTH[width],
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/* .mh: 16px 24px, a rule under it, sticky at the top of the scroller */
function DialogHeader({ className, children, closeTestId, ...props }: React.ComponentProps<"div"> & {
  /* the close button's test id; the header has no close button without one */
  closeTestId?: string
}) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "sticky top-0 z-[2] flex items-center gap-md rounded-t-overlay border-b bg-surface-card px-xl py-lg",
        className
      )}
      {...props}
    >
      {children}
      {closeTestId && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          data-testid={closeTestId}
          className="relative grid size-[30px] shrink-0 place-items-center rounded-sm text-text-muted transition-colors hover:bg-surface-tint before:absolute before:-inset-[7px] [&_svg]:size-4"
        >
          <XIcon aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

/* .mb: 24px all round */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-body" className={cn("p-xl", className)} {...props} />
}

/* .mf: a rule over it, buttons on the right, sticky at the foot. On a phone
   the buttons share the row and the footer clears the home indicator. */
function DialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "sticky bottom-0 flex flex-wrap justify-end gap-sm border-t bg-surface-card px-xl py-lg",
        "max-md:pb-[calc(var(--qp-space-lg)+env(safe-area-inset-bottom,0px))] max-md:[&>*]:min-w-[132px] max-md:[&>*]:flex-auto",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("flex-1 text-left text-base font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-xs text-text-muted", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

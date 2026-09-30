import * as React from "react"
import { cn } from "@/lib/utils"
import { fieldControl } from "./input"

/* The prototype's .fld textarea (qnipay-workforce-v15.html:500): the input's
   look, auto height, 9px 11px, line-height 1.5, resizable vertically. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldControl, "field-sizing-content h-auto min-h-16 resize-y py-[9px] leading-normal", className)}
      {...props}
    />
  )
}

export { Textarea }

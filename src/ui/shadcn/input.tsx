import * as React from "react"
import { cn } from "@/lib/utils"

/* The prototype's .fld input (qnipay-workforce-v15.html:497-508, 944-946):
   38px, 0 11px, a strong border on the sunken surface, radius 8, 14px. Focus
   rings it and draws the border in brand; an invalid field is outlined in
   error. On a phone it is 44px and 16px, so iOS does not zoom the page. */
export const fieldControl =
  "h-[38px] w-full min-w-0 rounded-control border border-border-strong bg-surface-sunken px-[11px] text-sm text-text-primary transition-[border-color,box-shadow] outline-none placeholder:text-text-muted focus:border-brand focus:shadow-focus disabled:cursor-default disabled:bg-surface-tint disabled:text-text-secondary aria-invalid:border-err aria-invalid:shadow-invalid max-md:min-h-touch max-md:text-base"

/* The prototype's filter-bar controls (.srch input, select.flt, .chipbtn;
   v15:538-549): 32px pills on the card surface with a strong border. On a
   phone they take the same 44px/16px floor as every other control. */
export const filterControl =
  "h-8 rounded-pill border border-border-strong bg-surface-card text-text-primary outline-none focus:shadow-focus max-md:min-h-touch max-md:text-base"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldControl, className)}
      {...props}
    />
  )
}

export { Input }

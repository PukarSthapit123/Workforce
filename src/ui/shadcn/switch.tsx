"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

/* The prototype's .tog (qnipay-workforce-v15.html:522-529, 941-943): a
   40x23 track with an 18px knob, strong grey off, brand on (the accent in
   dark). A switch is a drawn object, so it never stretches to the touch
   target: a transparent 44px square around it takes the tap instead. */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-[23px] w-10 shrink-0 items-center rounded-pill transition-[background-color] duration-(--qp-duration-fast) ease-qp outline-none before:absolute before:top-1/2 before:left-1/2 before:size-11 before:-translate-1/2 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-brand data-[state=unchecked]:bg-border-strong dark:data-[state=checked]:bg-brand-accent",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[18px] translate-x-[2.5px] rounded-full bg-text-on-brand shadow-sm transition-transform duration-(--qp-duration-fast) ease-qp data-[state=checked]:translate-x-[19.5px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

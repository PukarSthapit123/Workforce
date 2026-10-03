import * as React from "react"
import { cn } from "@/lib/utils"

/* The prototype's table layer (qnipay-workforce-v15.html:474-487, 887-947).

   - plain: .tw + table. The wrapper is the bordered, radius-12 card that
     scrolls; th is 12px/700 capitals at .04em in muted ink; td is 10px 12px
     at the density text size; even body rows sit on the sunken surface.
   - matrix: a table read by comparing rows (the permissions matrix). On a
     phone it keeps scrolling sideways, at least 560px wide, with its first
     column pinned so each row stays identifiable.
   - plain and matrix on a phone: the .tw scroll shades (scroll-shade in
     src/index.css) mark the edge that has more to show.
   - records: table.rec. On a phone each row becomes a card: the header row
     is kept for screen readers only, every cell is labelled from `label`
     (uppercase 12px in a 42% column), the `title` cell heads the card and
     the `foot` cell sits under a rule at its foot.

   The variant travels by context, so a page chooses it once on <Table> and
   every row and cell under it picks up its own phone rules. */
type Variant = "plain" | "matrix" | "records"
const VariantContext = React.createContext<Variant>("plain")

/* dense: table.dense (v15:478), 7px 9px cells for a long list of records */
function Table({ className, variant = "plain", dense, ...props }: React.ComponentProps<"table"> & { variant?: Variant; dense?: boolean }) {
  return (
    <VariantContext.Provider value={variant}>
      <div
        data-slot="table-container"
        className={cn(
          "relative mb-md w-full overflow-auto rounded-card border bg-surface-card",
          variant === "records" ? "max-md:overflow-visible max-md:border-0 max-md:bg-transparent" : "max-md:scroll-shade"
        )}
      >
        <table
          data-slot="table"
          data-variant={variant}
          className={cn(
            "w-full border-collapse text-sm",
            variant === "matrix" && "max-md:min-w-[560px]",
            variant === "records" && "max-md:block",
            dense && "md:[&_td]:px-[9px] md:[&_td]:py-[7px] md:[&_th]:px-[9px] md:[&_th]:py-[7px]",
            className
          )}
          {...props}
        />
      </div>
    </VariantContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  const variant = React.useContext(VariantContext)
  return (
    <thead
      data-slot="table-header"
      className={cn(variant === "records" && "max-md:sr-only", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  const variant = React.useContext(VariantContext)
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "[&>tr:last-child>td]:border-b-0",
        variant === "records"
          ? "max-md:block md:[&>tr:nth-child(even)]:bg-surface-sunken"
          : "[&>tr:nth-child(even)]:bg-surface-sunken",
        className
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  const variant = React.useContext(VariantContext)
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-surface-tint font-semibold", variant === "records" && "max-md:hidden", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const variant = React.useContext(VariantContext)
  return (
    <tr
      data-slot="table-row"
      className={cn(
        variant === "records" &&
          "max-md:mb-sm max-md:block max-md:rounded-control max-md:border max-md:bg-surface-card max-md:px-md max-md:py-sm max-md:last:mb-0",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  const variant = React.useContext(VariantContext)
  return (
    <th
      data-slot="table-head"
      className={cn(
        "border-b bg-surface-card px-md py-[10px] text-left align-middle text-xs font-bold tracking-[.04em] whitespace-nowrap text-text-muted uppercase",
        variant === "matrix" && "max-md:first:sticky max-md:first:left-0 max-md:first:z-[2]",
        className
      )}
      {...props}
    />
  )
}

const RECORD_CELL =
  "max-md:flex max-md:min-w-0 max-md:items-baseline max-md:gap-sm max-md:border-0 max-md:px-0 max-md:py-[3px] max-md:text-left max-md:data-[empty]:hidden"
const RECORD_LABEL =
  "max-md:before:shrink-0 max-md:before:basis-[42%] max-md:before:text-xs max-md:before:font-[650] max-md:before:tracking-[.03em] max-md:before:text-text-muted max-md:before:uppercase max-md:before:content-[attr(data-l)]"
const RECORD_KIND = {
  /* the record's name: full width, no label, heavier, a rule under it */
  title: "max-md:mb-xs max-md:block max-md:border-b max-md:pb-sm max-md:font-[650]",
  /* actions or a closing note: a rule above, no label */
  foot: "max-md:mt-xs max-md:flex-wrap max-md:border-t max-md:pt-sm",
} as const

function TableCell({ className, label, kind, empty, ...props }: React.ComponentProps<"td"> & {
  /* records only: the label a phone card shows beside this value */
  label?: string
  kind?: keyof typeof RECORD_KIND
  /* records only: a cell with no value adds nothing to a phone card */
  empty?: boolean
}) {
  const variant = React.useContext(VariantContext)
  return (
    <td
      data-slot="table-cell"
      data-l={variant === "records" && !kind ? label : undefined}
      data-empty={variant === "records" && empty ? "" : undefined}
      className={cn(
        "border-b px-md py-[10px] align-middle text-[length:var(--qp-density-text)]",
        variant === "matrix" && "max-md:first:sticky max-md:first:left-0 max-md:first:z-[1] max-md:first:bg-surface-card",
        variant === "records" && RECORD_CELL,
        variant === "records" && (kind ? RECORD_KIND[kind] : label && RECORD_LABEL),
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-md text-xs text-text-muted", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

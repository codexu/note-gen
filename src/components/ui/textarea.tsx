import * as React from "react"

import { cn } from "@/lib/utils"

type TextareaProps = React.ComponentProps<"textarea"> & {
  maxRows?: number
}

function Textarea({ className, maxRows, style, ...props }: TextareaProps) {
  const maxHeight = maxRows && maxRows > 0
    ? `calc(${Math.floor(maxRows)}lh + 1rem + 2px)`
    : undefined

  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full overflow-y-auto rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      style={maxHeight ? { maxHeight, ...style } : style}
      {...props}
    />
  )
}

export { Textarea, type TextareaProps }

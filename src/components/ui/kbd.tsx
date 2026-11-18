import { cn } from "@/lib/utils"

// Fork（almanac P0-c）：v5 的 kbd——bg-sunken、高 18px、圓角 4px、10.5px、等寬字。
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none v3:h-[18px] v3:min-w-[18px] v3:gap-0.5 v3:rounded-[4px] v3:bg-sunken v3:px-[5px] v3:font-mono v3:text-[10.5px] v3:leading-[18px] in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3 v3:[&_svg:not([class*='size-'])]:size-[11px]",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }

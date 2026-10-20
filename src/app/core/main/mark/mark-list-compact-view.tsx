'use client'

import type { Mark } from "@/db/marks"
import { cn } from "@/lib/utils"
import { MarkItem } from "./mark-item"

export function MarkListCompactView({ marks, grouped = false }: { marks: Mark[], grouped?: boolean }) {
  return (
    <div className={cn(
      "flex w-full min-w-0 max-w-full flex-col divide-y divide-border/60 overflow-hidden",
      grouped ? "px-1.5 py-1" : "py-1"
    )}>
      {marks.map((mark) => (
        <MarkItem key={mark.id} mark={mark} variant="compact" grouped={grouped} />
      ))}
    </div>
  )
}

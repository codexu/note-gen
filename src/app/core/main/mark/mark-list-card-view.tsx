'use client'

import type { Mark } from "@/db/marks"
import { cn } from "@/lib/utils"
import { MarkItem } from "./mark-item"

export function MarkListCardView({ marks, grouped = false }: { marks: Mark[], grouped?: boolean }) {
  return (
    <div
      className={cn(
        "w-full min-w-0 max-w-full columns-auto gap-3 overflow-hidden",
        grouped ? "px-2 py-2" : "px-3 py-3"
      )}
      style={{ columnWidth: '15rem' }}
    >
      {marks.map((mark) => (
        <div key={mark.id} className={cn(
          "min-w-0 max-w-full break-inside-avoid overflow-hidden",
          grouped ? "mb-2" : "mb-3"
        )}>
          <MarkItem mark={mark} variant="cards" grouped={grouped} />
        </div>
      ))}
    </div>
  )
}

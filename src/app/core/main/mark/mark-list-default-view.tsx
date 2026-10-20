'use client'

import type { Mark } from "@/db/marks"
import { MarkItem } from "./mark-item"
import { cn } from "@/lib/utils"

export function MarkListDefaultView({ marks, withTopBorder = true }: { marks: Mark[]; withTopBorder?: boolean }) {
  return (
    <div className={cn("w-full min-w-0 max-w-full", withTopBorder && "border-t border-border/60")}>
      {marks.map((mark) => (
        <MarkItem key={mark.id} mark={mark} variant="list" />
      ))}
    </div>
  )
}

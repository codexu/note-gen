'use client'

import type { Mark } from "@/db/marks"
import { MarkItem } from "./mark-item"

export function MarkListCompactView({ marks }: { marks: Mark[] }) {
  return (
    <div className="space-y-1.5 px-2 py-2">
      {marks.map((mark) => (
        <MarkItem key={mark.id} mark={mark} variant="compact" />
      ))}
    </div>
  )
}

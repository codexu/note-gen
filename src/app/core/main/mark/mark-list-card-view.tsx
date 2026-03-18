'use client'

import type { Mark } from "@/db/marks"
import { MarkItem } from "./mark-item"

export function MarkListCardView({ marks }: { marks: Mark[] }) {
  return (
    <div className="columns-1 gap-3 px-3 py-3 sm:columns-2 xl:columns-3 2xl:columns-4">
      {marks.map((mark) => (
        <div key={mark.id} className="mb-3 break-inside-avoid">
          <MarkItem mark={mark} variant="cards" />
        </div>
      ))}
    </div>
  )
}

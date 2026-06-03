'use client'

import type { Mark } from "@/db/marks"
import { MarkItem } from "./mark-item"

export function MarkListCardView({ marks }: { marks: Mark[] }) {
  return (
    <div
      className="w-full min-w-0 max-w-full columns-auto gap-3 overflow-hidden px-3 py-3"
      style={{ columnWidth: '15rem' }}
    >
      {marks.map((mark) => (
        <div key={mark.id} className="mb-3 min-w-0 max-w-full break-inside-avoid overflow-hidden">
          <MarkItem mark={mark} variant="cards" />
        </div>
      ))}
    </div>
  )
}

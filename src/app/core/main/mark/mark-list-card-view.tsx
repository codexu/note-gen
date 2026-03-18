'use client'

import type { Mark } from "@/db/marks"
import { MarkItem } from "./mark-item"

export function MarkListCardView({ marks }: { marks: Mark[] }) {
  return (
    <div
      className="columns-auto gap-3 px-3 py-3"
      style={{ columnWidth: '15rem' }}
    >
      {marks.map((mark) => (
        <div key={mark.id} className="mb-3 break-inside-avoid">
          <MarkItem mark={mark} variant="cards" />
        </div>
      ))}
    </div>
  )
}

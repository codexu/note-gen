'use client'

import type { Mark } from "@/db/marks"
import { MarkItem } from "./mark-item"

export function MarkListDefaultView({ marks }: { marks: Mark[] }) {
  return (
    <div className="w-full min-w-0 max-w-full border-t border-border/60">
      {marks.map((mark) => (
        <MarkItem key={mark.id} mark={mark} variant="list" />
      ))}
    </div>
  )
}

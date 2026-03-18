'use client'

import { useState } from "react"
import type { Mark } from "@/db/marks"
import { cn } from "@/lib/utils"
import { TodoEditDialog } from "./todo-edit-dialog"

type TodoEditTriggerProps = {
  mark: Mark
  className?: string
  children: React.ReactNode
}

export function TodoEditTrigger({ mark, className, children }: TodoEditTriggerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("min-w-0 text-left", className)}
      >
        {children}
      </button>
      <TodoEditDialog mark={mark} open={open} onOpenChange={setOpen} />
    </>
  )
}

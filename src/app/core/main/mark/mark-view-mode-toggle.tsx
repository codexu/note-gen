'use client'

import { LayoutGrid, Rows3, StretchHorizontal } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { RecordViewMode } from "@/stores/mark"
import { cn } from "@/lib/utils"

type MarkViewModeToggleProps = {
  value: RecordViewMode
  onChange: (mode: RecordViewMode) => void
}

const VIEW_MODE_ITEMS: Array<{
  mode: RecordViewMode
  icon: typeof Rows3
}> = [
  { mode: 'list', icon: Rows3 },
  { mode: 'compact', icon: StretchHorizontal },
  { mode: 'cards', icon: LayoutGrid },
]

export function MarkViewModeToggle({ value, onChange }: MarkViewModeToggleProps) {
  const t = useTranslations('record.mark.toolbar.view')

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/70 bg-muted/30 p-0.5">
      {VIEW_MODE_ITEMS.map(({ mode, icon: Icon }) => {
        const active = value === mode

        return (
          <Button
            key={mode}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(mode)}
            className={cn(
              "h-6 w-6 rounded-sm p-0 text-muted-foreground shadow-none",
              active && "bg-background text-foreground shadow-sm"
            )}
            title={t(mode)}
            aria-label={t(mode)}
          >
            <Icon className="size-3.5" />
          </Button>
        )
      })}
    </div>
  )
}

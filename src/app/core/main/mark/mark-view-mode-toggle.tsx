'use client'

import { LayoutGrid, Rows3, StretchHorizontal } from "lucide-react"
import { useTranslations } from "next-intl"
import type { RecordViewMode } from "@/stores/mark"
import { cn } from "@/lib/utils"
import { BottomBarIconButton } from "@/components/bottom-bar-icon-button"

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
    <div className="flex items-center gap-1">
      {VIEW_MODE_ITEMS.map(({ mode, icon: Icon }) => (
        <BottomBarIconButton
          key={mode}
          icon={<Icon className="size-3" />}
          label={t(mode)}
          onClick={() => onChange(mode)}
          active={value === mode}
          className={cn(value === mode && "text-foreground")}
        />
      ))}
    </div>
  )
}

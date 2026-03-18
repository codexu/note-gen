'use client'

import { ListChecks, SquareCheckBig, XCircle } from "lucide-react";
import { useTranslations } from 'next-intl';
import useMarkStore from "@/stores/mark";
import { MarkViewModeToggle } from "./mark-view-mode-toggle";
import { BottomBarIconButton } from "@/components/bottom-bar-icon-button";

export function MarkToolbar() {
  const { 
    marks, 
    visibleMarkIds,
    isMultiSelectMode, 
    setMultiSelectMode, 
    selectedMarkIds, 
    setSelectedMarkIds,
    selectAll, 
    clearSelection,
    recordViewMode,
    setRecordViewMode,
  } = useMarkStore()
  const t = useTranslations('record.mark.toolbar')

  const handleToggleMultiSelect = () => {
    setMultiSelectMode(!isMultiSelectMode)
  }

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedMarkIds(new Set())
    } else {
      selectAll()
    }
  }

  const visibleCount = visibleMarkIds.length > 0 ? visibleMarkIds.length : marks.length
  const isAllSelected = visibleCount > 0 && selectedMarkIds.size === visibleCount

  if (marks.length === 0) {
    return null
  }

  return (
    <div className="flex h-6 items-center justify-between overflow-hidden border-t border-border bg-background px-2 text-xs text-muted-foreground">
      <div className="min-w-0">
        {isMultiSelectMode ? (
          <span className="text-xs text-muted-foreground">
            {t('selectedCount', { count: selectedMarkIds.size })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('visibleCount', { count: visibleCount })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {isMultiSelectMode ? (
          <>
            <BottomBarIconButton
              icon={<ListChecks className="size-3" />}
              label={isAllSelected ? t('deselectAll') : t('selectAll')}
              onClick={handleSelectAll}
            />
            <BottomBarIconButton
              icon={<XCircle className="size-3" />}
              label={t('exitMultiSelect')}
              onClick={clearSelection}
            />
          </>
        ) : (
          <>
            <MarkViewModeToggle value={recordViewMode} onChange={setRecordViewMode} />
            <BottomBarIconButton
              icon={<SquareCheckBig className="size-3" />}
              label={t('multiSelect')}
              onClick={handleToggleMultiSelect}
            />
          </>
        )}
      </div>
    </div>
  )
}

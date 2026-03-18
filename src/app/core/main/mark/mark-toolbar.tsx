'use client'

import { Button } from "@/components/ui/button";
import { ListChecks, SquareCheckBig, XCircle } from "lucide-react";
import { useTranslations } from 'next-intl';
import useMarkStore from "@/stores/mark";
import { useEffect } from "react";
import { MarkViewModeToggle } from "./mark-view-mode-toggle";

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
    initRecordViewMode,
  } = useMarkStore()
  const t = useTranslations('record.mark.toolbar')

  useEffect(() => {
    initRecordViewMode()
  }, [initRecordViewMode])

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
    <div className="flex h-8 items-center justify-between overflow-hidden border-t bg-background px-2">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              className="size-6"
              title={isAllSelected ? t('deselectAll') : t('selectAll')}
            >
              <ListChecks className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="size-6"
              title={t('exitMultiSelect')}
            >
              <XCircle className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <MarkViewModeToggle value={recordViewMode} onChange={setRecordViewMode} />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleMultiSelect}
              className="size-6"
              title={t('multiSelect')}
            >
              <SquareCheckBig className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

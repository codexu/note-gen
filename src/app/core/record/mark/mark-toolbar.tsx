'use client'

import { Button } from "@/components/ui/button";
import { ListChecks, LayoutList, ListTodo, ListRestart } from "lucide-react";
import { useTranslations } from 'next-intl';
import useMarkStore from "@/stores/mark";

export function MarkToolbar() {
  const { 
    marks, 
    isMultiSelectMode, 
    setMultiSelectMode, 
    selectedMarkIds, 
    selectAll, 
    clearSelection 
  } = useMarkStore()
  const t = useTranslations('record.mark.toolbar')

  const handleToggleMultiSelect = () => {
    setMultiSelectMode(!isMultiSelectMode)
  }

  const handleSelectAll = () => {
    if (isAllSelected) {
      clearSelection()
    } else {
      selectAll()
    }
  }

  const isAllSelected = marks.length > 0 && selectedMarkIds.size === marks.length

  if (marks.length === 0) {
    return null
  }

  return (
    <div className="border-t bg-background px-2 h-6 overflow-hidden flex items-center justify-between">
      <div>
        {isMultiSelectMode && selectedMarkIds.size > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('selectedCount', { count: selectedMarkIds.size })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {isMultiSelectMode && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectAll}
            className="size-6"
            title={isAllSelected ? t('deselectAll') : t('selectAll')}
          >
            {isAllSelected ? (
              <LayoutList className="size-4" />
            ) : (
              <ListChecks className="size-4" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleMultiSelect}
          className="size-6"
          title={isMultiSelectMode ? t('exitMultiSelect') : t('multiSelect')}
        >
          {isMultiSelectMode ? (
            <ListRestart className="size-4" />
          ) : (
            <ListTodo className="size-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

'use client'

import React from "react"
import { useTranslations } from "next-intl";
import type { Mark } from "@/db/marks";
import { MarkItem } from "./mark-item";
import useMarkStore from "@/stores/mark";
import { MarkLoading } from "./mark-loading";
import MarkEmpty from "./mark-empty";
import { filterMarks } from "./mark-filters.mjs";

export const MarkList = React.memo(function MarkList() {
  const t = useTranslations('record.mark.list')
  const {
    marks,
    queues,
    recordFilters,
    hasActiveRecordFilters,
    setVisibleMarkIds,
  } = useMarkStore()

  const filteredMarks = React.useMemo(() => (
    filterMarks(marks, recordFilters)
  ), [marks, recordFilters])

  const activeFilterText = React.useMemo(() => {
    const parts: string[] = []
    if (recordFilters.search.trim()) {
      parts.push(`"${recordFilters.search.trim()}"`)
    }
    if (recordFilters.selectedTypes.length > 0) {
      parts.push(t('filteredByType', { count: recordFilters.selectedTypes.length }))
    }
    if (recordFilters.timePreset !== 'all') {
      parts.push(t(`time.${recordFilters.timePreset}`))
    }
    if (recordFilters.tagId !== 'all') {
      parts.push(t('filteredByTag'))
    }
    return parts.join(' · ')
  }, [recordFilters, t])

  React.useEffect(() => {
    setVisibleMarkIds(filteredMarks.map((mark: Mark) => mark.id))
    return () => setVisibleMarkIds([])
  }, [filteredMarks, setVisibleMarkIds])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-0">
        <div>
          {hasActiveRecordFilters() ? (
            <div className="border-b bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
              {t('filteredSummary', { count: filteredMarks.length, filters: activeFilterText || t('filtered') })}
            </div>
          ) : null}
          {
            queues.map(mark => {
              return (
                <MarkLoading key={mark.queueId} mark={mark} />
              )
            })
          }
          {
            filteredMarks.length ? (
              filteredMarks.map((mark: Mark) => (
                <MarkItem key={mark.id} mark={mark} />
              ))
            ) : hasActiveRecordFilters() ? (
              <div className="flex flex-col justify-center items-center flex-1 w-full pt-32 text-center">
                <p className="text-sm text-zinc-500">{t('emptyFiltered')}</p>
                <p className="mt-1 text-xs text-zinc-400">{t('emptyFilteredHint')}</p>
              </div>
            ) : <MarkEmpty />
          }
        </div>
      </div>
    </div>
  )
})

'use client'

import React from "react"
import { useTranslations } from "next-intl";
import type { Mark } from "@/db/marks";
import { Badge } from "@/components/ui/badge";
import useMarkStore from "@/stores/mark";
import { MarkLoading } from "./mark-loading";
import MarkEmpty from "./mark-empty";
import { buildRecordFilterSummary, filterMarks } from "./mark-filters.mjs";
import { MarkListDefaultView } from "./mark-list-default-view";
import { MarkListCompactView } from "./mark-list-compact-view";
import { MarkListCardView } from "./mark-list-card-view";

export const MarkList = React.memo(function MarkList() {
  const t = useTranslations('record.mark.list')
  const {
    marks,
    queues,
    recordFilters,
    recordViewMode,
    hasActiveRecordFilters,
    setVisibleMarkIds,
  } = useMarkStore()

  const filteredMarks = React.useMemo(() => (
    filterMarks(marks, recordFilters)
  ), [marks, recordFilters])

  const filterSummary = React.useMemo(() => buildRecordFilterSummary(recordFilters), [recordFilters])

  React.useEffect(() => {
    setVisibleMarkIds(filteredMarks.map((mark: Mark) => mark.id))
    return () => setVisibleMarkIds([])
  }, [filteredMarks, setVisibleMarkIds])

  const view = (() => {
    switch (recordViewMode) {
    case 'compact':
      return <MarkListCompactView marks={filteredMarks} />
    case 'cards':
      return <MarkListCardView marks={filteredMarks} />
    case 'list':
    default:
      return <MarkListDefaultView marks={filteredMarks} />
    }
  })()

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-0">
        <div>
          {hasActiveRecordFilters() ? (
            <div className="border-b bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">
                  {t('filteredLabel', { count: filteredMarks.length })}
                </Badge>
                {filterSummary.search ? (
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px] font-normal">
                    {t('searchChip', { value: filterSummary.search })}
                  </Badge>
                ) : null}
                {filterSummary.timePreset !== 'all' ? (
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px] font-normal">
                    {t(`time.${filterSummary.timePreset}`)}
                  </Badge>
                ) : null}
                {filterSummary.typeCount > 0 ? (
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px] font-normal">
                    {t('filteredByType', { count: filterSummary.typeCount })}
                  </Badge>
                ) : null}
                {filterSummary.hasTag ? (
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px] font-normal">
                    {t('filteredByTag')}
                  </Badge>
                ) : null}
              </div>
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
              view
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

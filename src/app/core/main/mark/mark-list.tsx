'use client'

import { PluginEmbeddedViews } from '@/components/plugins/plugin-embedded-views'
import React from "react"
import { useTranslations } from "next-intl";
import type { Mark } from "@/db/marks";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import useMarkStore from "@/stores/mark";
import useTagStore from '@/stores/tag'
import useSettingStore from "@/stores/setting";
import { MarkLoading } from "./mark-loading";
import MarkEmpty from "./mark-empty";
import { buildRecordFilterSummary, filterMarks, getTrashRecordFilters, sortMarks } from "./mark-filters";
import { MarkListDefaultView } from "./mark-list-default-view";
import { MarkListCompactView } from "./mark-list-compact-view";
import { MarkListCardView } from "./mark-list-card-view";
import { PhotoPreviewProvider } from "@/components/photo-preview-provider";

export const MarkList = React.memo(function MarkList({ records, queueTagIds }: { records?: Mark[]; queueTagIds?: number[] } = {}) {
  const t = useTranslations('record.mark.list')
  const {
    marks,
    queues,
    trashState,
    recordFilters,
    setVisibleMarkIds,
  } = useMarkStore()
  const { recordViewMode, recordSortMode } = useSettingStore()
  const tags = useTagStore(state => state.tags)

  const effectiveFilters = React.useMemo(() => (
    trashState ? getTrashRecordFilters() : recordFilters
  ), [trashState, recordFilters])

  const listFilters = React.useMemo(() => records ? {
    ...effectiveFilters,
    tagId: 'all' as const,
    tagRules: { include: [], exclude: [], match: 'all' as const },
  } : effectiveFilters, [effectiveFilters, records])

  const filteredMarks = React.useMemo(() => (
    sortMarks(filterMarks(records ?? marks, listFilters, tags), recordSortMode)
  ), [records, marks, listFilters, recordSortMode, tags])

  // The tag navigator already labels the selected scope; only show additional filters here.
  const filterSummary = React.useMemo(() => buildRecordFilterSummary(listFilters), [listFilters])

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
      return <MarkListDefaultView marks={filteredMarks} withTopBorder={!records} />
    }
  })()

  return (
    <PhotoPreviewProvider>
      <PluginEmbeddedViews location="record-list" active={!trashState} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-0">
          <div>
            {!trashState && filterSummary.hasFilters ? (
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
                </div>
              </div>
            ) : null}
            {
              queues.filter(mark => !queueTagIds || queueTagIds.includes(mark.tagId)).map(mark => {
                return (
                  <MarkLoading key={mark.queueId} mark={mark} />
                )
              })
            }
            {
              filteredMarks.length ? (
                view
              ) : !trashState && filterSummary.hasFilters ? (
                <Empty className="min-h-48">
                  <EmptyHeader>
                    <EmptyTitle>{t('emptyFiltered')}</EmptyTitle>
                    <EmptyDescription>{t('emptyFilteredHint')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : <MarkEmpty />
            }
          </div>
        </div>
      </div>
    </PhotoPreviewProvider>
  )
})

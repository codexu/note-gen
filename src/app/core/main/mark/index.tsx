'use client'

import { useTranslations } from 'next-intl'
import React from "react"
import { useEffect } from "react"
import { TagManage } from './tag-manage'
import { MarkList } from './mark-list'
import { MarkToolbar } from './mark-toolbar'
import useMarkStore from "@/stores/mark"
import { Button } from "@/components/ui/button"
import { clearTrash } from "@/db/marks"
import { confirm } from '@tauri-apps/plugin-dialog';
import { filterMarks, getTrashRecordFilters } from "./mark-filters";

export function NoteSidebar() {
  const t = useTranslations();
  const { trashState, marks, setMarks, initRecordViewMode } = useMarkStore()
  const visibleTrashMarks = React.useMemo(() => filterMarks(marks, getTrashRecordFilters()), [marks])

  useEffect(() => {
    initRecordViewMode()
  }, [initRecordViewMode])

  async function handleClearTrash() {
    const res = await confirm(t('record.trash.confirm'), {
      title: t('record.trash.title'),
      kind: 'warning',
    })
    if (res) {
      await clearTrash()
      setMarks([])
    }
  }

  return (
    <div id="record-sidebar" className="w-full h-full hidden md:flex flex-col">
      {trashState ? (
        <>
          <div className="flex p-2 border-b items-center justify-between">
            <p className="text-xs text-zinc-500">{t('record.trash.records', { count: visibleTrashMarks.length })}</p>
            {marks.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearTrash}>
                {t('record.trash.empty')}
              </Button>
            )}
          </div>
          <MarkList />
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <TagManage />
        </div>
      )}
      
      <MarkToolbar />
    </div>
  )
}

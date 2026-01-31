'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { initMarksDb } from '@/db/marks'
import { Button } from '@/components/ui/button'
import { FileText, Trash2, XCircle } from 'lucide-react'
import useMarkStore from '@/stores/mark'

export function MobileMarkHeader() {
  const t = useTranslations('record.mark')
  const { trashState, setTrashState, fetchAllTrashMarks, fetchMarks, marks } = useMarkStore()

  useEffect(() => {
    initMarksDb()
  }, [])

  useEffect(() => {
    if (trashState) {
      fetchAllTrashMarks()
    } else {
      fetchMarks()
    }
  }, [trashState, fetchAllTrashMarks, fetchMarks])

  return (
    <div className="flex justify-between items-center h-12 border-b px-4">
      {/* 左侧：记录标题和数量 */}
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4" />
        <span className="font-medium text-sm">
          {t('list.title')} ({marks.length})
        </span>
      </div>

      {/* 右侧：回收站按钮 / 关闭回收站 */}
      <div className="flex items-center gap-1">
        {trashState ? (
          <Button variant="ghost" size="icon" onClick={() => setTrashState(false)}>
            <XCircle />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" onClick={() => setTrashState(true)}>
            <Trash2 />
            <span className="sr-only">{t('toolbar.trash')}</span>
          </Button>
        )}
      </div>
    </div>
  )
}

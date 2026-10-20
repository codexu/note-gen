'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { clearTrash, initMarksDb, restoreMarks } from '@/db/marks'
import { Button } from '@/components/ui/button'
import { FileText, Trash2, XCircle, RotateCcw } from 'lucide-react'
import useMarkStore from '@/stores/mark'
import { confirm } from '@tauri-apps/plugin-dialog'

export function MobileMarkHeader() {
  const markT = useTranslations('record.mark')
  const recordT = useTranslations('record')
  const { trashState, setTrashState, fetchAllTrashMarks, fetchAllMarks, marks, allMarks, setMarks } = useMarkStore()

  useEffect(() => {
    initMarksDb()
  }, [])

  useEffect(() => {
    if (trashState) {
      fetchAllTrashMarks()
    } else {
      fetchAllMarks()
    }
  }, [trashState, fetchAllTrashMarks, fetchAllMarks])

  async function handleClearTrash() {
    const accepted = await confirm(`${recordT('trash.confirm')}\n${recordT('trash.syncWarning')}`, {
      title: recordT('trash.title'),
      kind: 'warning',
    })
    if (!accepted) return
    await clearTrash()
    setMarks([])
    await fetchAllTrashMarks()
  }

  async function handleRestoreAll() {
    if (marks.length === 0) return
    await restoreMarks(marks.map((item) => item.id))
    setMarks([])
    await fetchAllTrashMarks()
  }

  return (
    <div className="mobile-page-header flex justify-between items-center border-b px-3">
      {/* 左侧：记录标题和数量 */}
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4" />
        <span className="font-medium text-sm">
          {markT('list.title')} ({trashState ? marks.length : allMarks.length})
        </span>
      </div>

      {/* 右侧：回收站按钮 / 关闭回收站 */}
      <div className="flex items-center gap-1">
        {trashState ? (
          <>
            {marks.length > 0 && (
              <>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={handleRestoreAll}>
                  <RotateCcw className="mr-1 size-3.5" />
                  {recordT('trash.restoreAll')}
                </Button>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={handleClearTrash}>
                  {recordT('trash.empty')}
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setTrashState(false)}>
              <XCircle />
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => setTrashState(true)}>
            <Trash2 className="mr-1 size-4" />
            {markT('toolbar.trash')}
          </Button>
        )}
      </div>
    </div>
  )
}

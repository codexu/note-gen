'use client'
import { MobileMarkHeader } from './mobile-mark-header'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { TagManage } from '@/app/core/record/mark/tag-manage'
import useMarkStore from '@/stores/mark'
import { MarkList } from '@/app/core/record/mark/mark-list'
import { clearTrash } from '@/db/marks'
import { confirm } from '@tauri-apps/plugin-dialog'

export default function Record() {
  const t = useTranslations()
  const { trashState, marks, setMarks } = useMarkStore()

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
    <div id="mobile-record" className="flex flex-col h-full w-full bg-background">
      <MobileMarkHeader />
      {trashState ? (
        <>
          <div className="flex p-3 border-b items-center justify-between bg-muted/50">
            <p className="text-sm text-muted-foreground">{t('record.trash.records', { count: marks.length })}</p>
            {marks.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearTrash} className="h-8">
                {t('record.trash.empty')}
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            <MarkList />
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <TagManage />
        </div>
      )}
    </div>
  )
}
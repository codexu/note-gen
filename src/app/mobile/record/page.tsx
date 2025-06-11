'use client'
import { MarkToolbar } from '@/app/core/record/mark/mark-toolbar'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { TagManage } from '@/app/core/record/tag'
import { useLocalStorage } from 'react-use'
import useMarkStore from '@/stores/mark'
import { MarkList } from '@/app/core/record/mark/mark-list'

export default function Record() {
  const t = useTranslations('record')
  const [trashState, setTrashState] = useLocalStorage('trashState', false)
  const { marks } = useMarkStore()
  const handleClearTrash = () => {
    setTrashState(false)
  }
  return (
    <div className="flex flex-col h-full w-full">
      <MarkToolbar />
      {
        trashState? 
        <div className="flex pb-2 pl-2 relative border-b h-6 items-center justify-between">
          <p className="text-xs text-zinc-500">{t('record.trash.records', { count: marks.length })}</p>
          {
            marks.length > 0 ?
            <Button className="text-xs text-red-900" variant="link" onClick={handleClearTrash}>{t('record.trash.empty')}</Button> : null
          }
        </div> :
        <TagManage />
      }
      <MarkList />
    </div>
  )
}
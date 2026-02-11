'use client'
import { Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { SyncButton } from './sync-button'
import { PullButton } from './pull-button'
import { HistorySheet } from './history-sheet'
import { useRouter } from 'next/navigation'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import { useEffect, useState } from 'react'

interface SyncToolsProps {
  editor: Editor
}

export function SyncTools({ editor }: SyncToolsProps) {
  const t = useTranslations('common')
  const router = useRouter()
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    isSyncConfigured().then(setConfigured)
  }, [])

  const handleConfigureSync = () => {
    router.push('/core/setting/sync')
  }

  if (configured) {
    return (
      <div className="flex items-center gap-1">
        <HistorySheet editor={editor} />
        <SyncButton />
        <PullButton editor={editor} />
      </div>
    )
  }

  return (
    <button
      onClick={handleConfigureSync}
      className="flex items-center gap-0.5 px-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
      title={t('configureSync')}
    >
      <span>{t('configureSync')}</span>
    </button>
  )
}

export default SyncTools

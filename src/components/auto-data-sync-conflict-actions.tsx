'use client'

import { useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useTranslations } from 'next-intl'
import { DownloadCloud, GitMerge, Loader2, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import {
  resolveAutoDataSyncConflict,
  type AutoDataSyncConflictResolution,
} from '@/lib/sync/auto-data-sync-queue'
import { cn } from '@/lib/utils'

interface AutoDataSyncConflictActionsProps {
  className?: string
  disabled?: boolean
  confirmBeforeDestructive?: boolean
  onResolved?: () => Promise<void> | void
}

export function AutoDataSyncConflictActions({
  className,
  disabled = false,
  confirmBeforeDestructive = true,
  onResolved,
}: AutoDataSyncConflictActionsProps) {
  const t = useTranslations()
  const [busyAction, setBusyAction] = useState<AutoDataSyncConflictResolution | null>(null)

  async function handleResolve(action: AutoDataSyncConflictResolution) {
    const confirmMessage = action === 'download_remote'
      ? t('settings.sync.autoDataSyncConflictPullConfirm')
      : action === 'upload_local'
        ? t('settings.sync.autoDataSyncConflictUploadConfirm')
        : null

    if (confirmBeforeDestructive && confirmMessage) {
      const accepted = await confirm(confirmMessage, {
        title: t('settings.sync.autoDataSyncConflictTitle'),
        kind: 'warning',
      })
      if (!accepted) return
    }

    setBusyAction(action)
    try {
      const resolved = await resolveAutoDataSyncConflict(action)
      if (!resolved) {
        throw new Error('Failed to resolve auto data sync conflict')
      }

      if (action !== 'later') {
        await onResolved?.()
        toast({ description: t('settings.sync.autoDataSyncConflictResolved') })
      }
    } catch (error) {
      console.error('Failed to resolve auto data sync conflict:', error)
      toast({
        description: t('settings.sync.autoDataSyncConflictResolveFailed'),
        variant: 'destructive',
      })
    } finally {
      setBusyAction(null)
    }
  }

  const isBusy = busyAction !== null

  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap', className)}>
      <Button
        size="sm"
        onClick={() => void handleResolve('merge')}
        disabled={disabled || isBusy}
      >
        {busyAction === 'merge' ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <GitMerge className="mr-2 size-4" />
        )}
        {t('settings.sync.autoDataSyncConflictMerge')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleResolve('download_remote')}
        disabled={disabled || isBusy}
      >
        {busyAction === 'download_remote' ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <DownloadCloud className="mr-2 size-4" />
        )}
        {t('settings.sync.autoDataSyncConflictPullRemote')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleResolve('upload_local')}
        disabled={disabled || isBusy}
      >
        {busyAction === 'upload_local' ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <UploadCloud className="mr-2 size-4" />
        )}
        {t('settings.sync.autoDataSyncConflictUploadLocal')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void handleResolve('later')}
        disabled={disabled || isBusy}
      >
        {busyAction === 'later' ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
        {t('settings.sync.autoDataSyncConflictLater')}
      </Button>
    </div>
  )
}

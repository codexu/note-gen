'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AutoDataSyncConflictActions } from '@/components/auto-data-sync-conflict-actions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getAutoDataSyncState,
  subscribeAutoDataSyncState,
  type AutoDataSyncState,
} from '@/lib/sync/auto-data-sync-queue'

export function AutoDataSyncConflictDialog() {
  const t = useTranslations()
  const [syncState, setSyncState] = useState<AutoDataSyncState>(getAutoDataSyncState())

  useEffect(() => subscribeAutoDataSyncState(setSyncState), [])

  async function refreshRecordsAfterResolve() {
    const [{ default: useTagStore }, { default: useMarkStore }] = await Promise.all([
      import('@/stores/tag'),
      import('@/stores/mark'),
    ])
    await Promise.all([
      useTagStore.getState().fetchTags(),
      useMarkStore.getState().fetchMarks(),
    ])
    useTagStore.getState().getCurrentTag()
  }

  return (
    <Dialog open={syncState.phase === 'conflict'}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            {t('settings.sync.autoDataSyncConflictTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('settings.sync.autoDataSyncConflictDesc')}
          </DialogDescription>
        </DialogHeader>
        {syncState.lastError ? (
          <p className="break-words rounded-md bg-muted p-2 text-xs text-muted-foreground">
            {syncState.lastError}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t('settings.sync.autoDataSyncConflictMergeDesc')}
        </p>
        <AutoDataSyncConflictActions
          confirmBeforeDestructive={false}
          onResolved={refreshRecordsAfterResolve}
        />
      </DialogContent>
    </Dialog>
  )
}

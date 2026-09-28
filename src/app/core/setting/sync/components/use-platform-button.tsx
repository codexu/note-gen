'use client'

import { Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { confirm } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import type { SyncPlatform } from '@/types/sync'
import { inspectSyncEngineSwitch, pauseSyncEngine } from '@/lib/sync/engine-switch'

interface UsePlatformButtonProps {
  platform: SyncPlatform
  disabled?: boolean
  size?: 'default' | 'sm'
}

export function UsePlatformButton({
  platform,
  disabled = false,
  size = 'sm',
}: UsePlatformButtonProps) {
  const t = useTranslations()
  const { primaryBackupMethod, setPrimaryBackupMethod } = useSettingStore()
  const [isSaving, setIsSaving] = useState(false)
  const isCurrent = primaryBackupMethod === platform

  async function handleClick() {
    setIsSaving(true)
    try {
      const review = platform === 'local' ? null : await inspectSyncEngineSwitch(primaryBackupMethod, platform)
      if (review?.requiresReview) {
        const accepted = await confirm(
          t('settings.sync.engineSwitchReviewDescription', {
            changes: review.pendingLocalChanges,
            commands: review.pendingCommands,
            currentRemote: review.currentRemoteObjects < 0 ? '?' : review.currentRemoteObjects,
            nextRemote: review.nextRemoteObjects < 0 ? '?' : review.nextRemoteObjects,
          }),
          { title: t('settings.sync.engineSwitchReviewTitle'), kind: 'warning' },
        )
        if (!accepted) return
      }
      pauseSyncEngine(primaryBackupMethod)
      await setPrimaryBackupMethod(platform)
    } catch (error) {
      console.error('[sync] Failed to switch primary provider', {
        current: primaryBackupMethod,
        next: platform,
        error,
      })
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Button
      type="button"
      variant={isCurrent ? 'secondary' : 'default'}
      size={size}
      disabled={disabled || isCurrent || isSaving}
      onClick={() => void handleClick()}
    >
      {isSaving ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : isCurrent ? (
        <Check data-icon="inline-start" />
      ) : null}
      {isCurrent
        ? t('settings.sync.currentPlatform')
        : t('settings.sync.setCurrentPlatform')}
    </Button>
  )
}

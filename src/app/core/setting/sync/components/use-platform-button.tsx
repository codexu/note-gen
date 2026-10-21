'use client'

import { Check, Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import type { SyncPlatform } from '@/types/sync'
import { switchSyncPlatform, usePlatformSwitchStore } from '@/stores/sync-platform-switch'

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
  const p = useTranslations('settings.sync.switchPlan')
  const primaryBackupMethod = useSettingStore(state => state.primaryBackupMethod)
  const switchingPlatform = usePlatformSwitchStore(state => state.platform)
  const step = usePlatformSwitchStore(state => state.step)
  const skipped = usePlatformSwitchStore(state => state.skipped)
  const isSaving = switchingPlatform === platform && !['error', 'cancelled', 'review', 'confirm', 'completed'].includes(step)
  const isCurrent = primaryBackupMethod === platform
  const pendingLabel = step === 'cancelled' ? p('cancelled') : step === 'error' ? p('failed') : step === 'review' || step === 'confirm' ? p('waitingChoice') : p('working')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const previousTarget = useRef(switchingPlatform)
  useEffect(() => {
    if (previousTarget.current === platform && switchingPlatform === null && !buttonRef.current?.disabled) {
      buttonRef.current?.focus()
    }
    previousTarget.current = switchingPlatform
  }, [platform, switchingPlatform])

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant={isCurrent ? 'secondary' : 'default'}
      size={size}
      disabled={disabled || isCurrent || (switchingPlatform !== null && !(step === 'completed' && skipped))}
      onClick={() => void switchSyncPlatform(platform)}
    >
      {isSaving ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : isCurrent ? (
        <Check data-icon="inline-start" />
      ) : null}
      {isCurrent
        ? t('settings.sync.currentPlatform')
        : switchingPlatform === platform ? pendingLabel : t('settings.sync.setCurrentPlatform')}
    </Button>
  )
}

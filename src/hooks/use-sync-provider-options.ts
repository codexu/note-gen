import { useTranslations } from 'next-intl'
import type { Platform } from '@tauri-apps/plugin-os'

import { SYNC_PLATFORMS, SYNC_PLATFORM_INFO, type SyncProvider } from '@/types/sync'

export function useSyncProviderOptions(mobilePlatform?: Platform) {
  const t = useTranslations('settings.sync')
  const providers: SyncProvider[] = SYNC_PLATFORMS.filter(platform =>
    platform !== 'cloudFolder' || !mobilePlatform,
  )
  if (mobilePlatform === 'ios') providers.push('iCloud')
  if (mobilePlatform === 'ios' || mobilePlatform === 'android') providers.push('oneDrive')

  return providers.map(value => ({
    value,
    label: value === 'local' || value === 'cloudFolder' || value === 'iCloud' || value === 'oneDrive' || value === 'selfHosted'
      ? t(`${value}.title`)
      : SYNC_PLATFORM_INFO[value].name,
  }))
}

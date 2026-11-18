'use client'

// Fork（almanac ALMNC-7）：新舊介面開關的同步元件與設定列。
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { LayoutTemplate } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { UI_MODE_KEY, useUiModeStore } from '@/lib/fork-ui'

/** 掛在 root layout：啟動時以 store.json 為準，並跟著其他視窗的切換 */
export function UiModeSync() {
  useEffect(() => {
    void useUiModeStore.getState().load().catch(error => {
      console.warn('[ui-mode] load failed, keeping current mode:', error)
    })
    const onStorage = (event: StorageEvent) => {
      if (event.key === UI_MODE_KEY) useUiModeStore.getState().syncFromOtherWindow(event.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return null
}

export function UiModeSettings() {
  const t = useTranslations('settings.general.interface.uiMode')
  const mode = useUiModeStore(state => state.mode)

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><LayoutTemplate /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          checked={mode === 'v3'}
          aria-label={t('title')}
          onCheckedChange={(checked) => {
            void useUiModeStore.getState().setMode(checked ? 'v3' : 'classic')
          }}
        />
      </ItemActions>
    </Item>
  )
}

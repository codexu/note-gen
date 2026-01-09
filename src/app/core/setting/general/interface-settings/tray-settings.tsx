'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Monitor } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import useSettingStore from '@/stores/setting'
import { invoke } from '@tauri-apps/api/core'

export function TraySettings() {
  const t = useTranslations('settings.general.interface.tray')
  const { trayEnabled, setTrayEnabled } = useSettingStore()

  const handleTrayEnabledChange = async (enabled: boolean) => {
    try {
      // 调用后端命令更新托盘设置
      await invoke('update_tray_enabled', { enabled })
      // 更新前端状态
      setTrayEnabled(enabled)
    } catch (error) {
      console.error('Failed to update tray settings:', error)
    }
  }

  return (
    <div className="space-y-4">
      <Item variant="outline">
        <ItemMedia variant="icon"><Monitor className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('enabled.title')}</ItemTitle>
          <ItemDescription>{t('enabled.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            checked={trayEnabled}
            onCheckedChange={handleTrayEnabledChange}
          />
        </ItemActions>
      </Item>
    </div>
  )
}

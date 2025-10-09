'use client'

import { Switch } from '@/components/ui/switch'
import { SettingPanel } from '../components/setting-base'
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'

export function GlobalSettings() {
  const t = useTranslations('settings.mcp')
  const { enabled, setEnabled } = useMcpStore()
  
  return (
    <SettingPanel
      title={t('enableTitle')}
      desc={t('enableDesc')}
    >
      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
      />
    </SettingPanel>
  )
}

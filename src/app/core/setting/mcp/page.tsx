'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Puzzle } from 'lucide-react'
import { SettingType } from '../components/setting-base'
import { GlobalSettings } from './global-settings'
import { ServerList } from './server-list'
import { useMcpStore } from '@/stores/mcp'

export default function McpSettingPage() {
  const t = useTranslations('settings.mcp')
  const { initMcpData } = useMcpStore()
  
  useEffect(() => {
    initMcpData()
  }, [initMcpData])
  
  return (
    <SettingType id="mcp" title={t('title')} desc={t('desc')} icon={<Puzzle />}>
      <GlobalSettings />
      <ServerList />
    </SettingType>
  )
}

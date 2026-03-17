'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Puzzle } from 'lucide-react'
import { SettingType } from '../components/setting-base'
import { ServerList } from './server-list'
import { RuntimeEnvironmentCard } from './runtime-environment-card'
import { useMcpStore } from '@/stores/mcp'
import { isMobileDevice } from '@/lib/check'

export default function McpSettingPage() {
  const t = useTranslations('settings.mcp')
  const { initMcpData } = useMcpStore()
  const isMobile = isMobileDevice()
  
  useEffect(() => {
    initMcpData()
  }, [initMcpData])
  
  return (
    <SettingType id="mcp" title={t('title')} desc={t('desc')} icon={<Puzzle />}>
      <div className="space-y-4">
        {!isMobile && <RuntimeEnvironmentCard />}
        <ServerList />
      </div>
    </SettingType>
  )
}

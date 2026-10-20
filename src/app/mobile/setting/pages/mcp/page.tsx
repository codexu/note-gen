'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { ServerList } from '@/app/core/setting/mcp/server-list'
import { SettingType } from '@/app/core/setting/components/setting-base'
import { useMcpStore } from '@/stores/mcp'

export default function McpSettingPage() {
  const t = useTranslations('settings.mcp')
  const { initMcpData } = useMcpStore()

  useEffect(() => {
    void initMcpData()
  }, [initMcpData])

  return (
    <SettingType id="mcp" title={t('title')} desc={t('desc')}>
      <ServerList mobile />
    </SettingType>
  )
}

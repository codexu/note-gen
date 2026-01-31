'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { ServerList } from '@/app/core/setting/mcp/server-list'
import { useMcpStore } from '@/stores/mcp'

export default function McpSettingPage() {
  const t = useTranslations('settings.mcp')
  const { initMcpData } = useMcpStore()

  useEffect(() => {
    initMcpData()
  }, [])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      </div>
      <div className="space-y-6">
        <ServerList />
      </div>
    </div>
  )
}

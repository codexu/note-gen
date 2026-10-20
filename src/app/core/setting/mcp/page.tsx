'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Puzzle } from 'lucide-react'
import { SettingType } from '../components/setting-base'
import { ServerList } from './server-list'
import { RuntimeEnvironmentCard } from './runtime-environment-card'
import { LocalMcpServer } from './local-mcp-server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
      {isMobile ? (
        <ServerList />
      ) : (
        <Tabs defaultValue="servers" className="gap-5">
          <TabsList>
            <TabsTrigger value="servers">{t('externalTab')}</TabsTrigger>
            <TabsTrigger value="access">{t('accessTab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="servers" className="flex flex-col gap-4">
            <RuntimeEnvironmentCard />
            <ServerList />
          </TabsContent>
          <TabsContent value="access">
            <LocalMcpServer />
          </TabsContent>
        </Tabs>
      )}
    </SettingType>
  )
}

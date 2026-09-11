'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Blocks, CircleAlert, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getLatestDesktopRelease, hasNewerVersion } from './plugin-display'
import { loadPluginMessages } from '@/lib/plugins/localization'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { usePluginStore } from '@/stores/plugins'
import useSettingStore from '@/stores/setting'
import { SettingType } from '../components/setting-base'
import { DeveloperTab } from './developer-tab'
import { InstalledPluginsTab } from './installed-plugins-tab'
import { MarketplaceTab } from './marketplace-tab'
import { UpdatesTab } from './updates-tab'

export default function PluginsSettingPage({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const initialized = usePluginStore((state) => state.initialized)
  const installed = usePluginStore((state) => state.installed)
  const catalog = usePluginStore((state) => state.catalog)
  const logs = usePluginStore((state) => state.logs)
  const developerMode = useSettingStore(state => state.developerMode)
  const [tab, setTab] = useState('installed')
  const [marketQuery, setMarketQuery] = useState('')
  const discoveryRequest = useSettingsDialogStore(state => state.pluginDiscoveryRequest)
  const clearDiscoveryRequest = useSettingsDialogStore(state => state.clearPluginDiscoveryRequest)
  const [enablePluginId, setEnablePluginId] = useState<string | null>(null)
  function offerEnablement(pluginId: string) {
    setEnablePluginId(pluginId)
    setTab('installed')
  }
  const appVersion = useSettingStore((state) => state.version)
  const initialize = usePluginStore((state) => state.initialize)
  const refreshMarket = usePluginStore((state) => state.refreshMarket)
  const [initializationError, setInitializationError] = useState<string | null>(null)
  const [, setLocalizationRevision] = useState(0)

  const updateCount = useMemo(() => {
    const catalogById = new Map((catalog?.plugins ?? []).map((plugin) => [plugin.id, plugin]))
    return installed.filter((plugin) => {
      if (plugin.source !== 'marketplace') return false
      const entry = catalogById.get(plugin.manifest.id)
      return hasNewerVersion(plugin.activeVersion, entry ? getLatestDesktopRelease(entry, appVersion)?.version : undefined)
    }).length
  }, [appVersion, catalog?.plugins, installed])

  async function initializePage() {
    setInitializationError(null)
    try {
      await initialize()
      if (!mobile) await refreshMarket()
    } catch (reason) {
      setInitializationError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  useEffect(() => {
    if (!discoveryRequest || mobile) return
    setMarketQuery(discoveryRequest.query)
    setTab('market')
    clearDiscoveryRequest()
  }, [discoveryRequest, mobile, clearDiscoveryRequest])

  useEffect(() => {
    void initializePage()
  }, [])

  useEffect(() => {
    if ((mobile && tab !== 'installed') || (!developerMode && tab === 'developer')) {
      setTab('installed')
    }
  }, [developerMode, mobile, tab])

  useEffect(() => {
    if (!initialized) return
    let cancelled = false
    void Promise.allSettled(installed.map((plugin) => loadPluginMessages(plugin, locale))).then(() => {
      if (!cancelled) setLocalizationRevision((revision) => revision + 1)
    })
    return () => {
      cancelled = true
    }
  }, [initialized, installed, locale])

  return (
    <SettingType id="plugins" title={t('title')} desc={t('desc')} icon={<Blocks />}>
      {initializationError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{t('initializationFailed')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{initializationError}</span>
            <Button variant="outline" size="sm" className="self-start" onClick={() => void initializePage()}>
              <RefreshCw data-icon="inline-start" />{t('actions.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !initialized ? (
        <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner />{t('loading')}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="gap-5">
          <TabsList className="max-w-full justify-start">
            <TabsTrigger value="installed">
              {t('tabs.installed')}
              <Badge variant="secondary">{installed.length}</Badge>
            </TabsTrigger>
            {!mobile ? <TabsTrigger value="market">{t('ux.discover')}</TabsTrigger> : null}
            {!mobile ? <TabsTrigger value="updates">
              {t('tabs.updates')}
              {updateCount > 0 ? <Badge variant="secondary">{updateCount}</Badge> : null}
            </TabsTrigger> : null}
            {!mobile && developerMode ? <TabsTrigger value="developer">
              {t('tabs.developer')}
              {logs.some(entry => entry.level === 'error') ? <CircleAlert aria-label={t('labels.attention')} /> : null}
            </TabsTrigger> : null}
          </TabsList>
          {!mobile ? <TabsContent value="market"><MarketplaceTab query={marketQuery} onQueryChange={setMarketQuery} onInstalled={offerEnablement} /></TabsContent> : null}
          <TabsContent value="installed" className="flex flex-col gap-4">
            <InstalledPluginsTab enablePluginId={enablePluginId} onEnablePromptHandled={() => setEnablePluginId(null)} />
          </TabsContent>
          {!mobile ? <TabsContent value="updates"><UpdatesTab updatesOnly /></TabsContent> : null}
          {!mobile && developerMode ? <TabsContent value="developer"><DeveloperTab onImported={offerEnablement} /></TabsContent> : null}
        </Tabs>
      )}
    </SettingType>
  )
}

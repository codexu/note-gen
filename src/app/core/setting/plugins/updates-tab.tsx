'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { History, PackageCheck, RefreshCw, Trash2, TriangleAlert, WifiOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import type { InstalledPlugin } from '@/lib/plugins/types'
import { getPluginManifestFingerprint } from '@/lib/plugins/types'
import { usePluginStore } from '@/stores/plugins'
import useSettingStore from '@/stores/setting'
import { getInstalledPluginText, getLatestDesktopRelease, hasNewerVersion } from './plugin-display'

function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  disabled = false,
  onConfirm,
}: {
  trigger: ReactNode
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  disabled?: boolean
  onConfirm: () => void
}) {
  const t = useTranslations('settings.plugins')
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild disabled={disabled}>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} disabled={disabled} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function UninstallAction({
  plugin,
  disabled,
  onUninstall,
}: {
  plugin: InstalledPlugin
  disabled: boolean
  onUninstall: (removeData: boolean) => void
}) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const catalog = usePluginStore(state => state.catalog)
  const pluginText = getInstalledPluginText(plugin, locale, catalog?.plugins.find(entry => entry.id === plugin.manifest.id))
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild disabled={disabled}>
        <Button variant="destructive" size="sm" disabled={disabled}>
          <Trash2 data-icon="inline-start" />{t('actions.uninstall')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('updates.confirmUninstallTitle', { name: pluginText.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('updates.confirmUninstallDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="outline" disabled={disabled} onClick={() => onUninstall(false)}>
            {t('actions.uninstallKeepData')}
          </AlertDialogAction>
          <AlertDialogAction variant="destructive" disabled={disabled} onClick={() => onUninstall(true)}>
            {t('actions.uninstallAndRemoveData')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function UpdatesTab({ pluginId, updatesOnly = false }: { pluginId?: string; updatesOnly?: boolean }) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const installed = usePluginStore((state) => state.installed)
  const catalog = usePluginStore((state) => state.catalog)
  const operationPluginId = usePluginStore((state) => state.operationPluginId)
  const appVersion = useSettingStore((state) => state.version)
  const installFromMarket = usePluginStore((state) => state.installFromMarket)
  const rollback = usePluginStore((state) => state.rollback)
  const uninstall = usePluginStore((state) => state.uninstall)
  const [error, setError] = useState<string | null>(null)

  const catalogById = useMemo(
    () => new Map((catalog?.plugins ?? []).map((plugin) => [plugin.id, plugin])),
    [catalog?.plugins],
  )
  const manageable = installed.filter(plugin => {
    if (pluginId && plugin.manifest.id !== pluginId) return false
    if (!updatesOnly) return true
    const entry = catalogById.get(plugin.manifest.id)
    return plugin.source === 'marketplace' && hasNewerVersion(plugin.activeVersion, entry ? getLatestDesktopRelease(entry, appVersion)?.version : undefined)
  })
  const updateCount = manageable.filter((plugin) => {
    if (plugin.source !== 'marketplace') return false
    const entry = catalogById.get(plugin.manifest.id)
    return hasNewerVersion(plugin.activeVersion, entry ? getLatestDesktopRelease(entry, appVersion)?.version : undefined)
  }).length

  async function runOperation(operation: () => Promise<void>) {
    setError(null)
    try {
      await operation()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!pluginId ? <Alert>
        <PackageCheck />
        <AlertTitle>{t('updates.summaryTitle', { count: updateCount })}</AlertTitle>
        <AlertDescription>{t('updates.summaryDesc')}</AlertDescription>
      </Alert> : null}

      {catalog?.stale ? (
        <Alert variant="warning">
          <WifiOff />
          <AlertTitle>{t('market.staleTitle')}</AlertTitle>
          <AlertDescription>{t('market.staleInstallDisabled')}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t('updates.operationFailed')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {manageable.length > 0 ? (
        <ItemGroup>
          {manageable.map((plugin: InstalledPlugin) => {
            const marketEntry = catalogById.get(plugin.manifest.id)
            const pluginText = getInstalledPluginText(plugin, locale, marketEntry)
            const latestRelease = marketEntry ? getLatestDesktopRelease(marketEntry, appVersion) : undefined
            const updateAvailable = plugin.source === 'marketplace'
              && hasNewerVersion(plugin.activeVersion, latestRelease?.version)
            const busy = operationPluginId === plugin.manifest.id
            return (
              <Item role="listitem" key={getPluginManifestFingerprint(plugin)} variant="outline">
                <ItemMedia variant="icon">
                  {busy ? <Spinner /> : updateAvailable ? <RefreshCw /> : <PackageCheck />}
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full flex-wrap">
                    <span className="truncate">{pluginText.name}</span>
                    <Badge variant={updateAvailable ? 'default' : 'outline'}>
                      {updateAvailable ? t('updates.available') : t('updates.current')}
                    </Badge>
                    {plugin.pendingActivation ? (
                      <Badge variant="secondary">{t('updates.pendingActivation')}</Badge>
                    ) : null}
                    {plugin.source === 'development' ? <Badge variant="secondary">{t('sources.development')}</Badge> : null}
                  </ItemTitle>
                  <ItemDescription>
                    {updateAvailable
                      ? t('updates.versionChange', { current: plugin.activeVersion, next: latestRelease?.version ?? '' })
                      : t('updates.currentVersion', { version: plugin.activeVersion })}
                  </ItemDescription>
                  {updateAvailable && latestRelease?.changelog ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{latestRelease.changelog}</p>
                  ) : null}
                  {plugin.pendingActivation ? (
                    <p className="text-xs text-muted-foreground">{t('updates.pendingActivationDesc')}</p>
                  ) : null}
                </ItemContent>
                <ItemActions className="flex-wrap justify-end">
                  {updateAvailable && latestRelease ? (
                    <ConfirmAction
                      disabled={catalog?.stale || plugin.pendingActivation || Boolean(operationPluginId)}
                      trigger={(
                        <Button
                          size="sm"
                          disabled={catalog?.stale || plugin.pendingActivation || Boolean(operationPluginId)}
                        >
                          <RefreshCw data-icon="inline-start" />{t('actions.update')}
                        </Button>
                      )}
                      title={t('updates.confirmUpdateTitle', { name: pluginText.name })}
                      description={t('updates.confirmUpdateDesc', {
                        current: plugin.activeVersion,
                        next: latestRelease.version,
                      })}
                      confirmLabel={t('actions.update')}
                      onConfirm={() => void runOperation(() => installFromMarket(plugin.manifest.id, latestRelease.version))}
                    />
                  ) : null}

                  {plugin.previousVersion ? (
                    <ConfirmAction
                      disabled={Boolean(operationPluginId)}
                      trigger={(
                        <Button variant="outline" size="sm" disabled={Boolean(operationPluginId)}>
                          <History data-icon="inline-start" />{t('actions.rollback')}
                        </Button>
                      )}
                      title={t('updates.confirmRollbackTitle', { name: pluginText.name })}
                      description={t('updates.confirmRollbackDesc', {
                        current: plugin.activeVersion,
                        previous: plugin.previousVersion,
                      })}
                      confirmLabel={t('actions.rollback')}
                      onConfirm={() => void runOperation(() => rollback(plugin.manifest.id))}
                    />
                  ) : null}

                  <UninstallAction
                    plugin={plugin}
                    disabled={Boolean(operationPluginId)}
                    onUninstall={(removeData) => void runOperation(() => uninstall(plugin.manifest.id, removeData))}
                  />
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      ) : (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><PackageCheck /></EmptyMedia>
            <EmptyTitle>{t('updates.empty')}</EmptyTitle>
            <EmptyDescription>{t('updates.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

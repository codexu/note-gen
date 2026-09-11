'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  BadgeCheck,
  ExternalLink,
  PackagePlus,
  Search,
  Star,
  WifiOff,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
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
import { PluginListToolbar } from './plugin-list-toolbar'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { PluginMarketEntry } from '@/lib/plugins/types'
import { usePluginStore } from '@/stores/plugins'
import useSettingStore from '@/stores/setting'
import { getLatestDesktopRelease, getPluginMarketText } from './plugin-display'

function MarketplaceSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex items-start gap-3 rounded-lg border p-3">
          <Skeleton className="size-9 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  )
}

export function MarketplaceTab({ query, onQueryChange, onInstalled }: {
  query: string
  onQueryChange: (value: string) => void
  onInstalled?: (pluginId: string) => void
}) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const catalog = usePluginStore((state) => state.catalog)
  const installed = usePluginStore((state) => state.installed)
  const marketLoading = usePluginStore((state) => state.marketLoading)
  const marketError = usePluginStore((state) => state.marketError)
  const operationPluginId = usePluginStore((state) => state.operationPluginId)
  const appVersion = useSettingStore((state) => state.version)
  const refreshMarket = usePluginStore((state) => state.refreshMarket)
  const installFromMarket = usePluginStore((state) => state.installFromMarket)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [reviewEntry, setReviewEntry] = useState<PluginMarketEntry | null>(null)

  const installedById = useMemo(
    () => new Map(installed.map((plugin) => [plugin.manifest.id, plugin])),
    [installed],
  )
  const plugins = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return [...(catalog?.plugins ?? [])]
      .map(plugin => ({ ...plugin, ...getPluginMarketText(plugin, locale) }))
      .filter((plugin) => {
        if (!normalizedQuery) return true
        return [
          plugin.name,
          plugin.description,
          plugin.author,
          plugin.id,
          ...Object.values(plugin.localizations ?? {}).flatMap(text => [text.name, text.description]),
          ...(plugin.categories ?? []),
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
      })
      .sort((left, right) => {
        const leftRank = Number(left.featured) + Number(left.official)
        const rightRank = Number(right.featured) + Number(right.official)
        return rightRank - leftRank || left.name.localeCompare(right.name)
      })
  }, [catalog?.plugins, query, locale])

  async function handleInstall(entry: PluginMarketEntry) {
    const release = getLatestDesktopRelease(entry, appVersion)
    if (!release || catalog?.stale) return
    setOperationError(null)
    try {
      await installFromMarket(entry.id, release.version)
      onInstalled?.(entry.id)
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const reviewRelease = reviewEntry ? getLatestDesktopRelease(reviewEntry, appVersion) : undefined
  const reviewPermissions = reviewRelease?.permissions ?? reviewEntry?.permissions ?? []
  const reviewPublisher = reviewEntry
    ? catalog?.publishers.find((publisher) => publisher.id === reviewEntry.publisherId)
    : undefined

  function openExternal(url: string) {
    void openUrl(url).catch((reason) => {
      setOperationError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className="flex flex-col gap-4" aria-busy={marketLoading}>
      <PluginListToolbar
        query={query}
        onQueryChange={onQueryChange}
        placeholder={t('market.searchPlaceholder')}
        searchLabel={t('market.searchLabel')}
        refreshing={marketLoading}
        disabled={Boolean(operationPluginId)}
        onRefresh={() => void refreshMarket(true)}
      />

      {catalog?.stale ? (
        <Alert variant="warning">
          <WifiOff />
          <AlertTitle>{t('market.staleTitle')}</AlertTitle>
          <AlertDescription>
            {t('market.staleInstallDisabled')}
          </AlertDescription>
        </Alert>
      ) : null}

      {marketError ? (
        <Alert variant="destructive">
          <WifiOff />
          <AlertTitle>{t('market.loadFailed')}</AlertTitle>
          <AlertDescription>{marketError}</AlertDescription>
        </Alert>
      ) : null}
      {operationError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('market.installFailed')}</AlertTitle>
          <AlertDescription>{operationError}</AlertDescription>
        </Alert>
      ) : null}

      {marketLoading && !catalog ? (
        <MarketplaceSkeleton />
      ) : plugins.length > 0 ? (
        <ItemGroup>
          {plugins.map((entry) => {
            const release = getLatestDesktopRelease(entry, appVersion)
            const installedPlugin = installedById.get(entry.id)
            const busy = operationPluginId === entry.id
            return (
              <Item role="listitem" key={entry.id} variant="outline" className="items-start">
                <ItemMedia variant="icon">
                  <PackagePlus />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full flex-wrap">
                    <span className="truncate">{entry.name}</span>
                    {entry.official ? <Badge variant="secondary"><BadgeCheck />{t('labels.official')}</Badge> : null}
                    {entry.featured ? <Badge variant="outline"><Star />{t('labels.featured')}</Badge> : null}
                  </ItemTitle>
                  <ItemDescription>{entry.description}</ItemDescription>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{entry.author}</span>
                    <span aria-hidden>·</span>
                    <code>{entry.id}</code>
                    {release ? <><span aria-hidden>·</span><span>v{release.version}</span></> : null}
                  </div>
                </ItemContent>
                <ItemActions className="flex-wrap self-center">
                  <Button
                    size="sm"
                    disabled={catalog?.stale || !release || Boolean(installedPlugin) || Boolean(operationPluginId)}
                    onClick={() => setReviewEntry(catalog?.plugins.find(plugin => plugin.id === entry.id) ?? entry)}
                    aria-label={t('market.installAria', { name: entry.name })}
                  >
                    {busy ? <Spinner data-icon="inline-start" /> : <PackagePlus data-icon="inline-start" />}
                    {catalog?.stale || !release
                      ? t('market.unavailable')
                      : installedPlugin
                        ? t('actions.installed')
                        : busy
                          ? t('actions.installing')
                          : t('actions.install')}
                  </Button>
                </ItemActions>
                <ItemFooter className="justify-start border-t pt-2 text-xs text-muted-foreground">
                  <span>{t('market.permissionsCount', { count: (release?.permissions ?? entry.permissions).length })}</span>
                  {entry.categories?.map((category) => (
                    <Badge key={category} variant="outline">{category}</Badge>
                  ))}
                </ItemFooter>
              </Item>
            )
          })}
        </ItemGroup>
      ) : (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Search /></EmptyMedia>
            <EmptyTitle>{query ? t('market.noResults') : t('market.empty')}</EmptyTitle>
            <EmptyDescription>{query ? t('market.noResultsDesc') : t('market.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <AlertDialog open={Boolean(reviewEntry)} onOpenChange={(open) => !open && setReviewEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('market.reviewInstallTitle', { name: reviewEntry ? getPluginMarketText(reviewEntry, locale).name : '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('market.reviewInstallDesc')}</AlertDialogDescription>
          </AlertDialogHeader>

          {reviewEntry && reviewRelease ? (
            <div className="grid max-h-[min(55vh,32rem)] gap-4 overflow-y-auto text-sm">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">{t('details.author')}</dt>
                <dd>{reviewEntry.author}</dd>
                <dt className="text-muted-foreground">{t('market.publisher')}</dt>
                <dd>{reviewPublisher?.name ?? reviewEntry.publisherId}</dd>
                <dt className="text-muted-foreground">{t('market.publisherKey')}</dt>
                <dd className="truncate" title={reviewPublisher?.keyId}><code>{reviewPublisher?.keyId ?? '—'}</code></dd>
                <dt className="text-muted-foreground">{t('market.license')}</dt>
                <dd>{reviewEntry.license ?? t('details.unknown')}</dd>
                <dt className="text-muted-foreground">{t('details.apiVersion')}</dt>
                <dd><code>{reviewRelease.apiVersion}</code></dd>
                <dt className="text-muted-foreground">{t('details.minAppVersion')}</dt>
                <dd><code>{reviewRelease.minAppVersion}</code></dd>
                <dt className="text-muted-foreground">{t('market.packageDigest')}</dt>
                <dd className="truncate" title={reviewRelease.packageSha256}><code>{reviewRelease.packageSha256}</code></dd>
              </dl>

              <div className="flex flex-col gap-2">
                <h4 className="font-medium">{t('details.permissions')}</h4>
                <div className="flex flex-wrap gap-1.5">
                  {reviewPermissions.length > 0
                    ? reviewPermissions.map((permission) => (
                        <Badge key={permission} variant="outline">{t(`permissionNames.${permission}`)}</Badge>
                      ))
                    : <span className="text-muted-foreground">{t('market.noPermissions')}</span>}
                </div>
              </div>

              {(reviewEntry.repository || reviewEntry.homepage) ? (
                <div className="flex flex-wrap gap-2">
                  {reviewEntry.repository ? (
                    <Button variant="outline" size="sm" onClick={() => openExternal(reviewEntry.repository ?? '')}>
                      <ExternalLink data-icon="inline-start" />{t('market.sourceCode')}
                    </Button>
                  ) : null}
                  {reviewEntry.homepage ? (
                    <Button variant="outline" size="sm" onClick={() => openExternal(reviewEntry.homepage ?? '')}>
                      <ExternalLink data-icon="inline-start" />{t('market.homepage')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={catalog?.stale || !reviewEntry || !reviewRelease || Boolean(operationPluginId)}
              onClick={() => {
                if (reviewEntry) void handleInstall(reviewEntry)
              }}
            >
              <PackagePlus data-icon="inline-start" />{t('actions.install')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

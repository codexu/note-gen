'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  BadgeCheck,
  Download,
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PluginMarketEntry } from '@/lib/plugins/types'
import { compareSemver } from '@/lib/plugins/manifest'
import { usePluginStore } from '@/stores/plugins'
import useSettingStore from '@/stores/setting'
import { formatPluginDate, getLatestDesktopRelease, getPluginDownloads, getPluginMarketText, getPluginUpdatedAt } from './plugin-display'

const sortOptions = ['downloads', 'updated', 'name'] as const
type MarketSort = typeof sortOptions[number]
const categoryKeys = ['appearance', 'development', 'diagrams', 'editor', 'journaling', 'language', 'navigation', 'productivity', 'statistics'] as const

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

export function MarketplaceTab({ query, onQueryChange, onInstalled, installPluginId, onInstallRequestHandled }: {
  query: string
  onQueryChange: (value: string) => void
  onInstalled?: (pluginId: string) => void
  installPluginId?: string | null
  onInstallRequestHandled?: () => void
}) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const catalog = usePluginStore((state) => state.catalog)
  const installed = usePluginStore((state) => state.installed)
  const marketLoading = usePluginStore((state) => state.marketLoading)
  const marketError = usePluginStore((state) => state.marketError)
  const statistics = usePluginStore((state) => state.marketStatistics)
  const statisticsLoading = usePluginStore((state) => state.statisticsLoading)
  const statisticsError = usePluginStore((state) => state.statisticsError)
  const operationPluginId = usePluginStore((state) => state.operationPluginId)
  const appVersion = useSettingStore((state) => state.version)
  const refreshMarket = usePluginStore((state) => state.refreshMarket)
  const installFromMarket = usePluginStore((state) => state.installFromMarket)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [reviewEntry, setReviewEntry] = useState<PluginMarketEntry | null>(null)
  const [sort, setSort] = useState<MarketSort>('downloads')
  const [category, setCategory] = useState('*')
  const categories = useMemo(() => [...new Set(catalog?.plugins.flatMap(plugin => plugin.categories ?? []) ?? [])].sort(), [catalog])
  const activeCategory = categories.includes(category) ? category : '*'
  const categoryLabel = (value: string) => {
    const key = categoryKeys.find(key => key === value)
    return key ? t(`market.categories.${key}`) : value
  }
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale])

  const installedById = useMemo(
    () => new Map(installed.map((plugin) => [plugin.manifest.id, plugin])),
    [installed],
  )
  const plugins = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return [...(catalog?.plugins ?? [])]
      .map(plugin => ({ ...plugin, ...getPluginMarketText(plugin, locale) }))
      .filter((plugin) => {
        if (activeCategory !== '*' && !plugin.categories?.includes(activeCategory)) return false
        if (!normalizedQuery) return true
        return [
          plugin.name,
          plugin.description,
          plugin.author,
          plugin.id,
          ...Object.values(plugin.localizations ?? {}).flatMap(text => [text.name, text.description]),
          ...(plugin.categories ?? []),
          ...(plugin.categories ?? []).map(value => {
            const key = categoryKeys.find(key => key === value)
            return key ? t(`market.categories.${key}`) : value
          }),
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
      })
      .sort((left, right) => {
        const byName = left.name.localeCompare(right.name, locale) || left.id.localeCompare(right.id)
        if (sort === 'downloads') return (getPluginDownloads(right, statistics) ?? -1) - (getPluginDownloads(left, statistics) ?? -1) || byName
        if (sort === 'updated') return getPluginUpdatedAt(right) - getPluginUpdatedAt(left) || byName
        return byName
      })
  }, [catalog?.plugins, query, locale, activeCategory, sort, statistics, t])

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

  useEffect(() => {
    if (!installPluginId || marketLoading) return
    const entry = catalog?.plugins.find((plugin) => plugin.id === installPluginId)
    if (catalog && entry && getLatestDesktopRelease(entry, appVersion) && !catalog.stale && !installedById.has(entry.id)) setReviewEntry(entry)
    onInstallRequestHandled?.()
  }, [appVersion, catalog, installPluginId, installedById, marketLoading, onInstallRequestHandled])

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
        refreshing={marketLoading || statisticsLoading}
        disabled={Boolean(operationPluginId)}
        onRefresh={() => void refreshMarket(true)}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" size="sm" value={activeCategory} onValueChange={value => setCategory(value || '*')} className="max-w-full flex-wrap" aria-label={t('market.categoryLabel')}>
          <ToggleGroupItem value="*">{t('market.allCategories')}</ToggleGroupItem>
          {categories.map(value => <ToggleGroupItem key={value} value={value}>{categoryLabel(value)}</ToggleGroupItem>)}
        </ToggleGroup>
        <Select value={sort} onValueChange={value => {
          const next = sortOptions.find(option => option === value)
          if (next) setSort(next)
        }}>
          <SelectTrigger size="sm" aria-label={t('market.sortLabel')}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            {sortOptions.map(value => <SelectItem key={value} value={value}>{t(`market.sort.${value}`)}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
      </div>
      {!statistics || statistics.stale || statisticsError ? (
        <p className="text-xs text-muted-foreground" role="status">
          {statistics
            ? t('market.statisticsCached', { date: formatPluginDate(statistics.updatedAt, locale) })
            : t(statisticsLoading ? 'market.statisticsLoading' : 'market.statisticsUnavailable')}
        </p>
      ) : null}
      {statisticsError ? (
        <Alert variant="warning">
          <WifiOff />
          <AlertTitle>{t('market.statisticsUnavailable')}</AlertTitle>
          <AlertDescription>{statisticsError}</AlertDescription>
        </Alert>
      ) : null}

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
            const displayedRelease = release ?? [...entry.releases]
              .filter(candidate => candidate.revoked === undefined && candidate.platforms.includes('desktop'))
              .sort((left, right) => compareSemver(right.version, left.version))[0]
            const installedPlugin = installedById.get(entry.id)
            const busy = operationPluginId === entry.id
            const downloads = getPluginDownloads(entry, statistics)
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
                    aria-label={(catalog?.stale || !release) && displayedRelease
                      ? `${entry.name}: ${t('details.minAppVersion')} ${displayedRelease.minAppVersion}`
                      : t('market.installAria', { name: entry.name })}
                  >
                    {busy ? <Spinner data-icon="inline-start" /> : <PackagePlus data-icon="inline-start" />}
                    {catalog?.stale || !release
                      ? displayedRelease
                        ? `NoteGen ≥ ${displayedRelease.minAppVersion}`
                        : t('market.unavailable')
                      : installedPlugin
                        ? t('actions.installed')
                        : busy
                          ? t('actions.installing')
                          : t('actions.install')}
                  </Button>
                </ItemActions>
                <ItemFooter className="justify-start border-t pt-2 text-xs text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex items-center gap-1">
                        <Download className="size-3.5" aria-hidden />
                        {downloads === null ? t('market.downloadsUnknown') : t('market.downloadsCount', { count: numberFormat.format(downloads) })}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{t('market.downloadsDescription')}</TooltipContent>
                  </Tooltip>
                  <span>{t('market.permissionsCount', { count: (release?.permissions ?? entry.permissions).length })}</span>
                  {entry.categories?.map((category) => (
                    <Badge key={category} asChild variant={activeCategory === category ? 'secondary' : 'outline'}>
                      <button type="button" aria-pressed={activeCategory === category} onClick={() => setCategory(activeCategory === category ? '*' : category)}>{categoryLabel(category)}</button>
                    </Badge>
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
            <EmptyTitle>{query || activeCategory !== '*' ? t('market.noResults') : t('market.empty')}</EmptyTitle>
            <EmptyDescription>{query || activeCategory !== '*' ? t('market.noResultsDesc') : t('market.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
          {query || activeCategory !== '*' ? <Button variant="outline" size="sm" onClick={() => { onQueryChange(''); setCategory('*') }}>{t('market.clearFilters')}</Button> : null}
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

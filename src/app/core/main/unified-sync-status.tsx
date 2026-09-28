'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import emitter from '@/lib/emitter'
import { cn } from '@/lib/utils'
import {
  getAutoDataSyncState,
  subscribeAutoDataSyncState,
  type AutoDataSyncDomain,
  type AutoDataSyncState,
} from '@/lib/sync/auto-data-sync-queue'
import useSettingStore from '@/stores/setting'
import { useSyncAvailability } from './file/use-sync-availability'

type ItemStatus = 'idle' | 'syncing' | 'success' | 'failed'
type SyncType = 'markdown' | AutoDataSyncDomain

interface LastSuccess {
  types: SyncType[]
  at: number
}

function formatSyncTime(timestamp: number, locale: string) {
  return new Date(timestamp).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}

export function UnifiedSyncStatus() {
  const t = useTranslations('syncOverview')
  const locale = useLocale()
  const method = useSettingStore(state => state.primaryBackupMethod)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const availability = useSyncAvailability()
  const [dataState, setDataState] = useState<AutoDataSyncState>(getAutoDataSyncState)
  const [fileStatus, setFileStatus] = useState<ItemStatus>('idle')
  const [lastSuccess, setLastSuccess] = useState<LastSuccess | null>(null)
  const activeDomains = useRef<AutoDataSyncDomain[]>([])
  const lastCompletedAt = useRef(dataState.lastCompletedAt)

  useEffect(() => subscribeAutoDataSyncState(setDataState), [])

  useEffect(() => {
    setFileStatus('idle')
    setLastSuccess(null)
    activeDomains.current = []
    lastCompletedAt.current = dataState.lastCompletedAt
  }, [method, workspacePath])

  useEffect(() => {
    function started() {
      setFileStatus('syncing')
    }
    function completed({ success }: { path: string; success: boolean }) {
      const completedAt = success ? Date.now() : null
      setFileStatus(success ? 'success' : 'failed')
      if (completedAt) {
        setLastSuccess(current => !current || completedAt >= current.at
          ? { types: ['markdown'], at: completedAt }
          : current)
      }
    }
    emitter.on('sync-push-started', started)
    emitter.on('sync-push-completed', completed)
    return () => {
      emitter.off('sync-push-started', started)
      emitter.off('sync-push-completed', completed)
    }
  }, [])

  useEffect(() => {
    if (dataState.phase === 'queued' || dataState.phase === 'uploading' || dataState.phase === 'downloading') {
      activeDomains.current = Array.from(new Set([...activeDomains.current, ...dataState.affectedDomains]))
    } else if (dataState.lastCompletedAt && dataState.lastCompletedAt !== lastCompletedAt.current && activeDomains.current.length) {
      const finished = activeDomains.current
      activeDomains.current = []
      const completedAt = dataState.lastCompletedAt
      setLastSuccess(current => !current || completedAt >= current.at
        ? { types: finished, at: completedAt }
        : current)
    }
    lastCompletedAt.current = dataState.lastCompletedAt
  }, [dataState.phase, dataState.lastCompletedAt, dataState.affectedDomains])

  const dataFailed = dataState.phase === 'failed' || dataState.phase === 'conflict'
  const dataSyncing = dataState.phase === 'queued'
    || dataState.phase === 'uploading'
    || dataState.phase === 'downloading'
    || dataState.phase === 'checking_remote'
  const currentStatus = method === 'local' ? t('localOnly')
    : availability.status === 'not-configured' ? t('notConfigured')
    : availability.status === 'unavailable' ? t('unavailable')
      : fileStatus === 'failed' || dataFailed ? t('failed')
        : availability.status === 'checking' ? t('checking')
          : fileStatus === 'syncing' || dataSyncing ? t('syncing')
            : lastSuccess ? t('synced') : t('ready')
  const lightClassName = method === 'local' || availability.status === 'not-configured' ? 'bg-muted-foreground/50'
    : availability.status === 'unavailable' || fileStatus === 'failed' || dataFailed ? 'bg-destructive'
      : availability.status === 'checking' || fileStatus === 'syncing' || dataSyncing ? 'bg-warning animate-pulse'
        : 'bg-emerald-500'
  const recentSync = lastSuccess
    ? t('recentlySynced', {
      type: lastSuccess.types.map(type => t(type)).join(t('typeSeparator')),
      time: formatSyncTime(lastSuccess.at, locale),
    })
    : t('noActivity')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="status" aria-label={`${t('title')}：${currentStatus}。${recentSync}`} className="flex size-6 shrink-0 items-center justify-center">
          <span aria-hidden="true" className={cn('size-2 rounded-full', lightClassName)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex max-w-72 flex-col gap-1">
        <p className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('title')}</span>
          <span className="font-medium">{currentStatus}</span>
        </p>
        <p className="text-xs text-muted-foreground">{recentSync}</p>
      </TooltipContent>
    </Tooltip>
  )
}

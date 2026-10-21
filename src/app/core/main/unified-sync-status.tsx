'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import { getSyncPushQueue } from '@/lib/sync/sync-push-queue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import emitter from '@/lib/emitter'
import { formatSyncDataError } from '@/lib/sync/remote-file'
import { cn } from '@/lib/utils'
import {
  getAutoDataSyncState,
  retryAutoDataSync,
  subscribeAutoDataSyncState,
  type AutoDataSyncDomain,
  type AutoDataSyncState,
} from '@/lib/sync/auto-data-sync-queue'
import useSettingStore from '@/stores/setting'
import { useSyncAvailability } from './file/use-sync-availability'
import { usePlatformSwitchStore, retryPlatformSwitch, restorePlatformSwitchRecovery } from '@/stores/sync-platform-switch'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

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
  const p = useTranslations('settings.sync.switchPlan')
  const switchStep = usePlatformSwitchStore(state => state.platform ? state.step : null)
  const switchError = usePlatformSwitchStore(state => state.error)
  const switchSkipped = usePlatformSwitchStore(state => state.skipped)
  const locale = useLocale()
  const method = useSettingStore(state => state.primaryBackupMethod)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const availability = useSyncAvailability()
  const [dataState, setDataState] = useState<AutoDataSyncState>(getAutoDataSyncState)
  const [fileStatus, setFileStatus] = useState<ItemStatus>('idle')
  const [lastSuccess, setLastSuccess] = useState<LastSuccess | null>(null)
  const [directoryError, setDirectoryError] = useState('')
  const [errorMessages, setErrorMessages] = useState<string[]>([])
  const [engineFailed, setEngineFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const retryingRef = useRef(false)
  const failedFiles = useRef(new Set<string>())
  const failedDirectories = useRef(new Map<string, string>())
  const activeFiles = useRef(new Set<string>())
  const notifiedErrors = useRef(new Set<string>())
  const failureToast = useRef<ReturnType<typeof toast> | null>(null)
  const retryAction = useRef<() => Promise<void>>(async () => {})
  const activeDomains = useRef<AutoDataSyncDomain[]>([])
  const lastCompletedAt = useRef(dataState.lastCompletedAt)

  const notifyFailure = useCallback((rawMessage: string) => {
    const messages = rawMessage.split('\n').filter(Boolean).map(item => formatSyncDataError(item, p))
    const fresh = messages.filter(message => !notifiedErrors.current.has(message))
    if (!fresh.length) return
    fresh.forEach(message => notifiedErrors.current.add(message))
    const errors = [...notifiedErrors.current]
    setErrorMessages(errors)
    const options = {
      title: t('failedCount', { count: errors.length }),
      description: (
        <ol tabIndex={0} aria-label={t('failed')} className="flex max-h-48 list-decimal flex-col gap-2 overflow-y-auto overscroll-contain pl-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {errors.map(error => <li key={error}>{error}</li>)}
        </ol>
      ),
      variant: 'destructive' as const,
      duration: Infinity,
      closeButton: true,
      classNames: { content: 'min-w-0 flex-1', description: 'w-full' },
      action: { label: t('retry'), onClick: () => void retryAction.current() },
    }
    if (failureToast.current) failureToast.current.update(options)
    else failureToast.current = toast(options)
  }, [t, p])

  useEffect(() => subscribeAutoDataSyncState(setDataState), [])
  useEffect(() => { void restorePlatformSwitchRecovery() }, [])
  useEffect(() => {
    failedFiles.current.clear()
    failedDirectories.current.clear()
    activeFiles.current.clear()
    notifiedErrors.current.clear()
    setErrorMessages([])
    failureToast.current?.dismiss()
    failureToast.current = null
    setDirectoryError('')
    setEngineFailed(false)
    setFileStatus('idle')
    setLastSuccess(null)
    activeDomains.current = []
    lastCompletedAt.current = dataState.lastCompletedAt
  }, [method, workspacePath])

  useEffect(() => {
    if (switchStep !== 'error') return
    const special = switchError === 'SYNC_SWITCH_STALE' ? 'stale' : switchError === 'SYNC_SWITCH_INTERRUPTED' ? 'interrupted' : switchError === 'SYNC_SWITCH_EDITOR_BUSY' ? 'editorBusy' : switchError === 'SYNC_SWITCH_CHAT_BUSY' ? 'chatBusy' : switchError === 'SYNC_SWITCH_MISSING_REFERENCE' ? 'missingReference' : switchError === 'SYNC_SWITCH_UNAVAILABLE_REMOTE_DATA' ? 'unavailableRemoteData' : null
    notifyFailure(special ? p(special) : switchError || p('failed'))
  }, [switchStep, switchError, method, workspacePath, notifyFailure, p])

  useEffect(() => {
    function started({ path }: { path: string }) {
      activeFiles.current.add(path)
      setFileStatus(failedFiles.current.size ? 'failed' : 'syncing')
    }
    function completed({ path, success }: { path: string; success: boolean }) {
      activeFiles.current.delete(path)
      if (success) failedFiles.current.delete(path)
      else {
        failedFiles.current.add(path)
        notifyFailure(t('fileFailed', { path }))
      }
      const completedAt = success ? Date.now() : null
      setFileStatus(failedFiles.current.size ? 'failed' : activeFiles.current.size ? 'syncing' : 'success')
      if (completedAt) {
        setLastSuccess(current => !current || completedAt >= current.at
          ? { types: ['markdown'], at: completedAt }
          : current)
      }
    }
    function directoryCompleted(event: {
      path: string; workspacePath: string; provider: string; success: boolean; error?: string
    }) {
      const current = useSettingStore.getState()
      const currentPath = current.workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
      if (event.workspacePath !== currentPath || event.provider !== current.primaryBackupMethod) return
      if (event.success) failedDirectories.current.delete(event.path)
      else {
        const message = event.error || t('failed')
        failedDirectories.current.set(event.path, message)
        notifyFailure(message)
      }
      setDirectoryError(failedDirectories.current.values().next().value || '')
    }
    function engineCompleted({ provider, errors }: { provider: 'selfHosted'; errors: string[] }) {
      if (useSettingStore.getState().primaryBackupMethod !== provider) return
      setEngineFailed(errors.length > 0)
      for (const error of errors) notifyFailure(error)
    }
    emitter.on('sync-engine-completed', engineCompleted)
    emitter.on('sync-directory-completed', directoryCompleted)
    emitter.on('sync-push-started', started)
    emitter.on('sync-push-completed', completed)
    return () => {
      emitter.off('sync-engine-completed', engineCompleted)
      emitter.off('sync-directory-completed', directoryCompleted)
      emitter.off('sync-push-started', started)
      emitter.off('sync-push-completed', completed)
    }
  }, [notifyFailure, t])

  useEffect(() => {
    if (dataState.phase === 'failed' || dataState.phase === 'conflict') {
      notifyFailure(dataState.lastError || t('failed'))
    }
  }, [dataState.phase, dataState.lastError, notifyFailure, t])

  const retrySync = useCallback(async () => {
    if (retryingRef.current) return
    retryingRef.current = true
    setRetrying(true)
    notifiedErrors.current.clear()
    setErrorMessages([])
    failureToast.current?.dismiss()
    failureToast.current = null
    const isCurrent = () => {
      const current = useSettingStore.getState()
      return current.primaryBackupMethod === method && current.workspacePath === workspacePath
    }
    try {
      await restorePlatformSwitchRecovery()
      const switching = usePlatformSwitchStore.getState()
      if (switching.platform) {
        useSettingsDialogStore.getState().openSettings('sync')
        if (switching.step === 'error' || switching.step === 'cancelled' || switching.skipped) await retryPlatformSwitch()
        return
      }
      if (method === 'local') return
      const configuration = await availability.refresh()
      if (!isCurrent()) return
      if (!configuration.configured) throw new Error(t('notConfigured'))
      if (method === 'selfHosted') {
        const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
        if (isCurrent()) await getSelfHostedSyncRuntime().wake('manual-retry')
        return
      }
      const directories = [...failedDirectories.current.keys()]
      const files = [...failedFiles.current]
      const domains = getAutoDataSyncState()
      const operations: Promise<unknown>[] = []
      if (directories.length === 0) operations.push(useArticleStore.getState().loadRemoteSyncFiles())
      else for (const path of directories) {
        operations.push(path
          ? useArticleStore.getState().loadFolderRemoteFiles(path)
          : useArticleStore.getState().loadRemoteSyncFiles())
      }
      if (files.length) operations.push(getSyncPushQueue().retry(files))
      if (domains.phase === 'failed' || domains.phase === 'conflict') {
        // 使用现有重试和冲突检查，不强制覆盖本地或远端数据。
        if (isCurrent()) operations.push(retryAutoDataSync())
      }
      const results = await Promise.allSettled(operations)
      if (!isCurrent()) return
      for (const result of results) {
        if (result.status === 'rejected') {
          notifyFailure(result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
      }
    } catch (error) {
      if (isCurrent()) notifyFailure(error instanceof Error ? error.message : String(error))
    } finally {
      retryingRef.current = false
      setRetrying(false)
    }
  }, [availability.refresh, method, workspacePath, notifyFailure, t])

  useEffect(() => { retryAction.current = retrySync }, [retrySync])
  useEffect(() => () => { failureToast.current?.dismiss() }, [])

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
  const hasFailure = switchStep === 'error' || fileStatus === 'failed' || dataFailed || Boolean(directoryError) || engineFailed
  const switchBusy = switchStep !== null && !['error', 'cancelled', 'review', 'confirm', 'completed'].includes(switchStep)
  useEffect(() => {
    if (hasFailure && !switchSkipped) return
    notifiedErrors.current.clear()
    setErrorMessages([])
    failureToast.current?.dismiss()
    failureToast.current = null
  }, [hasFailure, switchSkipped])

  const currentStatus = switchSkipped ? p('skipped') : switchStep === 'cancelled' ? p('cancelled') : switchStep === 'error' ? t('failed') : switchBusy ? t('syncing') : switchStep === 'review' || switchStep === 'confirm' ? p('choose') : method === 'local' ? t('localOnly')
    : retrying ? t('syncing')
    : availability.status === 'not-configured' ? t('notConfigured')
    : availability.status === 'unavailable' ? t('unavailable')
      : hasFailure ? t('failed')
        : availability.status === 'checking' ? t('checking')
          : fileStatus === 'syncing' || dataSyncing ? t('syncing')
            : lastSuccess ? t('synced') : t('ready')
  const lightClassName = switchSkipped || switchStep === 'cancelled' ? 'bg-warning' : switchStep === 'error' ? 'bg-destructive' : switchBusy ? 'bg-warning animate-pulse' : method === 'local' || availability.status === 'not-configured' ? 'bg-muted-foreground/50'
    : retrying ? 'bg-warning animate-pulse'
    : availability.status === 'unavailable' || hasFailure ? 'bg-destructive'
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
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`${t('title')}：${currentStatus}。${recentSync}。${t('retry')}`}
          aria-disabled={retrying || (!switchStep && !switchSkipped && (method === 'local' || availability.status === 'not-configured'))}
          aria-busy={retrying}
          onClick={() => {
            if (switchStep || switchSkipped || (method !== 'local' && availability.status !== 'not-configured')) void retrySync()
          }}
        >
          <span aria-hidden="true" className={cn('size-2 rounded-full', lightClassName)} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex max-w-72 flex-col gap-1">
        <p className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('title')}</span>
          <span className="font-medium">{currentStatus}</span>
        </p>
        <p className="text-xs text-muted-foreground">{recentSync}</p>
        {errorMessages.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1">
            <p>{t('failedCount', { count: errorMessages.length })}</p>
            <ol tabIndex={0} aria-label={t('failed')} className="flex max-h-48 list-decimal flex-col gap-2 overflow-y-auto overscroll-contain pl-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {errorMessages.map(error => <li key={error}>{error}</li>)}
            </ol>
          </div>
        )}
        {method !== 'local' && availability.configured && <p className="text-xs">{t('retryHint')}</p>}
      </TooltipContent>
    </Tooltip>
  )
}

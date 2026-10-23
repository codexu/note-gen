'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronUp, CircleAlert, Clock3, CloudAlert, CloudCheck, HardDrive, LoaderCircle, RefreshCw, Settings2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import { getSyncPushQueue } from '@/lib/sync/sync-push-queue'
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
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import { useDocumentSyncStore } from '@/stores/document-sync'
import { useSyncAvailability } from './file/use-sync-availability'
import { usePlatformSwitchStore, retryPlatformSwitch, restorePlatformSwitchRecovery } from '@/stores/sync-platform-switch'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { SYNC_PLATFORM_INFO } from '@/types/sync'
import { DocumentSyncPanel } from './document-sync-panel'

type ItemStatus = 'idle' | 'syncing' | 'success' | 'failed'
type SyncType = 'markdown' | AutoDataSyncDomain

interface LastSuccess {
  types: SyncType[]
  at: number
}

const STATUS_APPEARANCE = {
  success: { icon: CloudCheck, surface: 'bg-success/10 text-success-foreground', light: 'bg-success' },
  warning: { icon: CloudAlert, surface: 'bg-warning/10 text-warning-foreground', light: 'bg-warning' },
  error: { icon: CloudAlert, surface: 'bg-destructive/10 text-destructive', light: 'bg-destructive' },
  busy: { icon: LoaderCircle, surface: 'bg-muted text-muted-foreground', light: 'bg-warning animate-pulse' },
  neutral: { icon: HardDrive, surface: 'bg-muted text-muted-foreground', light: 'bg-muted-foreground/50' },
}

function formatSyncTime(timestamp: number, locale: string) {
  return new Date(timestamp).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}

export function UnifiedSyncStatus() {
  const settingsStatus = useSettingsHydrationStore(state => state.status)
  const settingsReady = settingsStatus === 'ready'
  const t = useTranslations('syncOverview')
  const tSync = useTranslations('settings.sync')
  const p = useTranslations('settings.sync.switchPlan')
  const switchStep = usePlatformSwitchStore(state => state.platform ? state.step : null)
  const switchError = usePlatformSwitchStore(state => state.error)
  const switchSkipped = usePlatformSwitchStore(state => state.skipped)
  const locale = useLocale()
  const method = useSettingStore(state => state.primaryBackupMethod)
  const autoSync = useSettingStore(state => state.autoSync)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const registeredDocument = useDocumentSyncStore(state => state.document)
  const currentDocument = registeredDocument?.path === activeFilePath
    && registeredDocument.workspacePath === workspacePath && registeredDocument.provider === method
    ? registeredDocument : null
  const repository = useSettingStore(state => {
    switch (state.primaryBackupMethod) {
      case 'github': return state.githubCustomSyncRepo.trim()
      case 'gitee': return state.giteeCustomSyncRepo.trim()
      case 'gitlab': return state.gitlabCustomSyncRepo.trim()
      case 'gitea': return state.giteaCustomSyncRepo.trim()
      default: return null
    }
  })
  const missingRepository = Boolean(workspacePath && repository === '')
  const configureLabel = useTranslations('settings.sync.workspaceConnection')('configure')
  const availability = useSyncAvailability()
  const [open, setOpen] = useState(false)
  const popoverTitleId = useId()
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
      duration: 5000,
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
    setOpen(false)
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
    function pulled({ path }: { path: string }) {
      completed({ path, success: true })
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
    emitter.on('sync-pulled', pulled)
    return () => {
      emitter.off('sync-engine-completed', engineCompleted)
      emitter.off('sync-directory-completed', directoryCompleted)
      emitter.off('sync-push-started', started)
      emitter.off('sync-push-completed', completed)
      emitter.off('sync-pulled', pulled)
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
        setOpen(false)
        useSettingsDialogStore.getState().openSettings('sync')
        if (switching.step === 'error' || switching.step === 'cancelled' || switching.skipped) await retryPlatformSwitch()
        return
      }
      if (method === 'local') return
      const document = useDocumentSyncStore.getState().document
      const configuration = await availability.refresh()
      if (!isCurrent()) return
      if (!configuration.configured) throw new Error(t('notConfigured'))
      if (document?.phase === 'error' && document.path === useArticleStore.getState().activeFilePath
        && document.workspacePath === workspacePath && document.provider === method) {
        await document.sync()
        if (!isCurrent()) return
      }
      if (method === 'selfHosted') {
        const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
        if (isCurrent()) await getSelfHostedSyncRuntime().wake('manual-retry')
        return
      }
      const { retryWorkspacePathMoves } = await import('@/lib/sync/workspace-path-moves')
      await retryWorkspacePathMoves()
      if (!isCurrent()) return
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
    || currentDocument?.phase === 'error'
  const switchBusy = switchStep !== null && !['error', 'cancelled', 'review', 'confirm', 'completed'].includes(switchStep)
  useEffect(() => {
    if (hasFailure && !switchSkipped) return
    notifiedErrors.current.clear()
    setErrorMessages([])
    failureToast.current?.dismiss()
    failureToast.current = null
  }, [hasFailure, switchSkipped])

  const currentStatus = availability.configurationFailed ? t('configurationFailed') : !settingsReady ? t('checking') : switchSkipped ? p('skipped') : switchStep === 'cancelled' ? p('cancelled') : switchStep === 'error' ? t('failed') : switchBusy ? t('syncing') : switchStep === 'review' || switchStep === 'confirm' ? p('choose') : method === 'local' ? t('localOnly')
    : retrying ? t('syncing')
    : availability.status === 'checking' ? t('checking')
    : missingRepository ? t('missingRepository')
    : availability.status === 'not-configured' ? t('notConfigured')
    : availability.status === 'unavailable' ? t('unavailable')
      : hasFailure ? t('failed')
        : currentDocument?.phase === 'conflict' ? t('document.conflict')
          : currentDocument?.phase === 'update-available' ? t('document.update')
            : fileStatus === 'syncing' || dataSyncing || currentDocument?.phase === 'syncing' ? t('syncing')
              : currentDocument?.phase === 'checking' ? t('checking')
                : lastSuccess ? t('synced') : t('ready')
  const switchNeedsReview = switchStep === 'review' || switchStep === 'confirm'
  const statusTone = availability.configurationFailed ? 'error' : !settingsReady ? 'busy' : switchSkipped || switchStep === 'cancelled' || switchNeedsReview ? 'warning' : switchStep === 'error' ? 'error' : switchBusy ? 'busy' : method === 'local' ? 'neutral'
    : availability.status === 'checking' ? 'busy'
    : missingRepository || availability.status === 'not-configured' ? 'warning'
    : retrying ? 'busy'
    : availability.status === 'unavailable' || hasFailure ? 'error'
      : currentDocument?.phase === 'conflict' || currentDocument?.phase === 'update-available' ? 'warning'
        : fileStatus === 'syncing' || dataSyncing || currentDocument?.phase === 'syncing' || currentDocument?.phase === 'checking' ? 'busy'
          : 'success'
  const appearance = STATUS_APPEARANCE[statusTone]
  const StatusIcon = appearance.icon
  const providerLabel = method === 'local' || method === 'cloudFolder' || method === 'selfHosted'
    ? tSync(`${method}.title`)
    : SYNC_PLATFORM_INFO[method].name
  const opensConfiguration = settingsReady && availability.status !== 'checking' && !switchStep && !switchSkipped
    && (method === 'local' || missingRepository || availability.status === 'not-configured'
      || availability.reason === 'reauthentication-required')
  const canRetry = settingsReady && (availability.status !== 'checking' || retrying) && !opensConfiguration && !switchBusy && !switchNeedsReview
    && (hasFailure || switchSkipped || switchStep === 'cancelled' || availability.status === 'unavailable' || retrying)

  function openSyncSettings() {
    setOpen(false)
    useSettingsDialogStore.getState().openSettings('sync')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={`${t('title')}: ${currentStatus}`}
        >
          <span aria-hidden="true" className={cn('size-2 rounded-full', appearance.light)} />
          <span>{currentStatus}</span>
          <ChevronUp data-icon="inline-end" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        aria-labelledby={popoverTitleId}
        className="max-h-(--radix-popover-content-available-height) w-88 max-w-[calc(100vw-1rem)] gap-4 overflow-y-auto overscroll-contain p-4"
      >
        <div className="flex items-start gap-3">
          <div aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', appearance.surface)}>
            <StatusIcon className={cn('size-5', statusTone === 'busy' && 'animate-spin')} />
          </div>
          <PopoverHeader className="min-w-0 flex-1 gap-1">
            <PopoverTitle id={popoverTitleId} role="status">{currentStatus}</PopoverTitle>
            {settingsReady && method !== 'local' && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span title={repository ? `${providerLabel} · ${repository}` : providerLabel}>{providerLabel}</span>
              {availability.configured && method !== 'selfHosted' && <>
                <span aria-hidden="true">·</span>
                <span>{t(autoSync === 'disabled' ? 'document.autoDisabled' : 'document.autoEnabled')}</span>
              </>}
            </div>}
          </PopoverHeader>
          {settingsReady && <Button type="button" variant="ghost" size="icon-sm"
            aria-label={t('openSettings')} title={t('openSettings')} onClick={openSyncSettings}>
            <Settings2 aria-hidden="true" />
          </Button>}
        </div>

        {settingsReady && method === 'local' && <PopoverDescription>{t('localOnlyDescription')}</PopoverDescription>}
        {settingsReady && method === 'selfHosted' && <PopoverDescription>{t('selfHostedConnection')}</PopoverDescription>}

        {errorMessages.length > 0 && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t('failedCount', { count: errorMessages.length })}</AlertTitle>
            <AlertDescription className="min-w-0">
              <ol tabIndex={0} aria-label={t('failed')} className="flex max-h-36 list-decimal flex-col gap-2 overflow-y-auto overscroll-contain pl-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {errorMessages.map(error => <li key={error}>{error}</li>)}
              </ol>
            </AlertDescription>
          </Alert>
        )}

        {settingsReady && currentDocument && <DocumentSyncPanel
          document={currentDocument}
          disabled={availability.status !== 'available' || (switchStep !== null && switchStep !== 'completed') || switchSkipped}
          onBeforeAction={() => setOpen(false)}
          summaryStatus={currentStatus}
        />}

        {settingsReady && (method !== 'local' && method !== 'selfHosted' || opensConfiguration || switchNeedsReview || canRetry) && <>
          <Separator />
          <div className="flex flex-col gap-3">
            {method !== 'local' && method !== 'selfHosted' && <div
              className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
              title={lastSuccess ? lastSuccess.types.map(type => t(type)).join(t('typeSeparator')) : undefined}
            >
              <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t(lastSuccess ? 'lastSuccess' : 'noActivity')}</span>
              {lastSuccess && <time dateTime={new Date(lastSuccess.at).toISOString()} className="shrink-0 tabular-nums">
                {formatSyncTime(lastSuccess.at, locale)}
              </time>}
            </div>}
            {(opensConfiguration || switchNeedsReview || canRetry) && <div className="flex flex-wrap items-center gap-2">
              {(opensConfiguration || switchNeedsReview) && <Button type="button" size="sm" className="flex-1" onClick={openSyncSettings}>
                <Settings2 data-icon="inline-start" aria-hidden="true" />
                {switchNeedsReview ? t('continueSetup') : configureLabel}
              </Button>}
              {canRetry && <Button type="button" variant="outline" size="sm" className="flex-1"
                disabled={retrying} aria-busy={retrying} onClick={() => void retrySync()}>
                <RefreshCw data-icon="inline-start" aria-hidden="true" className={cn(retrying && 'animate-spin')} />
                {retrying ? t('syncing') : t('retry')}
              </Button>}
            </div>}
          </div>
        </>}
      </PopoverContent>
    </Popover>
  )
}

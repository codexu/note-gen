'use client'

import { useEffect, useRef, useState } from 'react'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import { Store } from '@tauri-apps/plugin-store'
import { CircleCheck, Cloud, CloudDownload, Copy, CopyCheck, ExternalLink, FolderSync, LogIn, LogOut, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import {
  releaseAndroidSyncFolder,
  releaseIOSSyncFolder,
  setIOSWorkspaceFolderAccess,
  testCloudFolderConnection,
} from '@/lib/sync/cloud-folder'
import {
  connectOneDrive,
  disconnectOneDrive,
  logOneDriveTiming,
  ONE_DRIVE_CLIENT_ID,
  type OneDriveLoginCode,
} from '@/lib/sync/onedrive'
import {
  prepareOneDriveWorkspace,
  type OneDriveWorkspacePreparation,
  type OneDriveWorkspaceStrategy,
} from '@/lib/sync/onedrive-workspace'
import {
  listLocalLibraryFiles,
  pullAllRemoteLibraryFiles,
  uploadAllLocalLibraryFiles,
  uploadLocalLibraryFile,
} from '@/lib/sync/remote-library'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { useSkillsStore } from '@/stores/skills'
import useSyncStore from '@/stores/sync'
import { toast } from '@/hooks/use-toast'
import type { CloudFolderConfig, SyncPlatform } from '@/types/sync'
import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'

type OneDrivePanelStatus =
  | 'disconnected'
  | 'requestingCode'
  | 'codeCopied'
  | 'openingBrowser'
  | 'waitingAuthorization'
  | 'connecting'
  | 'preparingWorkspace'
  | 'workspaceRequired'
  | 'connected'
  | 'disconnecting'
  | 'error'

type OneDriveConnectionMode = 'none' | 'pending' | 'active'

const PENDING_ONE_DRIVE_CONFIG_KEY = 'pendingOneDriveConfig'

function waitForRedirect(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('OneDrive sign-in cancelled', 'AbortError'))
    }, { once: true })
  })
}

type OneDriveCloudFolderSyncProps = {
  onActiveProviderChange?: (provider: 'oneDrive' | null) => void
}

export function OneDriveCloudFolderSync({ onActiveProviderChange }: OneDriveCloudFolderSyncProps) {
  const t = useTranslations('settings.sync.cloudFolder')
  const oneDriveT = useTranslations('settings.sync.oneDrive')
  const setCloudFolderConnected = useSyncStore(state => state.setCloudFolderConnected)
  const { workspacePath, setWorkspacePath, setPrimaryBackupMethod } = useSettingStore()
  const {
    loadWorkspaceCollapsibleList,
    loadFileTree,
    setActiveFilePath,
  } = useArticleStore()
  const refreshSkills = useSkillsStore(state => state.refreshSkills)
  const [config, setConfig] = useState<CloudFolderConfig>({ path: '' })
  const [clientId, setClientId] = useState(ONE_DRIVE_CLIENT_ID)
  const [initialized, setInitialized] = useState(false)
  const [connectionMode, setConnectionMode] = useState<OneDriveConnectionMode>('none')
  const [accountConnected, setAccountConnected] = useState(false)
  const [workspaceStrategy, setWorkspaceStrategy] = useState<OneDriveWorkspaceStrategy>('resume')
  const [pendingAction, setPendingAction] = useState<'oneDrive' | 'workspace' | 'disconnect' | null>(null)
  const [loginCode, setLoginCode] = useState<OneDriveLoginCode | null>(null)
  const [panelStatus, setPanelStatus] = useState<OneDrivePanelStatus>('disconnected')
  const [redirectSeconds, setRedirectSeconds] = useState(2)
  const [error, setError] = useState('')
  const loginAbortController = useRef<AbortController | null>(null)
  const panelStatusRef = useRef<OneDrivePanelStatus>('disconnected')

  function updatePanelStatus(status: OneDrivePanelStatus) {
    panelStatusRef.current = status
    setPanelStatus(status)
  }

  useEffect(() => {
    function handleAppResume() {
      if (
        document.visibilityState === 'visible'
        && panelStatusRef.current === 'waitingAuthorization'
      ) {
        updatePanelStatus('connecting')
      }
    }

    document.addEventListener('visibilitychange', handleAppResume)
    window.addEventListener('focus', handleAppResume)
    return () => {
      document.removeEventListener('visibilitychange', handleAppResume)
      window.removeEventListener('focus', handleAppResume)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let initializingActiveOneDrive = false

    async function initialize() {
      try {
        const store = await Store.load('store.json')
        const saved = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        const pending = await store.get<CloudFolderConfig>(PENDING_ONE_DRIVE_CONFIG_KEY)
        const candidate = saved?.path && saved.provider === 'oneDrive'
          ? saved
          : pending?.path && pending.provider === 'oneDrive'
            ? pending
            : null
        if (!candidate) {
          updatePanelStatus('disconnected')
          return
        }
        const mode: OneDriveConnectionMode = candidate === saved ? 'active' : 'pending'
        initializingActiveOneDrive = mode === 'active'
        setConfig(candidate)
        setClientId(candidate.oneDriveClientId || ONE_DRIVE_CLIENT_ID)
        const connected = await testCloudFolderConnection(candidate)
        if (cancelled) return
        setAccountConnected(connected)
        setConnectionMode(connected ? mode : 'none')
        if (mode === 'active') setCloudFolderConnected(connected)
        if (!connected) {
          setError(oneDriveT('connectFailed'))
          updatePanelStatus('error')
          return
        }
        const activeWorkspacePath = useSettingStore.getState().workspacePath
        const workspaceReady = Boolean(
          candidate.oneDriveWorkspacePath
          && candidate.oneDriveWorkspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
            === activeWorkspacePath.replace(/\\/g, '/').replace(/\/+$/, ''),
        )
        updatePanelStatus(mode === 'active' && workspaceReady ? 'connected' : 'workspaceRequired')
      } catch (cause) {
        if (cancelled) return
        console.error('Failed to initialize OneDrive sync:', cause)
        if (initializingActiveOneDrive) setCloudFolderConnected(false)
        setError(cause instanceof Error ? cause.message : t('accessFailedDescription'))
        updatePanelStatus('error')
      } finally {
        if (!cancelled) setInitialized(true)
      }
    }

    void initialize()
    return () => {
      cancelled = true
      loginAbortController.current?.abort()
    }
  }, [oneDriveT, setCloudFolderConnected, t])

  async function prepareWorkspaceSwitch() {
    const articleState = useArticleStore.getState()
    if (!await prepareActiveEditorDeactivationDurably(articleState.activeFilePath)) {
      return false
    }
    await articleState.flushAllPendingArticleSaves()
    await articleState.settleAllVectorCalculations()
    return true
  }

  async function refreshWorkspaceContent() {
    await setActiveFilePath('', true, { deactivationAlreadyPrepared: true })
    const lastActivePath = await loadWorkspaceCollapsibleList()
    await loadFileTree()
    if (lastActivePath) {
      await setActiveFilePath(lastActivePath, true, {
        deactivationAlreadyPrepared: true,
        createIfMissing: false,
      })
    }
    await refreshSkills()
  }

  async function transferWorkspace(preparation: OneDriveWorkspacePreparation) {
    const startedAt = Date.now()
    const options = { includeStaticAssets: true }
    if (preparation.mode === 'pull') {
      const result = await pullAllRemoteLibraryFiles(options)
      if (result.failed.length > 0) {
        throw new Error(oneDriveT('workspaceTransferFailed', { count: result.failed.length }))
      }
      const transferred = { downloaded: result.downloaded, uploaded: 0 }
      logOneDriveTiming('workspaceTransfer', startedAt, { mode: preparation.mode, ...transferred })
      return transferred
    }

    if (preparation.mode === 'upload') {
      const result = await uploadAllLocalLibraryFiles(options)
      if (result.failed.length > 0) {
        throw new Error(oneDriveT('workspaceTransferFailed', { count: result.failed.length }))
      }
      const transferred = { downloaded: 0, uploaded: result.uploaded }
      logOneDriveTiming('workspaceTransfer', startedAt, { mode: preparation.mode, ...transferred })
      return transferred
    }

    const pullResult = await pullAllRemoteLibraryFiles(options)
    if (pullResult.failed.length > 0) {
      throw new Error(oneDriveT('workspaceTransferFailed', { count: pullResult.failed.length }))
    }
    const remotePaths = new Set(preparation.remoteFiles.map(file => file.key))
    const localOnlyFiles = (await listLocalLibraryFiles(options))
      .filter(file => !remotePaths.has(file.path))
    let uploaded = 0
    let failed = 0
    for (let index = 0; index < localOnlyFiles.length; index += 3) {
      const batch = localOnlyFiles.slice(index, index + 3)
      await Promise.all(batch.map(async file => {
        try {
          await uploadLocalLibraryFile(file.path)
          uploaded += 1
        } catch {
          failed += 1
        }
      }))
    }
    if (failed > 0) throw new Error(oneDriveT('workspaceTransferFailed', { count: failed }))
    const transferred = { downloaded: pullResult.downloaded, uploaded }
    logOneDriveTiming('workspaceTransfer', startedAt, { mode: preparation.mode, ...transferred })
    return transferred
  }

  async function activateWorkspace(next: CloudFolderConfig, strategy: OneDriveWorkspaceStrategy) {
    if (!await prepareWorkspaceSwitch()) {
      throw new Error('无法在切换工作区前保存当前编辑内容')
    }
    const previousWorkspacePath = workspacePath
    const preparationStartedAt = Date.now()
    const preparation = await prepareOneDriveWorkspace(next, previousWorkspacePath || undefined, strategy)
    logOneDriveTiming('workspacePreparation', preparationStartedAt, {
      strategy,
      mode: preparation.mode,
      remoteFiles: preparation.remoteFiles.length,
    })
    const configured: CloudFolderConfig = {
      ...next,
      oneDriveWorkspacePath: preparation.path,
    }
    const autoDataSyncQueue = await import('@/lib/sync/auto-data-sync-queue')
    await autoDataSyncQueue.prepareAutoDataSyncForRepositoryChange()
    const store = await Store.load('store.json')
    const previousConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    const previousMethod = await store.get<SyncPlatform>('primaryBackupMethod') || 'github'
    try {
      await store.set('cloudFolderSyncConfig', configured)
      await store.save()
      await setPrimaryBackupMethod('cloudFolder')
      await setWorkspacePath(preparation.path)
      await setActiveFilePath('', true, { deactivationAlreadyPrepared: true })
      const transferred = await transferWorkspace(preparation)
      await refreshWorkspaceContent()
      await store.delete(PENDING_ONE_DRIVE_CONFIG_KEY)
      await store.save()

      setConfig(configured)
      setAccountConnected(true)
      setConnectionMode('active')
      setCloudFolderConnected(true)
      onActiveProviderChange?.('oneDrive')
      toast({
        title: oneDriveT('workspaceReadyTitle'),
        description: oneDriveT('workspaceReadyDescription', transferred),
      })

      if (platform() === 'ios' && previousConfig?.bookmarkBase64) {
        await setIOSWorkspaceFolderAccess(null)
        await releaseIOSSyncFolder(previousConfig.bookmarkBase64).catch(() => undefined)
      } else if (previousConfig?.path.startsWith('content://') && previousConfig.path !== next.path) {
        await releaseAndroidSyncFolder(previousConfig.path).catch(() => undefined)
      }
    } catch (cause) {
      await store.set('cloudFolderSyncConfig', previousConfig || { path: '' } satisfies CloudFolderConfig)
      await store.save()
      await setPrimaryBackupMethod(previousMethod)
      if (useSettingStore.getState().workspacePath !== previousWorkspacePath) {
        if (!await prepareWorkspaceSwitch()) {
          throw new Error('无法在回滚工作区前保存当前编辑内容')
        }
        await setWorkspacePath(previousWorkspacePath)
        await refreshWorkspaceContent().catch(() => undefined)
      }
      throw cause
    } finally {
      autoDataSyncQueue.finishAutoDataSyncRepositoryChange()
    }
  }

  async function connect() {
    if (pendingAction) return
    setPendingAction('oneDrive')
    setError('')
    setLoginCode(null)
    setRedirectSeconds(2)
    updatePanelStatus('requestingCode')
    const controller = new AbortController()
    loginAbortController.current = controller

    try {
      const next = await connectOneDrive(clientId, async code => {
        let copied = false
        try {
          await writeText(code.userCode, { label: 'NoteGen OneDrive sign-in code' })
          copied = true
        } catch (cause) {
          console.error('Failed to copy the OneDrive sign-in code:', cause)
        }
        setLoginCode({ ...code, copied })
        updatePanelStatus('codeCopied')
        await waitForRedirect(1000, controller.signal)
        setRedirectSeconds(1)
        await waitForRedirect(1000, controller.signal)
        setRedirectSeconds(0)
        updatePanelStatus('openingBrowser')
        await openUrl(code.verificationUrl)
        updatePanelStatus('waitingAuthorization')
      }, controller.signal)
      setLoginCode(null)
      updatePanelStatus('connecting')
      if (!await testCloudFolderConnection(next)) throw new Error(oneDriveT('connectFailed'))
      const store = await Store.load('store.json')
      await store.set(PENDING_ONE_DRIVE_CONFIG_KEY, next)
      await store.save()
      setConfig(next)
      setAccountConnected(true)
      setConnectionMode('pending')
      updatePanelStatus('workspaceRequired')
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        updatePanelStatus('disconnected')
        return
      }
      console.error('Failed to connect OneDrive:', cause)
      await disconnectOneDrive().catch(() => undefined)
      setError(cause instanceof Error ? cause.message : oneDriveT('connectFailed'))
      updatePanelStatus('error')
    } finally {
      if (loginAbortController.current === controller) loginAbortController.current = null
      setPendingAction(null)
    }
  }

  async function prepareConnectedWorkspace(strategy: OneDriveWorkspaceStrategy) {
    if (pendingAction || config.provider !== 'oneDrive') return
    setPendingAction('workspace')
    setWorkspaceStrategy(strategy)
    setError('')
    updatePanelStatus('preparingWorkspace')
    try {
      await activateWorkspace(config, strategy)
      updatePanelStatus('connected')
    } catch (cause) {
      console.error('Failed to prepare the OneDrive workspace:', cause)
      setError(cause instanceof Error ? cause.message : oneDriveT('workspaceSetupFailed'))
      updatePanelStatus('error')
    } finally {
      setPendingAction(null)
    }
  }

  async function openLoginPage() {
    if (!loginCode) return
    setError('')
    try {
      await writeText(loginCode.userCode, { label: 'NoteGen OneDrive sign-in code' })
      setLoginCode({ ...loginCode, copied: true })
      updatePanelStatus('openingBrowser')
      await openUrl(loginCode.verificationUrl)
      updatePanelStatus('waitingAuthorization')
    } catch (cause) {
      console.error('Failed to open the OneDrive sign-in page:', cause)
      setError(cause instanceof Error ? cause.message : oneDriveT('connectFailed'))
      updatePanelStatus('error')
    }
  }

  async function disconnect() {
    if (pendingAction) return
    setPendingAction('disconnect')
    setError('')
    updatePanelStatus('disconnecting')
    try {
      await disconnectOneDrive()
      const store = await Store.load('store.json')
      const activeConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      await store.delete(PENDING_ONE_DRIVE_CONFIG_KEY)
      if (activeConfig?.provider === 'oneDrive') {
        await store.set('cloudFolderSyncConfig', { path: '' } satisfies CloudFolderConfig)
      }
      await store.save()
      setConfig({ path: '' })
      setAccountConnected(false)
      setConnectionMode('none')
      if (activeConfig?.provider === 'oneDrive') {
        setCloudFolderConnected(false)
        onActiveProviderChange?.(null)
      }
      setLoginCode(null)
      updatePanelStatus('disconnected')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : oneDriveT('disconnectFailed'))
      updatePanelStatus('error')
    } finally {
      setPendingAction(null)
    }
  }

  const oneDriveConnected = config.provider === 'oneDrive' && Boolean(config.path) && accountConnected
  const normalizedWorkspacePath = workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedOneDriveWorkspacePath = config.oneDriveWorkspacePath?.trim().replace(/\\/g, '/').replace(/\/+$/, '') || ''
  const workspaceActive = Boolean(
    normalizedOneDriveWorkspacePath
    && normalizedWorkspacePath === normalizedOneDriveWorkspacePath,
  )

  useEffect(() => {
    if (!initialized || pendingAction || panelStatusRef.current === 'error') return
    if (oneDriveConnected) {
      updatePanelStatus(connectionMode === 'active' && workspaceActive ? 'connected' : 'workspaceRequired')
    }
  }, [connectionMode, initialized, oneDriveConnected, pendingAction, workspaceActive])

  if (!initialized) {
    return (
      <Alert>
        <Spinner />
        <AlertTitle>{oneDriveT('loadingTitle')}</AlertTitle>
        <AlertDescription>{oneDriveT('loadingDescription')}</AlertDescription>
      </Alert>
    )
  }

  function renderStatusIcon() {
    switch (panelStatus) {
      case 'disconnected':
        return <Cloud />
      case 'codeCopied':
        return <CopyCheck />
      case 'openingBrowser':
      case 'waitingAuthorization':
        return <ExternalLink />
      case 'workspaceRequired':
        return <FolderSync />
      case 'connected':
        return <CircleCheck />
      case 'error':
        return <TriangleAlert />
      default:
        return <Spinner />
    }
  }

  function getStatusTitle() {
    switch (panelStatus) {
      case 'disconnected': return oneDriveT('statusDisconnectedTitle')
      case 'requestingCode': return oneDriveT('statusRequestingCodeTitle')
      case 'codeCopied': return oneDriveT(loginCode?.copied ? 'statusCodeCopiedTitle' : 'statusCodeReadyTitle')
      case 'openingBrowser': return oneDriveT('statusOpeningBrowserTitle')
      case 'waitingAuthorization': return oneDriveT('statusWaitingAuthorizationTitle')
      case 'connecting': return oneDriveT('statusConnectingTitle')
      case 'preparingWorkspace': return oneDriveT('statusPreparingWorkspaceTitle')
      case 'workspaceRequired': return oneDriveT('workspaceSetupTitle')
      case 'connected': return oneDriveT('statusConnectedTitle')
      case 'disconnecting': return oneDriveT('statusDisconnectingTitle')
      case 'error': return oneDriveT('statusErrorTitle')
    }
  }

  function getStatusDescription() {
    switch (panelStatus) {
      case 'disconnected': return oneDriveT('statusDisconnectedDescription')
      case 'requestingCode': return oneDriveT('statusRequestingCodeDescription')
      case 'codeCopied':
        return oneDriveT(
          loginCode?.copied ? 'statusCodeCopiedDescription' : 'statusCodeReadyDescription',
          { code: loginCode?.userCode || '', seconds: redirectSeconds },
        )
      case 'openingBrowser': return oneDriveT('statusOpeningBrowserDescription')
      case 'waitingAuthorization': return oneDriveT('statusWaitingAuthorizationDescription')
      case 'connecting': return oneDriveT('statusConnectingDescription')
      case 'preparingWorkspace':
        return oneDriveT(
          workspaceStrategy === 'remote'
            ? 'statusPreparingRemoteWorkspaceDescription'
            : workspaceStrategy === 'current'
              ? 'statusCopyingCurrentWorkspaceDescription'
              : 'statusPreparingWorkspaceDescription',
        )
      case 'workspaceRequired':
        return oneDriveT(connectionMode === 'pending' ? 'workspaceChoiceDescription' : 'workspaceSwitchDescription')
      case 'connected': return oneDriveT('statusConnectedDescription')
      case 'disconnecting': return oneDriveT('statusDisconnectingDescription')
      case 'error': return error || oneDriveT('connectFailed')
    }
  }

  const canReopenLogin = Boolean(
    loginCode
    && (panelStatus === 'waitingAuthorization' || panelStatus === 'connecting' || panelStatus === 'error'),
  )
  const canChooseWorkspace = oneDriveConnected
    && connectionMode === 'pending'
    && (panelStatus === 'workspaceRequired' || panelStatus === 'error')
  const canPrepareWorkspace = oneDriveConnected
    && connectionMode === 'active'
    && !workspaceActive
    && (panelStatus === 'workspaceRequired' || panelStatus === 'error')

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-semibold">{oneDriveT('title')}</h3>
            <p className="text-sm text-muted-foreground">{oneDriveT('description')}</p>
          </div>
          <div className="shrink-0">
            <Badge variant={oneDriveConnected ? 'default' : 'secondary'}>
              {oneDriveConnected ? oneDriveT('connected') : oneDriveT('disconnected')}
            </Badge>
          </div>
        </header>
        <Alert variant={panelStatus === 'error' ? 'destructive' : 'default'}>
          {renderStatusIcon()}
          <AlertTitle>{getStatusTitle()}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{getStatusDescription()}</span>
            {canReopenLogin ? (
              <Button variant="outline" size="sm" onClick={() => void openLoginPage()}>
                <ExternalLink data-icon="inline-start" />
                {oneDriveT('openSignIn')}
              </Button>
            ) : null}
            {canPrepareWorkspace ? (
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(pendingAction)}
                onClick={() => void prepareConnectedWorkspace('resume')}
              >
                <FolderSync data-icon="inline-start" />
                {oneDriveT('prepareWorkspace')}
              </Button>
            ) : null}
            {canChooseWorkspace ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  size="sm"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void prepareConnectedWorkspace('remote')}
                >
                  <CloudDownload data-icon="inline-start" />
                  {oneDriveT('useOneDriveWorkspace')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void prepareConnectedWorkspace('current')}
                >
                  <Copy data-icon="inline-start" />
                  {oneDriveT('copyCurrentWorkspace')}
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
        <FieldGroup>
          {!ONE_DRIVE_CLIENT_ID && !oneDriveConnected ? (
              <Field data-invalid={Boolean(error && !clientId.trim())}>
                <FieldLabel htmlFor="one-drive-client-id">{oneDriveT('clientId')}</FieldLabel>
                <InputGroup className="h-11">
                  <InputGroupInput
                    id="one-drive-client-id"
                    value={clientId}
                    onChange={event => setClientId(event.target.value)}
                    placeholder={oneDriveT('clientIdPlaceholder')}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(error && !clientId.trim())}
                  />
                </InputGroup>
                <FieldDescription>{oneDriveT('clientIdDescription')}</FieldDescription>
              </Field>
          ) : null}

          <Field>
              <FieldLabel>{oneDriveT('folder')}</FieldLabel>
              <div className="flex min-w-0 gap-2">
                <InputGroup className="h-11 min-w-0 flex-1">
                  <InputGroupInput
                    readOnly
                    value={oneDriveConnected ? config.displayName || oneDriveT('folderValue') : ''}
                    placeholder={oneDriveT('notConnected')}
                    title={config.oneDriveRootWebUrl || oneDriveT('folderValue')}
                  />
                </InputGroup>
                {oneDriveConnected ? (
                  <Button
                    variant="outline"
                    disabled={Boolean(pendingAction)}
                    onClick={() => void disconnect()}
                  >
                    {pendingAction === 'disconnect' ? <Spinner data-icon="inline-start" /> : <LogOut data-icon="inline-start" />}
                    {oneDriveT('disconnect')}
                  </Button>
                ) : (
                  <Button disabled={Boolean(pendingAction) || !clientId.trim()} onClick={() => void connect()}>
                    {pendingAction === 'oneDrive' ? <Spinner data-icon="inline-start" /> : <LogIn data-icon="inline-start" />}
                    {pendingAction === 'oneDrive' ? oneDriveT('connecting') : oneDriveT('connect')}
                  </Button>
                )}
              </div>
              <FieldDescription>{oneDriveT('folderDescription')}</FieldDescription>
          </Field>

          {oneDriveConnected ? (
            <Field>
              <FieldLabel>{oneDriveT('workspace')}</FieldLabel>
              <InputGroup className="h-11">
                <InputGroupInput
                  readOnly
                  value={config.oneDriveWorkspacePath || ''}
                  placeholder={oneDriveT('workspaceNotReady')}
                  title={config.oneDriveWorkspacePath}
                />
              </InputGroup>
              <FieldDescription>{oneDriveT('workspaceDescription')}</FieldDescription>
            </Field>
          ) : null}

        </FieldGroup>
      </section>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { platform as getPlatform } from '@tauri-apps/plugin-os'
import { Store } from '@tauri-apps/plugin-store'
import { FolderSync, HardDrive, Loader2, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { SyncSettings } from '@/app/core/setting/sync/sync-settings'
import { MobileSyncSettings } from '@/app/mobile/setting/pages/sync/mobile-sync-settings'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ToggleGroup } from '@/components/ui/toggle-group'
import { useSyncProviderOptions } from '@/hooks/use-sync-provider-options'
import { usePendingSelfHostedSetup } from '@/hooks/use-pending-self-hosted-setup'
import { normalizeManagedWorkspacePath } from '@/lib/managed-workspace'
import { SyncStateEnum } from '@/lib/sync/github.types'
import { checkSyncProviderStatus } from '@/lib/sync/provider-status'
import { getDefaultArticleAbsolutePath } from '@/lib/workspace'
import useSettingStore, { flushChangedSyncableSettingsPersist } from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { setPlatformSwitchRecoveryVisible, switchSyncPlatform, usePlatformSwitchStore } from '@/stores/sync-platform-switch'
import type { CloudFolderConfig, SyncPlatform, SyncProvider } from '@/types/sync'
import { SetupOption } from './setup-option'
import { SetupStepActions, type SetupStepProps } from './setup-step-actions'

function matchesCloudWorkspace(provider: SyncProvider | '', config: CloudFolderConfig | undefined, workspace: string, windows: boolean) {
  if (!config || !workspace) return false
  const normalize = (path: string) => {
    const normalized = normalizeManagedWorkspacePath(path)
    return windows ? normalized.toLowerCase() : normalized
  }
  const path = normalize(workspace)
  if (provider === 'oneDrive' || config.provider === 'oneDrive') {
    return provider === 'oneDrive' && config.provider === 'oneDrive'
      && Boolean(config.oneDriveWorkspacePath && path === normalize(config.oneDriveWorkspacePath))
  }
  const root = normalize(config.path || '')
  return Boolean(root && (path === root || path.startsWith(`${root}/`)))
}

function isConnected(platform: SyncPlatform, state = useSyncStore.getState()) {
  switch (platform) {
    case 'github': return state.syncRepoState === SyncStateEnum.success
    case 'gitee': return state.giteeSyncRepoState === SyncStateEnum.success
    case 'gitlab': return state.gitlabSyncProjectState === SyncStateEnum.success
    case 'gitea': return state.giteaSyncRepoState === SyncStateEnum.success
    case 's3': return state.s3Connected
    case 'webdav': return state.webdavConnected
    case 'cloudFolder': return state.cloudFolderConnected
    case 'selfHosted': return state.selfHostedConnected && state.selfHostedServiceAvailable !== false
    case 'local': return true
  }
}

export function SetupSyncStep({ onNext, onBack, onDefer, mobile, focused }: SetupStepProps & { onDefer: () => void }) {
  const t = useTranslations('initialSetup')
  const syncText = useTranslations('settings.sync')
  const primary = useSettingStore(state => state.primaryBackupMethod)
  const switchingPlatform = usePlatformSwitchStore(state => state.platform)
  const switchStep = usePlatformSwitchStore(state => state.step)
  const switchSkipped = usePlatformSwitchStore(state => state.skipped)
  const cancelledHidden = usePlatformSwitchStore(state => state.cancelledHidden)
  const pendingSetupProfileId = usePendingSelfHostedSetup()
  const [device] = useState(getPlatform)
  const [mode, setMode] = useState<'local' | 'remote'>(focused || primary !== 'local' ? 'remote' : 'local')
  const [providerChoice, setProvider] = useState<SyncProvider | ''>(primary === 'local' ? '' : primary)
  const [cloudConfig, setCloudConfig] = useState<CloudFolderConfig | null>()
  const [defaultWorkspace, setDefaultWorkspace] = useState('')
  const workspacePath = useSettingStore(state => state.workspacePath)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const activating = useRef(false)
  let provider = providerChoice
  if (providerChoice === 'cloudFolder' && mobile) {
    provider = ''
    if (device === 'android' || (device === 'ios' && cloudConfig?.provider === 'oneDrive')) provider = 'oneDrive'
    else if (device === 'ios' && cloudConfig !== undefined) provider = 'iCloud'
  }
  const selected = mode === 'local' ? 'local'
    : provider === 'iCloud' || provider === 'oneDrive' ? 'cloudFolder' : provider
  const connected = useSyncStore(state => selected ? isConnected(selected, state) : false)
  const pending = Boolean(switchingPlatform && (switchStep !== 'completed' || switchSkipped))
  const canResume = Boolean(switchingPlatform && switchStep === 'cancelled' && cancelledHidden)
  const locked = busy || pending
  const canDeferSelfHostedSetup = selected === 'selfHosted' && Boolean(pendingSetupProfileId) && !locked
  const providerOptions = useSyncProviderOptions(mobile ? device : undefined)
    .filter(option => option.value !== 'local')
  const usesCloudFolder = providerChoice === 'cloudFolder' || providerChoice === 'iCloud' || providerChoice === 'oneDrive'
  const cloudReady = matchesCloudWorkspace(provider, cloudConfig ?? undefined, workspacePath || defaultWorkspace, device === 'windows')
  const current = selected === primary && connected && (selected !== 'cloudFolder' || cloudReady)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])


  useEffect(() => {
    if (!usesCloudFolder) return
    let active = true
    let unlisten: (() => void) | undefined
    void getDefaultArticleAbsolutePath('').then(path => {
      if (active) setDefaultWorkspace(path)
    }).catch(() => undefined)
    void Store.load('store.json').then(async store => {
      const update = (config?: CloudFolderConfig) => {
        if (active) setCloudConfig(config ?? null)
      }
      const stop = await store.onKeyChange<CloudFolderConfig>('cloudFolderSyncConfig', update)
      if (!active) {
        stop()
        return
      }
      unlisten = stop
      update(await store.get<CloudFolderConfig>('cloudFolderSyncConfig'))
    }).catch(() => { if (active) setError(t('sync.loadFailed')) })
    return () => {
      active = false
      unlisten?.()
    }
  }, [usesCloudFolder, t])

  async function activate(finish = false) {
    if (!selected || locked || activating.current) return
    const isActive = () => mounted.current
    activating.current = true
    setBusy(true)
    setError('')
    try {
      if (selected !== 'local') {
        await flushChangedSyncableSettingsPersist()
        if (!isActive()) return
        if (selected === 'cloudFolder') {
          const store = await Store.load('store.json')
          const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
          const workspacePath = useSettingStore.getState().workspacePath || await getDefaultArticleAbsolutePath('')
          if (!matchesCloudWorkspace(provider, config, workspacePath, device === 'windows')) {
            if (isActive()) setError(t('sync.cloudWorkspaceRequired'))
            return
          }
        }
        await checkSyncProviderStatus(selected, { isActive })
        if (!isActive()) return
        if (!isConnected(selected)) {
          setError(t('sync.connectionFailed'))
          return
        }
      }
      if (!isActive()) return
      if (useSettingStore.getState().primaryBackupMethod !== selected || switchSkipped) {
        await switchSyncPlatform(selected, false, undefined, false, { isActive })
      }
      if (!isActive()) return
      const task = usePlatformSwitchStore.getState()
      if (task.step === 'error') setError(t('sync.activationFailed'))
      else if (finish && useSettingStore.getState().primaryBackupMethod === selected && !task.skipped) onNext()
    } catch {
      if (isActive()) setError(t('sync.connectionFailed'))
    } finally {
      activating.current = false
      if (isActive()) setBusy(false)
    }
  }

  function finish() {
    if (locked || !selected) return
    if (current) onNext()
    else if (selected === 'local') void activate(true)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="app-panel-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pt-2 pb-6 sm:gap-6">
        {!focused && <ToggleGroup type="single" value={mode} disabled={locked}
          onValueChange={value => {
            if (value === 'local' || value === 'remote') {
              setError('')
              setMode(value)
            }
          }}
          aria-label={t('steps.sync')} className="grid w-full shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          <SetupOption value="local" icon={HardDrive} label={t('sync.categories.local.title')}
            hint={t('sync.categories.local.description')} selected={mode === 'local'} />
          <SetupOption value="remote" icon={FolderSync} label={t('sync.remoteTitle')}
            hint={t('sync.remoteDescription')} selected={mode === 'remote'} />
        </ToggleGroup>}
        {mode === 'remote' && (
          <ResponsiveSelect
            title={syncText('selectPlatform')}
            placeholder={syncText('selectPlatform')}
            value={provider}
            options={providerOptions}
            disabled={locked}
            className="w-full shrink-0 px-3 data-[size=default]:h-10"
            onValueChange={value => {
              const option = providerOptions.find(item => item.value === value)
              if (locked || !option) return
              setError('')
              setProvider(option.value)
            }}
          />
        )}

        {selected && selected !== 'local' && provider && (
          <fieldset key={provider} disabled={locked} className="flex min-w-0 flex-col gap-4">
            <p className="px-1 text-sm text-muted-foreground">{t('sync.settingsSavedHint')}</p>
            {mobile
              ? <MobileSyncSettings selectedPlatform={provider} onActivate={() => void activate()} onSetupLater={onDefer} />
              : <SyncSettings selectedPlatform={selected} onActivate={() => void activate()} onSetupLater={onDefer} />}
          </fieldset>
        )}
        {pending && <Alert>
          {canResume ? <TriangleAlert /> : <Loader2 />}
          <AlertDescription>{canResume ? syncText('switchPlan.cancelledPartialHint') : t('sync.taskHint')}</AlertDescription>
        </Alert>}
        {canDeferSelfHostedSetup && <Alert variant="warning" role="status">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{t('sync.selfHostedSetupLaterHint')}</AlertDescription>
        </Alert>}
        {error && <Alert variant="destructive"><TriangleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      </div>
      <SetupStepActions onBack={onBack}
        onNext={canResume ? () => setPlatformSwitchRecoveryVisible(true) : canDeferSelfHostedSetup ? onDefer : finish}
        nextLabel={canResume ? syncText('switchPlan.resumeReview') : canDeferSelfHostedSetup ? syncText('selfHosted.setupLater')
          : t(selected === 'local' && primary !== 'local' ? 'sync.useLocal' : 'sync.done')}
        busy={busy && !canResume} disableNext={!canResume && !canDeferSelfHostedSetup && (locked || !selected || (selected !== 'local' && !current))} />
    </div>
  )
}

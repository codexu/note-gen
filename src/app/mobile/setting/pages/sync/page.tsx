'use client'

import { FileDown, Loader2, RefreshCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { Store } from '@tauri-apps/plugin-store'
import { GithubSync } from '@/app/core/setting/sync/github-sync'
import { GiteeSync } from '@/app/core/setting/sync/gitee-sync'
import { GitlabSync } from '@/app/core/setting/sync/gitlab-sync'
import { GiteaSync } from '@/app/core/setting/sync/gitea-sync'
import { S3Sync } from '@/app/core/setting/sync/s3-sync'
import { WebDAVSync } from '@/app/core/setting/sync/webdav-sync'
import { SelfHostedSync } from '@/app/core/setting/sync/self-hosted-sync'
import { UsePlatformButton } from '@/app/core/setting/sync/components/use-platform-button'
import { WorkspaceRepoMapping } from '@/app/core/setting/sync/components/workspace-repo-mapping'
import { DataSyncOverview } from '@/app/core/setting/sync/components/data-sync-overview'
import { MobileSelectDrawer } from '@/app/mobile/components/mobile-select-drawer'
import { OneDriveCloudFolderSync } from '@/app/mobile/setting/pages/sync/android-cloud-folder-sync'
import { ICloudFolderSync } from '@/app/mobile/setting/pages/sync/ios-cloud-folder-sync'
import { RecordSyncStatusBanner } from '@/components/record-sync-status-banner'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { RepoNames, SyncStateEnum } from '@/lib/sync/github.types'
import { hasConfiguredSelfHostedSync } from '@/lib/diagnostics/self-hosted'
import type { SyncRepoPlatform, WorkspaceSyncRepos } from '@/lib/sync/workspace-repos'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { SYNC_PLATFORMS, SYNC_PLATFORM_INFO, SyncPlatform, type CloudFolderConfig } from '@/types/sync'

type MobileSyncPlatform = SyncPlatform | 'iCloud' | 'oneDrive'

function toSyncPlatform(platformName: MobileSyncPlatform): SyncPlatform {
  return platformName === 'iCloud' || platformName === 'oneDrive' ? 'cloudFolder' : platformName
}

function isRepoSyncPlatform(platformName: MobileSyncPlatform): platformName is SyncRepoPlatform {
  return platformName === 'github'
    || platformName === 'gitee'
    || platformName === 'gitlab'
    || platformName === 'gitea'
}

export default function SyncPage() {
  const t = useTranslations()
  const currentPlatform = platform()
  const isIOS = currentPlatform === 'ios'
  const isAndroid = currentPlatform === 'android'
  const {
    primaryBackupMethod,
    setPrimaryBackupMethod,
    autoSync,
    setAutoSync,
    autoRecordSyncEnabled,
    setAutoRecordSyncEnabled,
    autoSettingsSyncEnabled,
    setAutoSettingsSyncEnabled,
    autoConversationSyncEnabled,
    setAutoConversationSyncEnabled,
    excludeSensitiveConfig,
    setExcludeSensitiveConfig,
    autoPullOnOpen,
    setAutoPullOnOpen,
    workspacePath,
    workspaceHistory,
    setGithubCustomSyncRepo,
    setGiteeCustomSyncRepo,
    setGitlabCustomSyncRepo,
    setGiteaCustomSyncRepo,
    developerMode,
  } = useSettingStore()
  const {
    syncRepoState,
    giteeSyncRepoState,
    gitlabSyncProjectState,
    giteaSyncRepoState,
    s3Connected,
    webdavConnected,
    cloudFolderConnected,
    selfHostedConnected,
  } = useSyncStore()

  const [tab, setTab] = useState<MobileSyncPlatform>(primaryBackupMethod)
  const [isLoading, setIsLoading] = useState(true)
  const [activeCloudFolderProvider, setActiveCloudFolderProvider] = useState<'folder' | 'oneDrive' | null>(null)
  const [workspaceRepos, setWorkspaceRepos] = useState<Record<string, WorkspaceSyncRepos>>({})
  const [hasSelfHostedConfiguration, setHasSelfHostedConfiguration] = useState(false)

  const standardPlatforms = useMemo(
    () => SYNC_PLATFORMS.filter(platformName => platformName !== 'cloudFolder'
      && (platformName !== 'selfHosted'
        || developerMode
        || primaryBackupMethod === 'selfHosted'
        || hasSelfHostedConfiguration)),
    [developerMode, hasSelfHostedConfiguration, primaryBackupMethod],
  )
  const availablePlatforms: MobileSyncPlatform[] = isIOS
    ? [...standardPlatforms, 'iCloud', 'oneDrive']
    : isAndroid
      ? [...standardPlatforms, 'oneDrive']
      : standardPlatforms

  useEffect(() => {
    let cancelled = false
    void hasConfiguredSelfHostedSync().then(configured => {
      if (!cancelled) setHasSelfHostedConfiguration(configured)
    })
    return () => {
      cancelled = true
    }
  }, [selfHostedConnected])

  const workspaceOptions = useMemo(
    () => Array.from(new Set([workspacePath, '', ...workspaceHistory])),
    [workspaceHistory, workspacePath],
  )

  useEffect(() => {
    let cancelled = false

    async function loadWorkspaceRepos() {
      const { getWorkspaceSyncRepos } = await import('@/lib/sync/workspace-repos')
      const entries = await Promise.all(workspaceOptions.map(async (path) => {
        return [path, await getWorkspaceSyncRepos(path)] as const
      }))
      if (!cancelled) setWorkspaceRepos(Object.fromEntries(entries))
    }

    void loadWorkspaceRepos()
    return () => {
      cancelled = true
    }
  }, [workspaceOptions])

  async function handleWorkspaceRepoChange(workspacePath: string, repoPlatform: SyncRepoPlatform, repo: string) {
    const setters: Record<SyncRepoPlatform, (value: string, targetWorkspacePath?: string) => Promise<void>> = {
      github: setGithubCustomSyncRepo,
      gitee: setGiteeCustomSyncRepo,
      gitlab: setGitlabCustomSyncRepo,
      gitea: setGiteaCustomSyncRepo,
    }

    await setters[repoPlatform](repo, workspacePath)
    setWorkspaceRepos(current => ({
      ...current,
      [workspacePath]: {
        ...current[workspacePath],
        [repoPlatform]: repo,
      },
    }))
  }

  useEffect(() => {
    async function loadPrimaryBackupMethod() {
      try {
        const store = await Store.load('store.json')
        const savedMethod = await store.get<SyncPlatform>('primaryBackupMethod')
        const cloudFolderConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        setActiveCloudFolderProvider(
          cloudFolderConfig?.path
            ? cloudFolderConfig.provider === 'oneDrive' ? 'oneDrive' : 'folder'
            : null,
        )
        if (savedMethod) {
          const nextTab: MobileSyncPlatform = savedMethod !== 'cloudFolder'
            ? savedMethod
            : isIOS
              ? cloudFolderConfig?.provider === 'oneDrive' ? 'oneDrive' : 'iCloud'
              : isAndroid
                ? 'oneDrive'
                : 'github'
          await setPrimaryBackupMethod(toSyncPlatform(nextTab))
          setTab(nextTab)
        }
      } catch (error) {
        console.error('Failed to load primary backup method:', error)
      } finally {
        setIsLoading(false)
      }
    }

    void loadPrimaryBackupMethod()
  }, [isAndroid, isIOS, setPrimaryBackupMethod])

  const selectedSyncPlatform = toSyncPlatform(tab)
  const currentSyncState = getCurrentSyncState(selectedSyncPlatform)
  const isFileAutoSyncDisabled = currentSyncState !== SyncStateEnum.success
  const isCloudFolderTab = selectedSyncPlatform === 'cloudFolder'
  const supportsCloudFolderFileSync = tab === 'oneDrive'

  function getCurrentSyncState(platform: SyncPlatform) {
    switch (platform) {
      case 'github':
        return syncRepoState
      case 'gitee':
        return giteeSyncRepoState
      case 'gitlab':
        return gitlabSyncProjectState
      case 'gitea':
        return giteaSyncRepoState
      case 's3':
        return s3Connected ? SyncStateEnum.success : SyncStateEnum.fail
      case 'webdav':
        return webdavConnected ? SyncStateEnum.success : SyncStateEnum.fail
      case 'cloudFolder':
        return cloudFolderConnected
          && ((tab === 'oneDrive' && activeCloudFolderProvider === 'oneDrive')
            || (tab === 'iCloud' && activeCloudFolderProvider === 'folder'))
          ? SyncStateEnum.success
          : SyncStateEnum.fail
      case 'selfHosted':
        return selfHostedConnected ? SyncStateEnum.success : SyncStateEnum.fail
      default:
        return syncRepoState
    }
  }

  function getProviderLabel(platform: MobileSyncPlatform) {
    if (platform === 'iCloud') return t('settings.sync.iCloud.title')
    if (platform === 'oneDrive' || platform === 'cloudFolder') return t('settings.sync.oneDrive.title')
    if (platform === 'selfHosted') return t('settings.sync.selfHosted.title')
    return SYNC_PLATFORM_INFO[platform].name
  }

  function handleTabChange(value: string) {
    const nextTab = value as MobileSyncPlatform
    setTab(nextTab)
  }

  async function handleExcludeSensitiveConfigChange(checked: boolean) {
    if (!checked) {
      const accepted = await confirm(t('settings.sync.autoDataSyncPrivacyDisableConfirm'), {
        title: t('settings.sync.autoDataSyncPrivacyTitle'),
        kind: 'warning',
      })
      if (!accepted) return
    }

    await setExcludeSensitiveConfig(checked)
  }

  function renderSyncContent() {
    switch (tab) {
      case 'github':
        return <GithubSync />
      case 'gitee':
        return <GiteeSync />
      case 'gitlab':
        return <GitlabSync />
      case 'gitea':
        return <GiteaSync />
      case 's3':
        return <S3Sync />
      case 'webdav':
        return <WebDAVSync />
      case 'selfHosted':
        return <SelfHostedSync />
      case 'iCloud':
        return isIOS
          ? <ICloudFolderSync onActiveProviderChange={setActiveCloudFolderProvider} />
          : <GithubSync />
      case 'oneDrive':
      case 'cloudFolder':
        return isIOS || isAndroid
          ? <OneDriveCloudFolderSync onActiveProviderChange={setActiveCloudFolderProvider} />
          : <GithubSync />
      default:
        return <GithubSync />
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t('settings.sync.desc')}
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('settings.sync.platformSettings')}</h2>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <MobileSelectDrawer
              title={t('settings.sync.selectPlatform')}
              value={tab}
              onValueChange={handleTabChange}
              placeholder={t('settings.sync.selectPlatform')}
              className="h-11"
              options={availablePlatforms.map(platformName => ({
                value: platformName,
                label: getProviderLabel(platformName),
              }))}
            />
          </div>
          <div className="shrink-0 [&>button]:h-11">
            <UsePlatformButton
              platform={selectedSyncPlatform}
              disabled={currentSyncState !== SyncStateEnum.success}
            />
          </div>
        </div>
        {renderSyncContent()}
        {isRepoSyncPlatform(tab) ? (
          <WorkspaceRepoMapping
            platform={tab}
            workspaceOptions={workspaceOptions}
            currentWorkspacePath={workspacePath}
            workspaceRepos={workspaceRepos}
            defaultRepoName={RepoNames.sync}
            onRepoChange={(targetWorkspacePath, repo) => handleWorkspaceRepoChange(targetWorkspacePath, tab, repo)}
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('settings.sync.noteSettings')}</h2>

        <Item variant="outline">
          <ItemMedia variant="icon"><RefreshCcw className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoSync')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoSyncDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <MobileSelectDrawer
              title={t('settings.sync.autoSync')}
              value={autoSync}
              onValueChange={(value) => setAutoSync(value)}
              disabled={isFileAutoSyncDisabled || (isCloudFolderTab && !supportsCloudFolderFileSync)}
              className="min-w-32"
              placeholder={t('settings.sync.autoSyncOptions.placeholder')}
              options={[
                { value: 'disabled', label: t('settings.sync.autoSyncOptions.disabled') },
                { value: '2', label: t('settings.sync.autoSyncOptions.2s') },
                { value: '3', label: t('settings.sync.autoSyncOptions.3s') },
                { value: '5', label: t('settings.sync.autoSyncOptions.5s') },
                { value: '10', label: t('settings.sync.autoSyncOptions.10s') },
                { value: '20', label: t('settings.sync.autoSyncOptions.20s') },
                { value: '30', label: t('settings.sync.autoSyncOptions.30s') },
                { value: '60', label: t('settings.sync.autoSyncOptions.1m') },
                { value: '120', label: t('settings.sync.autoSyncOptions.2m') },
              ]}
            />
          </ItemActions>
        </Item>

        <Item variant="outline">
          <ItemMedia variant="icon"><FileDown className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoPullOnOpen')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoPullOnOpenDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions className="mobile-setting-inline-action">
            <Switch
              checked={autoPullOnOpen}
              onCheckedChange={setAutoPullOnOpen}
              disabled={isFileAutoSyncDisabled || (isCloudFolderTab && !supportsCloudFolderFileSync)}
            />
          </ItemActions>
        </Item>

      </section>

      <DataSyncOverview
        mobile
        autoRecordSyncEnabled={autoRecordSyncEnabled}
        autoSettingsSyncEnabled={autoSettingsSyncEnabled}
        autoConversationSyncEnabled={autoConversationSyncEnabled}
        excludeSensitiveConfig={excludeSensitiveConfig}
        onRecordSyncChange={setAutoRecordSyncEnabled}
        onSettingsSyncChange={setAutoSettingsSyncEnabled}
        onConversationSyncChange={setAutoConversationSyncEnabled}
        onSensitiveConfigChange={handleExcludeSensitiveConfigChange}
      />
      {autoRecordSyncEnabled ? <RecordSyncStatusBanner showWaitingProvider /> : null}
    </div>
  )
}

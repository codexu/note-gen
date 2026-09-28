'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import {
  Cloud,
  Database,
  FileDown,
  FileUp,
  FolderSync,
  GitBranch,
  GitFork,
  HardDrive,
  Loader2,
  Network,
  RefreshCcw,
  Server,
  Settings2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'

import { GiteeSync } from './gitee-sync'
import { GiteaSync } from './gitea-sync'
import { GithubSync } from './github-sync'
import { GitlabSync } from './gitlab-sync'
import { S3Sync } from './s3-sync'
import { WebDAVSync } from './webdav-sync'
import { CloudFolderSync } from './cloud-folder-sync'
import { SelfHostedSync } from './self-hosted-sync'
import { SelfHostedPersonalDataOptions } from './self-hosted-personal-data-options'
import { UsePlatformButton } from './components/use-platform-button'
import { WorkspaceRepoMapping } from './components/workspace-repo-mapping'
import { DataSyncOverview } from './components/data-sync-overview'
import { SettingType } from '../components/setting-base'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { RepoNames, SyncStateEnum } from '@/lib/sync/github.types'
import { checkSyncProviderStatus } from '@/lib/sync/provider-status'
import { hasConfiguredSelfHostedSync } from '@/lib/diagnostics/self-hosted'
import type { SyncRepoPlatform, WorkspaceSyncRepos } from '@/lib/sync/workspace-repos'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { SYNC_PLATFORMS, SYNC_PLATFORM_INFO, type SyncPlatform } from '@/types/sync'

const PLATFORM_ICONS: Record<SyncPlatform, LucideIcon> = {
  local: HardDrive,
  github: GitBranch,
  gitee: GitFork,
  gitlab: Network,
  gitea: Server,
  s3: Database,
  webdav: Cloud,
  cloudFolder: FolderSync,
  selfHosted: Server,
}

const PLATFORM_LOGOS: Partial<Record<SyncPlatform, string>> = {
  github: '/sync-platforms/github.svg',
  gitee: '/sync-platforms/gitee.svg',
  gitlab: '/sync-platforms/gitlab.svg',
  gitea: '/sync-platforms/gitea.svg',
  selfHosted: '/app-icon.png',
}

export default function SyncPage() {
  const t = useTranslations()
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

  const [platform, setPlatform] = useState<SyncPlatform>(primaryBackupMethod)
  const [activeTab, setActiveTab] = useState('connection')
  const [isLoading, setIsLoading] = useState(true)
  const [checkingPlatforms, setCheckingPlatforms] = useState<Set<SyncPlatform>>(new Set())
  const checkingPlatformsRef = useRef<Set<SyncPlatform>>(new Set())
  const [workspaceRepos, setWorkspaceRepos] = useState<Record<string, WorkspaceSyncRepos>>({})
  const [hasSelfHostedConfiguration, setHasSelfHostedConfiguration] = useState(false)

  const visiblePlatforms = useMemo(
    () => SYNC_PLATFORMS.filter(itemPlatform => itemPlatform !== 'selfHosted'
      || developerMode
      || primaryBackupMethod === 'selfHosted'
      || hasSelfHostedConfiguration),
    [developerMode, hasSelfHostedConfiguration, primaryBackupMethod],
  )

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
        if (savedMethod) {
          await setPrimaryBackupMethod(savedMethod)
          setPlatform(savedMethod)
        }
      } catch (error) {
        console.error('Failed to load primary backup method:', error)
      } finally {
        setIsLoading(false)
      }
    }

    void loadPrimaryBackupMethod()
  }, [setPrimaryBackupMethod])

  const checkPlatformStatus = useCallback(async (targetPlatform: SyncPlatform) => {
    if (targetPlatform === 'local') return
    if (checkingPlatformsRef.current.has(targetPlatform)) return

    checkingPlatformsRef.current.add(targetPlatform)
    setCheckingPlatforms(new Set(checkingPlatformsRef.current))
    try {
      await checkSyncProviderStatus(targetPlatform)
    } finally {
      checkingPlatformsRef.current.delete(targetPlatform)
      setCheckingPlatforms(new Set(checkingPlatformsRef.current))
    }
  }, [])

  useEffect(() => {
    if (isLoading) return
    void checkPlatformStatus(platform)
  }, [checkPlatformStatus, isLoading, platform, workspacePath])

  function getSyncState(targetPlatform: SyncPlatform) {
    if (checkingPlatforms.has(targetPlatform)) return SyncStateEnum.checking

    switch (targetPlatform) {
      case 'local':
        return SyncStateEnum.success
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
        return cloudFolderConnected ? SyncStateEnum.success : SyncStateEnum.fail
      case 'selfHosted':
        return selfHostedConnected ? SyncStateEnum.success : SyncStateEnum.fail
    }
  }

  const currentSyncState = getSyncState(platform)
  const isAutoSyncDisabled = currentSyncState !== SyncStateEnum.success
  const getPlatformName = (targetPlatform: SyncPlatform) => {
    if (targetPlatform === 'local') return t('settings.sync.local.title')
    if (targetPlatform === 'cloudFolder') return t('settings.sync.cloudFolder.title')
    if (targetPlatform === 'selfHosted') return t('settings.sync.selfHosted.title')
    return SYNC_PLATFORM_INFO[targetPlatform].name
  }
  const currentPlatformName = getPlatformName(platform)

  function handlePlatformChange(nextPlatform: SyncPlatform) {
    setPlatform(nextPlatform)
    setActiveTab('connection')
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
    switch (platform) {
      case 'local':
        return (
          <Card>
            <CardHeader>
              <CardDescription>{t('settings.sync.local.description')}</CardDescription>
            </CardHeader>
          </Card>
        )
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
      case 'cloudFolder':
        return <CloudFolderSync />
      case 'selfHosted':
        return <SelfHostedSync />
    }
  }

  function renderStatusBadge(state: SyncStateEnum) {
    const isChecking = state === SyncStateEnum.checking || state === SyncStateEnum.creating

    if (state === SyncStateEnum.success) {
      return (
        <Badge className="bg-green-600 text-white">
          {t('settings.sync.status.connected')}
        </Badge>
      )
    }

    if (isChecking) {
      return (
        <Badge variant="secondary">
          <Loader2 data-icon="inline-start" className="animate-spin" />
          {state === SyncStateEnum.checking
            ? t('settings.sync.checking')
            : t('settings.sync.creating')}
        </Badge>
      )
    }

    return <Badge variant="destructive">{t('settings.sync.status.disconnected')}</Badge>
  }

  if (isLoading) {
    return (
      <SettingType id="sync" icon={<FileUp />} title={t('settings.sync.title')} desc={t('settings.sync.desc')}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      </SettingType>
    )
  }

  return (
    <SettingType id="sync" icon={<FileUp />} title={t('settings.sync.title')} desc={t('settings.sync.desc')}>
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card size="sm" className="lg:sticky lg:top-2">
          <CardHeader>
            <CardTitle>{t('settings.sync.platformSettings')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-1">
              {visiblePlatforms.map((itemPlatform) => {
                const isCurrentPlatform = primaryBackupMethod === itemPlatform
                const isSelectedPlatform = platform === itemPlatform
                return (
                  <Item
                    key={itemPlatform}
                    asChild
                    size="sm"
                    variant={isSelectedPlatform ? 'outline' : 'default'}
                    className="data-[state=on]:border-primary data-[state=on]:bg-primary/5"
                  >
                    <button
                      type="button"
                      data-state={isSelectedPlatform ? 'on' : 'off'}
                      aria-pressed={isSelectedPlatform}
                      onClick={() => void handlePlatformChange(itemPlatform)}
                    >
                      <ItemMedia>
                        <SyncPlatformIcon platform={itemPlatform} small />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>
                          {getPlatformName(itemPlatform)}
                        </ItemTitle>
                      </ItemContent>
                      {isCurrentPlatform ? (
                        <ItemActions>
                          <Badge>{t('settings.sync.currentPlatform')}</Badge>
                        </ItemActions>
                      ) : null}
                    </button>
                  </Item>
                )
              })}
            </ItemGroup>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex min-w-0 items-center gap-3">
                <SyncPlatformIcon platform={platform} />
                <div className="min-w-0 flex-1">
                  <CardTitle className="flex items-center gap-2">
                    {currentPlatformName}
                    {platform === 'selfHosted' ? (
                      <Badge
                        variant="outline"
                        className="border-warning/40 bg-warning/10 text-warning-foreground"
                      >
                        {t('settings.sync.experimental')}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  {platform !== 'local' ? <CardDescription>{t('settings.sync.platformDesc')}</CardDescription> : null}
                </div>
              </div>
              <CardAction>
                <div className="flex items-center gap-2">
                  {platform !== 'local' ? renderStatusBadge(currentSyncState) : null}
                  <UsePlatformButton
                    platform={platform}
                    disabled={currentSyncState !== SyncStateEnum.success}
                  />
                </div>
              </CardAction>
            </CardHeader>
          </Card>

          {platform === 'local' ? renderSyncContent() : <Tabs orientation="horizontal" value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid h-9 w-full grid-cols-2">
              <TabsTrigger className="!justify-center" value="connection">
                <Settings2 data-icon="inline-start" />
                {t('settings.sync.connectionTab')}
              </TabsTrigger>
              <TabsTrigger className="!justify-center" value="options">
                <SlidersHorizontal data-icon="inline-start" />
                {t('settings.sync.syncOptionsTab')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="connection" className="flex flex-col gap-4">
              {renderSyncContent()}
              {platform !== 's3' && platform !== 'webdav' && platform !== 'cloudFolder' && platform !== 'selfHosted' ? (
                <WorkspaceRepoMapping
                  platform={platform}
                  workspaceOptions={workspaceOptions}
                  currentWorkspacePath={workspacePath}
                  workspaceRepos={workspaceRepos}
                  defaultRepoName={RepoNames.sync}
                  onRepoChange={(targetWorkspacePath, repo) => handleWorkspaceRepoChange(targetWorkspacePath, platform, repo)}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="options" className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.sync.noteSettings')}</CardTitle>
                  <CardDescription>{t('settings.sync.noteSettingsDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ItemGroup>
                    <Item variant="outline">
                      <ItemMedia variant="icon"><RefreshCcw /></ItemMedia>
                      <ItemContent>
                        <ItemTitle>{t('settings.sync.autoSync')}</ItemTitle>
                        <ItemDescription>{t('settings.sync.autoSyncDesc')}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Select
                          value={autoSync}
                          onValueChange={setAutoSync}
                          disabled={isAutoSyncDisabled || platform === 'cloudFolder'}
                        >
                          <SelectTrigger className="w-45">
                            <SelectValue placeholder={t('settings.sync.autoSyncOptions.placeholder')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="disabled">{t('settings.sync.autoSyncOptions.disabled')}</SelectItem>
                              <SelectItem value="2">{t('settings.sync.autoSyncOptions.2s')}</SelectItem>
                              <SelectItem value="3">{t('settings.sync.autoSyncOptions.3s')}</SelectItem>
                              <SelectItem value="5">{t('settings.sync.autoSyncOptions.5s')}</SelectItem>
                              <SelectItem value="10">{t('settings.sync.autoSyncOptions.10s')}</SelectItem>
                              <SelectItem value="20">{t('settings.sync.autoSyncOptions.20s')}</SelectItem>
                              <SelectItem value="30">{t('settings.sync.autoSyncOptions.30s')}</SelectItem>
                              <SelectItem value="60">{t('settings.sync.autoSyncOptions.1m')}</SelectItem>
                              <SelectItem value="120">{t('settings.sync.autoSyncOptions.2m')}</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </ItemActions>
                    </Item>

                    <Item variant="outline">
                      <ItemMedia variant="icon"><FileDown /></ItemMedia>
                      <ItemContent>
                        <ItemTitle>{t('settings.sync.autoPullOnOpen')}</ItemTitle>
                        <ItemDescription>{t('settings.sync.autoPullOnOpenDesc')}</ItemDescription>
                      </ItemContent>
                      <ItemActions className="mobile-setting-inline-action">
                        <Switch
                          checked={autoPullOnOpen}
                          onCheckedChange={setAutoPullOnOpen}
                          disabled={isAutoSyncDisabled || platform === 'cloudFolder'}
                        />
                      </ItemActions>
                    </Item>

                  </ItemGroup>
                </CardContent>
              </Card>

              {platform === 'selfHosted' ? (
                <SelfHostedPersonalDataOptions />
              ) : (
                <DataSyncOverview
                  autoRecordSyncEnabled={autoRecordSyncEnabled}
                  autoSettingsSyncEnabled={autoSettingsSyncEnabled}
                  autoConversationSyncEnabled={autoConversationSyncEnabled}
                  excludeSensitiveConfig={excludeSensitiveConfig}
                  onRecordSyncChange={setAutoRecordSyncEnabled}
                  onSettingsSyncChange={setAutoSettingsSyncEnabled}
                  onConversationSyncChange={setAutoConversationSyncEnabled}
                  onSensitiveConfigChange={handleExcludeSensitiveConfigChange}
                />
              )}

            </TabsContent>
          </Tabs>}
        </div>
      </div>
    </SettingType>
  )
}

function SyncPlatformIcon({
  platform,
  small = false,
}: {
  platform: SyncPlatform
  small?: boolean
}) {
  const platformInfo = SYNC_PLATFORM_INFO[platform]
  const PlatformIcon = PLATFORM_ICONS[platform]
  const logo = PLATFORM_LOGOS[platform]

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center',
        small ? 'size-6' : 'size-8',
      )}
    >
      {logo ? (
        <Image
          className={cn(
            'size-full object-contain',
            platform === 'selfHosted' && 'rounded-[22%]',
          )}
          src={logo}
          alt={`${platformInfo.name} logo`}
          width={small ? 24 : 32}
          height={small ? 24 : 32}
        />
      ) : (
        <PlatformIcon className="size-full" />
      )}
    </span>
  )
}

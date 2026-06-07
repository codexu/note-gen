'use client'

import { FileDown, Files, FileUp, Loader2, RefreshCcw, ShieldCheck, UploadCloud } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import { GithubSync } from '@/app/core/setting/sync/github-sync'
import { GiteeSync } from '@/app/core/setting/sync/gitee-sync'
import { GitlabSync } from '@/app/core/setting/sync/gitlab-sync'
import { GiteaSync } from '@/app/core/setting/sync/gitea-sync'
import { S3Sync } from '@/app/core/setting/sync/s3-sync'
import { WebDAVSync } from '@/app/core/setting/sync/webdav-sync'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/hooks/use-toast'
import { SyncStateEnum } from '@/lib/sync/github.types'
import {
  downloadAutoDataSyncNow,
  uploadAutoDataSyncNow,
} from '@/lib/sync/auto-data-sync-queue'
import useChatStore from '@/stores/chat'
import useMarkStore from '@/stores/mark'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import useTagStore from '@/stores/tag'
import { SYNC_PLATFORMS, SyncPlatform } from '@/types/sync'

export default function SyncPage() {
  const t = useTranslations()
  const {
    primaryBackupMethod,
    setPrimaryBackupMethod,
    autoSync,
    setAutoSync,
    autoDataSyncEnabled,
    setAutoDataSyncEnabled,
    excludeSensitiveConfig,
    setExcludeSensitiveConfig,
    autoPullOnOpen,
    setAutoPullOnOpen,
    autoPullOnSwitch,
    setAutoPullOnSwitch,
  } = useSettingStore()
  const {
    syncRepoState,
    giteeSyncRepoState,
    gitlabSyncProjectState,
    giteaSyncRepoState,
    s3Connected,
    webdavConnected,
  } = useSyncStore()
  const { fetchMarks } = useMarkStore()
  const { fetchTags, currentTagId } = useTagStore()
  const { init } = useChatStore()

  const [tab, setTab] = useState<SyncPlatform>(primaryBackupMethod)
  const [isLoading, setIsLoading] = useState(true)
  const [initialSyncChoiceVisible, setInitialSyncChoiceVisible] = useState(false)
  const [initialSyncBusy, setInitialSyncBusy] = useState<'upload' | 'download' | 'later' | null>(null)

  useEffect(() => {
    async function loadPrimaryBackupMethod() {
      try {
        const store = await Store.load('store.json')
        const savedMethod = await store.get<SyncPlatform>('primaryBackupMethod')
        if (savedMethod) {
          await setPrimaryBackupMethod(savedMethod)
          setTab(savedMethod)
        }
      } catch (error) {
        console.error('Failed to load primary backup method:', error)
      } finally {
        setIsLoading(false)
      }
    }

    void loadPrimaryBackupMethod()
  }, [setPrimaryBackupMethod])

  const currentSyncState = getCurrentSyncState(tab)
  const isFileAutoSyncDisabled = currentSyncState !== SyncStateEnum.success
  const shouldShowInitialSyncChoice = autoDataSyncEnabled && currentSyncState === SyncStateEnum.success && initialSyncChoiceVisible

  useEffect(() => {
    async function loadInitialChoiceState() {
      if (!autoDataSyncEnabled || currentSyncState !== SyncStateEnum.success) {
        setInitialSyncChoiceVisible(false)
        return
      }

      const store = await Store.load('store.json')
      const confirmed = await store.get<boolean>(getInitialSyncChoiceKey(tab))
      setInitialSyncChoiceVisible(confirmed !== true)
    }

    void loadInitialChoiceState()
  }, [autoDataSyncEnabled, currentSyncState, tab])

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
      default:
        return syncRepoState
    }
  }

  function getInitialSyncChoiceKey(platform: SyncPlatform) {
    return `autoDataSyncInitialChoice:${platform}`
  }

  function getProviderLabel(platform: SyncPlatform) {
    return platform.charAt(0).toUpperCase() + platform.slice(1)
  }

  async function handleTabChange(value: string) {
    const nextTab = value as SyncPlatform
    setTab(nextTab)
    await setPrimaryBackupMethod(nextTab)
  }

  async function finishInitialSyncChoice() {
    const store = await Store.load('store.json')
    await store.set(getInitialSyncChoiceKey(tab), true)
    await store.save()
    setInitialSyncChoiceVisible(false)
  }

  async function refreshDownloadedData() {
    await Promise.all([
      fetchTags(),
      fetchMarks(),
    ])
    init(currentTagId)
  }

  async function handleInitialUpload() {
    setInitialSyncBusy('upload')
    try {
      await uploadAutoDataSyncNow()
      await finishInitialSyncChoice()
      toast({ description: t('settings.sync.autoDataSyncInitialSuccess') })
    } catch (error) {
      console.error('Initial upload failed:', error)
      toast({ description: t('settings.sync.autoDataSyncInitialFailed'), variant: 'destructive' })
    } finally {
      setInitialSyncBusy(null)
    }
  }

  async function handleInitialDownload() {
    setInitialSyncBusy('download')
    try {
      const ok = await downloadAutoDataSyncNow()
      if (!ok) {
        throw new Error('Failed to download remote data')
      }

      await refreshDownloadedData()
      await finishInitialSyncChoice()
      toast({ description: t('settings.sync.autoDataSyncInitialSuccess') })
    } catch (error) {
      console.error('Initial download failed:', error)
      toast({ description: t('settings.sync.autoDataSyncInitialFailed'), variant: 'destructive' })
    } finally {
      setInitialSyncBusy(null)
    }
  }

  async function handleInitialLater() {
    setInitialSyncBusy('later')
    try {
      await finishInitialSyncChoice()
    } finally {
      setInitialSyncBusy(null)
    }
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
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileUp className="size-6" />
          {t('settings.sync.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('settings.sync.desc')}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('settings.sync.platformSettings')}</h2>
        <Select value={tab} onValueChange={handleTabChange}>
          <SelectTrigger>
            <SelectValue placeholder={t('settings.sync.selectPlatform')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {SYNC_PLATFORMS.map((platform) => (
                <SelectItem key={platform} value={platform}>
                  {getProviderLabel(platform)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {renderSyncContent()}
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
            <Select
              value={autoSync}
              onValueChange={(value) => setAutoSync(value)}
              disabled={isFileAutoSyncDisabled}
            >
              <SelectTrigger className="min-w-32">
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
          <ItemMedia variant="icon"><FileDown className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoPullOnOpen')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoPullOnOpenDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={autoPullOnOpen}
              onCheckedChange={setAutoPullOnOpen}
              disabled={isFileAutoSyncDisabled}
            />
          </ItemActions>
        </Item>

        <Item variant="outline">
          <ItemMedia variant="icon"><Files className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoPullOnSwitch')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoPullOnSwitchDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={autoPullOnSwitch}
              onCheckedChange={setAutoPullOnSwitch}
              disabled={isFileAutoSyncDisabled}
            />
          </ItemActions>
        </Item>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('settings.sync.recordConfigSettings')}</h2>

        <Item variant="outline">
          <ItemMedia variant="icon"><UploadCloud className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoDataSync')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoDataSyncDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={autoDataSyncEnabled}
              onCheckedChange={setAutoDataSyncEnabled}
            />
          </ItemActions>
        </Item>

        {shouldShowInitialSyncChoice && (
          <Alert>
            <ShieldCheck />
            <AlertTitle>{t('settings.sync.autoDataSyncInitialTitle')}</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-3">
                <p>{t('settings.sync.autoDataSyncInitialDesc')}</p>
                <div className="flex flex-col gap-2">
                  <Button size="sm" onClick={handleInitialUpload} disabled={initialSyncBusy !== null}>
                    {initialSyncBusy === 'upload' && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {t('settings.sync.autoDataSyncInitialUploadLocal')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleInitialDownload} disabled={initialSyncBusy !== null}>
                    {initialSyncBusy === 'download' && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {t('settings.sync.autoDataSyncInitialPullRemote')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleInitialLater} disabled={initialSyncBusy !== null}>
                    {t('settings.sync.autoDataSyncInitialLater')}
                  </Button>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Item variant="outline">
          <ItemMedia variant="icon"><ShieldCheck className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoDataSyncPrivacyTitle')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoDataSyncPrivacyDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={excludeSensitiveConfig}
              onCheckedChange={handleExcludeSensitiveConfigChange}
            />
          </ItemActions>
        </Item>
      </section>
    </div>
  )
}

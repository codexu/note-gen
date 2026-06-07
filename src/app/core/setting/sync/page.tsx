'use client';
import { FileUp, FileDown, Files, ShieldCheck, UploadCloud } from "lucide-react"
import { useTranslations } from 'next-intl';
import { GithubSync } from "./github-sync";
import { GiteeSync } from "./gitee-sync";
import { GitlabSync } from "./gitlab-sync";
import { GiteaSync } from "./gitea-sync";
import { S3Sync } from "./s3-sync";
import { WebDAVSync } from "./webdav-sync";
import { SettingType } from '../components/setting-base';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCcw } from "lucide-react"
import useSettingStore from "@/stores/setting";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { confirm } from "@tauri-apps/plugin-dialog";
import { SYNC_PLATFORMS, SyncPlatform } from "@/types/sync";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemMedia } from "@/components/ui/item";
import useSyncStore from "@/stores/sync";
import { SyncStateEnum } from "@/lib/sync/github.types";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import useMarkStore from "@/stores/mark";
import useTagStore from "@/stores/tag";
import useChatStore from "@/stores/chat";
import {
  downloadAutoDataSyncNow,
  uploadAutoDataSyncNow,
} from "@/lib/sync/auto-data-sync-queue";

export default function SyncPage() {
  const t = useTranslations();
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
  const { syncRepoState, giteeSyncRepoState, gitlabSyncProjectState, giteaSyncRepoState, s3Connected, webdavConnected } = useSyncStore()
  const { fetchMarks } = useMarkStore()
  const { fetchTags, currentTagId } = useTagStore()
  const { init } = useChatStore()

  const [tab, setTab] = useState<SyncPlatform>(primaryBackupMethod)
  const [isLoading, setIsLoading] = useState(true)
  const [initialSyncChoiceVisible, setInitialSyncChoiceVisible] = useState(false)
  const [initialSyncBusy, setInitialSyncBusy] = useState<'upload' | 'download' | 'later' | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        const store = await Store.load('store.json')
        const savedMethod = await store.get<SyncPlatform>('primaryBackupMethod')
        if (savedMethod) {
          setPrimaryBackupMethod(savedMethod)
          setTab(savedMethod)
        }
      } catch (err) {
        console.error('Failed to load primary backup method:', err)
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [setPrimaryBackupMethod])

  // Tab 切换时同步更新 Store
  const handleTabChange = async (value: string) => {
    const newTab = value as SyncPlatform
    setTab(newTab)
    await setPrimaryBackupMethod(newTab)
  }

  // 获取当前平台的同步状态
  const getCurrentSyncState = () => {
    switch (primaryBackupMethod) {
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

  const currentSyncState = getCurrentSyncState()
  const isAutoSyncDisabled = currentSyncState !== SyncStateEnum.success
  const shouldShowInitialSyncChoice = autoDataSyncEnabled && currentSyncState === SyncStateEnum.success && initialSyncChoiceVisible

  useEffect(() => {
    async function loadInitialChoiceState() {
      if (!autoDataSyncEnabled || currentSyncState !== SyncStateEnum.success) {
        setInitialSyncChoiceVisible(false)
        return
      }

      const store = await Store.load('store.json')
      const confirmed = await store.get<boolean>(getInitialSyncChoiceKey(primaryBackupMethod))
      setInitialSyncChoiceVisible(confirmed !== true)
    }

    void loadInitialChoiceState()
  }, [autoDataSyncEnabled, currentSyncState, primaryBackupMethod])

  if (isLoading) {
    return (
      <SettingType id="sync" icon={<FileUp />} title={t('settings.sync.title')} desc={t('settings.sync.desc')}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-zinc-400" />
        </div>
      </SettingType>
    )
  }

  const renderSyncContent = () => {
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
        // TODO: Replace with WebDAV sync component in Task 4
        return <WebDAVSync />
      default:
        return <GithubSync />
    }
  }

  function getInitialSyncChoiceKey(platform: SyncPlatform) {
    return `autoDataSyncInitialChoice:${platform}`
  }

  async function finishInitialSyncChoice() {
    const store = await Store.load('store.json')
    await store.set(getInitialSyncChoiceKey(primaryBackupMethod), true)
    await store.save()
    setInitialSyncChoiceVisible(false)
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

      await fetchTags()
      await fetchMarks()
      init(currentTagId)
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

  return (
    <SettingType id="sync" icon={<FileUp />} title={t('settings.sync.title')} desc={t('settings.sync.desc')}>
      {/* 平台选择器 */}
      <div className="mb-6">
        <h3 className="text-sm mb-2 font-bold">{t('settings.sync.platformSettings')}</h3>
        <Select value={tab} onValueChange={handleTabChange}>
          <SelectTrigger className="w-50">
            <SelectValue placeholder={t('settings.sync.selectPlatform')} />
          </SelectTrigger>
          <SelectContent>
            {SYNC_PLATFORMS.map((platform) => (
              <SelectItem key={platform} value={platform}>
                {platform.charAt(0).toUpperCase() + platform.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 同步平台内容 */}
      {renderSyncContent()}

      {/* 笔记设置 */}
      <div className="mt-4">
        <h3 className="text-sm mb-2 font-bold">{t('settings.sync.noteSettings')}</h3>
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
              disabled={isAutoSyncDisabled}
            >
              <SelectTrigger className="w-45">
                <SelectValue placeholder={t('settings.sync.autoSyncOptions.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled">{t('settings.sync.autoSyncOptions.disabled')}</SelectItem>
                <SelectItem value="2">{t('settings.sync.autoSyncOptions.2s')}</SelectItem>
                <SelectItem value="3">{t('settings.sync.autoSyncOptions.3s')}</SelectItem>
                <SelectItem value="5">{t('settings.sync.autoSyncOptions.5s')}</SelectItem>
                <SelectItem value="10">{t('settings.sync.autoSyncOptions.10s')}</SelectItem>
                <SelectItem value="20">{t('settings.sync.autoSyncOptions.20s')}</SelectItem>
                <SelectItem value="30">{t('settings.sync.autoSyncOptions.30s')}</SelectItem>
                <SelectItem value="60">{t('settings.sync.autoSyncOptions.1m')}</SelectItem>
                <SelectItem value="120">{t('settings.sync.autoSyncOptions.2m')}</SelectItem>
              </SelectContent>
            </Select>
          </ItemActions>
        </Item>

        {/* 打开文件时自动拉取 */}
        <Item variant="outline" className="mt-2">
          <ItemMedia variant="icon"><FileDown className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoPullOnOpen')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoPullOnOpenDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={autoPullOnOpen}
              onCheckedChange={setAutoPullOnOpen}
              disabled={isAutoSyncDisabled}
            />
          </ItemActions>
        </Item>

        {/* 切换文件时自动拉取 */}
        <Item variant="outline" className="mt-2">
          <ItemMedia variant="icon"><Files className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoPullOnSwitch')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoPullOnSwitchDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={autoPullOnSwitch}
              onCheckedChange={setAutoPullOnSwitch}
              disabled={isAutoSyncDisabled}
            />
          </ItemActions>
        </Item>
      </div>

      {/* 记录与配置设置 */}
      <div className="mt-4">
        <h3 className="text-sm mb-2 font-bold">{t('settings.sync.recordConfigSettings')}</h3>

        {/* 记录和配置自动同步 */}
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
          <Alert className="mt-2">
            <ShieldCheck />
            <AlertTitle>{t('settings.sync.autoDataSyncInitialTitle')}</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-3">
                <p>{t('settings.sync.autoDataSyncInitialDesc')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleInitialUpload} disabled={initialSyncBusy !== null}>
                    {initialSyncBusy === 'upload' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('settings.sync.autoDataSyncInitialUploadLocal')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleInitialDownload} disabled={initialSyncBusy !== null}>
                    {initialSyncBusy === 'download' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

        <Item variant="outline" className="mt-2">
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
      </div>
    </SettingType>
  )
}

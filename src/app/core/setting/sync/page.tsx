'use client';
import { FileUp, FileDown, Files } from "lucide-react"
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
import { SYNC_PLATFORMS, SyncPlatform } from "@/types/sync";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemMedia } from "@/components/ui/item";
import useSyncStore from "@/stores/sync";
import { SyncStateEnum } from "@/lib/sync/github.types";
import { Switch } from "@/components/ui/switch";

export default function SyncPage() {
  const t = useTranslations();
  const {
    primaryBackupMethod,
    setPrimaryBackupMethod,
    autoSync,
    setAutoSync,
    autoPullOnOpen,
    setAutoPullOnOpen,
    autoPullOnSwitch,
    setAutoPullOnSwitch,
  } = useSettingStore()
  const { syncRepoState, giteeSyncRepoState, gitlabSyncProjectState, giteaSyncRepoState, s3Connected, webdavConnected } = useSyncStore()

  const [tab, setTab] = useState<SyncPlatform>(primaryBackupMethod)
  const [isLoading, setIsLoading] = useState(true)

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

      {/* 全局自动同步设置 */}
      <div className="mt-4">
        <h3 className="text-sm mb-2 font-bold">{t('settings.sync.moreSettings')}</h3>
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
    </SettingType>
  )
}

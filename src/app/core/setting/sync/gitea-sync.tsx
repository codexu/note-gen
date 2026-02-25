'use client'
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import useSyncStore from "@/stores/sync";
import { Badge } from "@/components/ui/badge";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Button } from "@/components/ui/button";
import { checkSyncRepoState, createSyncRepo, getUserInfo } from "@/lib/sync/gitea";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import { GiteaInstanceType, GITEA_INSTANCES } from "@/lib/sync/gitea.types";
import { Eye, EyeOff, Globe, Server, Plus, RefreshCcw } from "lucide-react";
import { Avatar, AvatarImage } from "@/components/ui/avatar";

dayjs.extend(relativeTime)

export function GiteaSync() {
  const t = useTranslations();
  const {
    giteaInstanceType,
    setGiteaInstanceType,
    giteaCustomUrl,
    setGiteaCustomUrl,
    giteaAccessToken,
    setGiteaAccessToken,
    giteaCustomSyncRepo,
    setGiteaCustomSyncRepo
  } = useSettingStore()
  
  const {
    giteaUserInfo,
    setGiteaUserInfo,
    giteaSyncRepoState,
    setGiteaSyncRepoState,
    giteaSyncRepoInfo,
    setGiteaSyncRepoInfo
  } = useSyncStore()

  const [giteaAccessTokenVisible, setGiteaAccessTokenVisible] = useState<boolean>(false)

  // 获取实际使用的仓库名称
  const getRepoName = () => {
    return giteaCustomSyncRepo.trim() || RepoNames.sync
  }


  // 检查 Gitea 仓库状态（仅检查，不创建）
  async function checkRepoState() {
    try {
      setGiteaSyncRepoState(SyncStateEnum.checking)
      // 先清空之前的仓库信息
      setGiteaSyncRepoInfo(undefined)
      
      // 获取并保存用户信息
      const userInfo = await getUserInfo();
      setGiteaUserInfo(userInfo);
      
      // 检查同步仓库状态
      const repoName = getRepoName()
      const syncRepo = await checkSyncRepoState(repoName)
      
      if (syncRepo) {
        setGiteaSyncRepoInfo(syncRepo)
        setGiteaSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteaSyncRepoInfo(undefined)
        setGiteaSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitea repos:', err)
      setGiteaSyncRepoInfo(undefined)
      setGiteaSyncRepoState(SyncStateEnum.fail)
    }
  }

  // 手动创建仓库
  async function createGiteaRepo() {
    try {
      setGiteaSyncRepoState(SyncStateEnum.creating)
      const repoName = getRepoName()
      const info = await createSyncRepo(repoName, true)
      if (info) {
        setGiteaSyncRepoInfo(info)
        setGiteaSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteaSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to create Gitea repo:', err)
      setGiteaSyncRepoState(SyncStateEnum.fail)
    }
  }

  // Token 变化处理
  async function tokenChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value === '') {
      setGiteaSyncRepoState(SyncStateEnum.fail)
      setGiteaSyncRepoInfo(undefined)
      setGiteaUserInfo(undefined)
    }
    setGiteaAccessToken(value)
    const store = await Store.load('store.json');
    await store.set('giteaAccessToken', value)
    await store.save()
    
    // 如果 token 有效，自动检查仓库状态
    if (value.trim()) {
      // 等待一下再检查，避免频繁请求
      setTimeout(() => {
        checkRepoState()
      }, 500)
    }
  }

  // 实例类型变化处理
  async function instanceTypeChangeHandler(value: GiteaInstanceType) {
    await setGiteaInstanceType(value)
    // 如果有 token，重新检查仓库状态
    if (giteaAccessToken.trim()) {
      setTimeout(() => {
        checkRepoState()
      }, 500)
    }
  }

  // 自定义 URL 变化处理
  async function customUrlChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    let value = e.target.value
    // 自动移除末尾的斜杠
    value = value.replace(/\/+$/, '')
    await setGiteaCustomUrl(value)
    // 如果是自建实例且有 token，重新检查仓库状态
    if (giteaInstanceType === GiteaInstanceType.SELF_HOSTED && giteaAccessToken.trim() && value.trim()) {
      setTimeout(() => {
        checkRepoState()
      }, 500)
    }
  }

  // 获取当前实例的 Token 创建 URL
  function getTokenCreateUrl() {
    if (giteaInstanceType === GiteaInstanceType.SELF_HOSTED) {
      return giteaCustomUrl ? `${giteaCustomUrl}/user/settings/applications` : '#'
    }
    const instance = GITEA_INSTANCES[giteaInstanceType]
    return `${instance.baseUrl}/user/settings/applications`
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      
      // 加载实例类型
      const instanceType = await store.get<GiteaInstanceType>('giteaInstanceType')
      if (instanceType) {
        setGiteaInstanceType(instanceType)
      }
      
      // 加载自定义 URL
      const customUrl = await store.get<string>('giteaCustomUrl')
      if (customUrl) {
        setGiteaCustomUrl(customUrl)
      }
      
      // 加载访问令牌
      const token = await store.get<string>('giteaAccessToken')
      if (token) {
        setGiteaAccessToken(token)
        // 如果有 token，自动检查仓库状态
        checkRepoState()
      } else {
        setGiteaAccessToken('')
      }
    }
    init()
  }, [])



  return (
    <div className="rounded-md border p-4">
      <div className="flex justify-between items-center mb-2">
        <div className="flex gap-2 items-center">
          <span className="font-semibold">Gitea {t('settings.sync.settings')}</span>
        </div>
        <Badge className={`${giteaSyncRepoState === SyncStateEnum.success ? 'bg-green-600' : 'bg-zinc-500'}`}>
          {giteaSyncRepoState === SyncStateEnum.success ? 'Connected' : giteaSyncRepoState === SyncStateEnum.checking ? 'Checking' : giteaSyncRepoState === SyncStateEnum.creating ? 'Creating' : 'Not Connected'}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t('settings.sync.platformDesc')}</p>

      {/* 实例类型选择 */}
      <div className="space-y-2 mb-4">
        <label className="text-sm font-medium">{t('settings.sync.giteaInstanceType')}</label>
        <Select value={giteaInstanceType} onValueChange={instanceTypeChangeHandler}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('settings.sync.giteaInstanceTypePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GiteaInstanceType.OFFICIAL}>
              <div className="flex items-center gap-2">
                <Globe className="size-4" />
                <div>
                  <div className="font-medium">Gitea.com</div>
                </div>
              </div>
            </SelectItem>
            <SelectItem value={GiteaInstanceType.SELF_HOSTED}>
              <div className="flex items-center gap-2">
                <Server className="size-4" />
                <div>
                  <div className="font-medium">{t('settings.sync.giteaInstanceTypeOptions.selfHosted')}</div>
                </div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('settings.sync.giteaInstanceTypeDesc')}</p>
      </div>

      {/* 自定义 URL（自建实例时显示） */}
      {giteaInstanceType === GiteaInstanceType.SELF_HOSTED && (
        <div className="space-y-2 mb-4">
          <label className="text-sm font-medium">Gitea URL</label>
          <Input
            value={giteaCustomUrl}
            onChange={customUrlChangeHandler}
            placeholder="https://gitea.example.com"
            type="url"
          />
          <p className="text-xs text-muted-foreground">{t('settings.sync.giteaInstanceTypeOptions.selfHostedDesc')}</p>
        </div>
      )}

      {/* Token 输入 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Gitea Access Token</label>
        <div className="flex gap-2">
          <Input
            value={giteaAccessToken}
            onChange={tokenChangeHandler}
            type={giteaAccessTokenVisible ? 'text' : 'password'}
            placeholder={t('settings.sync.enterToken')}
          />
          <Button variant="outline" size="icon" onClick={() => setGiteaAccessTokenVisible(!giteaAccessTokenVisible)}>
            {giteaAccessTokenVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
        <OpenBroswer
          url={getTokenCreateUrl()}
          title={t('settings.sync.newToken')}
          className="text-sm text-blue-500 hover:underline"
        />
      </div>

      {/* 自定义仓库 */}
      <div className="mt-4 space-y-2">
        <label className="text-sm font-medium">{t('settings.sync.customSyncRepo')}</label>
        <Input
          value={giteaCustomSyncRepo}
          onChange={(e) => setGiteaCustomSyncRepo(e.target.value)}
          placeholder={RepoNames.sync}
        />
        <p className="text-xs text-muted-foreground">{t('settings.sync.customSyncRepoDesc')}</p>
      </div>

      {/* 操作按钮 */}
      <div className="mt-4 flex gap-2 flex-wrap">
        {giteaAccessToken ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={checkRepoState}
              disabled={giteaSyncRepoState === SyncStateEnum.checking || giteaSyncRepoState === SyncStateEnum.creating}
            >
              {giteaSyncRepoState === SyncStateEnum.checking || giteaSyncRepoState === SyncStateEnum.creating ? (
                <>
                  <RefreshCcw className="size-4 mr-1 animate-spin" />
                  {giteaSyncRepoState === SyncStateEnum.checking ? t('settings.sync.checking') : t('settings.sync.creating')}
                </>
              ) : (
                <>
                  <RefreshCcw className="size-4 mr-1" />
                  {t('settings.sync.checkRepo')}
                </>
              )}
            </Button>
            {giteaSyncRepoState === SyncStateEnum.fail && (
              <Button variant="outline" size="sm" onClick={createGiteaRepo}>
                <Plus className="size-4 mr-1" />
                {t('settings.sync.createRepo')}
              </Button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <RefreshCcw className="size-4" />
            {t('settings.sync.enterTokenHint')}
          </div>
        )}
      </div>

      {/* 仓库信息 */}
      {giteaSyncRepoInfo && (
        <div className="border-t mt-4 pt-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-10">
              <AvatarImage src={giteaUserInfo?.avatar_url || ''} />
            </Avatar>
            <div>
              <h3 className="text-xl font-bold mb-1">
                <OpenBroswer title={giteaSyncRepoInfo?.full_name || ''} url={giteaSyncRepoInfo?.html_url || ''} />
              </h3>
              <p className="text-sm text-zinc-500">
                {giteaSyncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public')} · {t('settings.sync.createdAt', { time: dayjs(giteaSyncRepoInfo?.created_at).fromNow() })} · {t('settings.sync.updatedAt', { time: dayjs(giteaSyncRepoInfo?.updated_at).fromNow() })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'
import { Input } from "@/components/ui/input";
import { FormItem } from "../components/setting-base";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemMedia } from '@/components/ui/item';
import { useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import useSyncStore from "@/stores/sync";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Button } from "@/components/ui/button";
import { checkSyncRepoState, createSyncRepo, getUserInfo } from "@/lib/sync/gitea";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import { GiteaInstanceType, GITEA_INSTANCES } from "@/lib/sync/gitea.types";
import { DatabaseBackup, Eye, EyeOff, Globe, Server, Plus, RefreshCcw } from "lucide-react";
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
    giteaAutoSync,
    setGiteaAutoSync,
    primaryBackupMethod,
    setPrimaryBackupMethod,
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
    const value = e.target.value
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

  // 获取当前实例显示名称
  function getInstanceDisplayName() {
    if (giteaInstanceType === GiteaInstanceType.SELF_HOSTED) {
      return giteaCustomUrl || '自建实例'
    }
    return GITEA_INSTANCES[giteaInstanceType].name
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
    <div className="space-y-8">
      <FormItem title={t('settings.sync.giteaInstanceType')} desc={t('settings.sync.giteaInstanceTypeDesc')}>
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
      </FormItem>
      {giteaInstanceType === GiteaInstanceType.SELF_HOSTED && (
        <FormItem title="Gitea URL" desc={t('settings.sync.giteaInstanceTypeOptions.selfHostedDesc')}>
          <Input 
            value={giteaCustomUrl} 
            onChange={customUrlChangeHandler} 
            placeholder="https://gitea.example.com"
            type="url"
          />
        </FormItem>
      )}

      <FormItem title="Gitea Access Token" desc={t('settings.sync.giteaAccessTokenDesc', { instanceDisplayName: getInstanceDisplayName() })}>
        <OpenBroswer 
          url={getTokenCreateUrl()} 
          title={t('settings.sync.newToken')} 
          className="mb-2" 
        />
        <div className="flex gap-2">
          <Input 
            value={giteaAccessToken} 
            onChange={tokenChangeHandler} 
            type={giteaAccessTokenVisible ? 'text' : 'password'} 
          />
          <Button variant="outline" size="icon" onClick={() => setGiteaAccessTokenVisible(!giteaAccessTokenVisible)}>
            {giteaAccessTokenVisible ? <Eye /> : <EyeOff />}
          </Button>
        </div>
      </FormItem>
      <FormItem title={t('settings.sync.customSyncRepo')} desc={t('settings.sync.customSyncRepoDesc')}>
        <Input 
          value={giteaCustomSyncRepo} 
          onChange={(e) => {
            setGiteaCustomSyncRepo(e.target.value)
          }}
          placeholder={RepoNames.sync}
        />
      </FormItem>
      <FormItem title={t('settings.sync.repoStatus')}>
        <Card>
          <CardHeader className={`${giteaSyncRepoInfo ? 'border-b' : ''}`}>
            <CardTitle className="flex justify-between items-center">
              <div className="flex gap-2 items-center">
                <DatabaseBackup className="size-4" />
                {getRepoName()}（{giteaSyncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public')}）
              </div>
              <Badge className={`${giteaSyncRepoState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>
                {giteaSyncRepoState}
              </Badge>
            </CardTitle>
            <CardDescription>
              <span>{t('settings.sync.syncRepoDesc')}</span>
            </CardDescription>
            {/* 手动检测和创建按钮 */}
            {giteaAccessToken && (
              <div className="mt-3 flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={checkRepoState}
                  disabled={giteaSyncRepoState === SyncStateEnum.checking}
                >
                  <RefreshCcw className="size-4 mr-1" />
                  {giteaSyncRepoState === SyncStateEnum.checking ? t('settings.sync.checking') : t('settings.sync.checkRepo')}
                </Button>
                {giteaSyncRepoState === SyncStateEnum.fail && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={createGiteaRepo}
                  >
                    <Plus className="size-4 mr-1" />
                    {t('settings.sync.createRepo')}
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          {
            giteaSyncRepoInfo &&
            <CardContent className="flex items-center gap-4 mt-4">
              <Avatar className="size-12">
                <AvatarImage src={giteaUserInfo?.avatar_url || ''} />
              </Avatar>
              <div>
                <h3 className="text-xl font-bold mb-1">
                  <OpenBroswer title={giteaSyncRepoInfo?.full_name || ''} url={giteaSyncRepoInfo?.html_url || ''} />
                </h3>
                <CardDescription className="flex">
                  <p className="text-zinc-500 leading-6">{t('settings.sync.createdAt', { time: dayjs(giteaSyncRepoInfo?.created_at).fromNow() })}，</p>
                  <p className="text-zinc-500 leading-6">{t('settings.sync.updatedAt', { time: dayjs(giteaSyncRepoInfo?.updated_at).fromNow() })}。</p>
                </CardDescription>
              </div>
            </CardContent>
          }
        </Card>
      </FormItem>
      {
        giteaSyncRepoInfo &&
        <FormItem title={t('settings.others')}>
          <Item variant="outline">
            <ItemMedia variant="icon"><RefreshCcw className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('settings.sync.autoSync')}</ItemTitle>
              <ItemDescription>{t('settings.sync.autoSyncDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select
                value={giteaAutoSync}
                onValueChange={(value) => setGiteaAutoSync(value)}
                disabled={!giteaAccessToken || giteaSyncRepoState !== SyncStateEnum.success}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t('settings.sync.autoSyncOptions.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">{t('settings.sync.autoSyncOptions.disabled')}</SelectItem>
                  <SelectItem value="10">{t('settings.sync.autoSyncOptions.10s')}</SelectItem>
                  <SelectItem value="30">{t('settings.sync.autoSyncOptions.30s')}</SelectItem>
                  <SelectItem value="60">{t('settings.sync.autoSyncOptions.1m')}</SelectItem>
                  <SelectItem value="300">{t('settings.sync.autoSyncOptions.5m')}</SelectItem>
                  <SelectItem value="1800">{t('settings.sync.autoSyncOptions.30m')}</SelectItem>
                </SelectContent>
              </Select>
            </ItemActions>
          </Item>
        </FormItem>
      }

      {/* 主要备份方式设置 */}
        {primaryBackupMethod === 'gitea' ? (
          <Button disabled variant="outline">
            {t('settings.sync.isPrimaryBackup', { type: 'Gitea' })}
          </Button>
        ) : (
          <Button 
            variant="outline" 
            onClick={() => setPrimaryBackupMethod('gitea')}
            disabled={!giteaAccessToken || giteaSyncRepoState !== SyncStateEnum.success}
          >
            {t('settings.sync.setPrimaryBackup')}
          </Button>
        )}
    </div>
  )
}

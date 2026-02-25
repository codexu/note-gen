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
import { checkSyncProjectState, createSyncProject, getUserInfo } from "@/lib/sync/gitlab";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import { GitlabInstanceType, GITLAB_INSTANCES } from "@/lib/sync/gitlab.types";
import { Eye, EyeOff, Globe, Server, Plus, RefreshCcw } from "lucide-react";
import { Avatar, AvatarImage } from "@/components/ui/avatar";

dayjs.extend(relativeTime)

export function GitlabSync() {
  const t = useTranslations();
  const {
    gitlabInstanceType,
    setGitlabInstanceType,
    gitlabCustomUrl,
    setGitlabCustomUrl,
    gitlabAccessToken,
    setGitlabAccessToken,
    gitlabCustomSyncRepo,
    setGitlabCustomSyncRepo
  } = useSettingStore()
  
  const {
    gitlabUserInfo,
    gitlabSyncProjectState,
    setGitlabSyncProjectState,
    gitlabSyncProjectInfo,
    setGitlabSyncProjectInfo
  } = useSyncStore()

  const [gitlabAccessTokenVisible, setGitlabAccessTokenVisible] = useState<boolean>(false)

  // 获取实际使用的仓库名称
  const getRepoName = () => {
    return gitlabCustomSyncRepo.trim() || RepoNames.sync
  }


  // 检查 Gitlab 项目状态（仅检查，不创建）
  async function checkProjectState() {
    try {
      setGitlabSyncProjectState(SyncStateEnum.checking)
      // 先清空之前的项目信息
      setGitlabSyncProjectInfo(undefined)
      
      await getUserInfo();
      // 检查同步项目状态
      const repoName = getRepoName()
      const syncProject = await checkSyncProjectState(repoName)
      
      if (syncProject) {
        setGitlabSyncProjectInfo(syncProject)
        setGitlabSyncProjectState(SyncStateEnum.success)
      } else {
        setGitlabSyncProjectInfo(undefined)
        setGitlabSyncProjectState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check GitLab projects:', err)
      setGitlabSyncProjectInfo(undefined)
      setGitlabSyncProjectState(SyncStateEnum.fail)
    }
  }

  // 手动创建项目
  async function createGitlabProject() {
    try {
      setGitlabSyncProjectState(SyncStateEnum.creating)
      const repoName = getRepoName()
      const info = await createSyncProject(repoName, true)
      if (info) {
        setGitlabSyncProjectInfo(info)
        setGitlabSyncProjectState(SyncStateEnum.success)
      } else {
        setGitlabSyncProjectState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to create Gitlab project:', err)
      setGitlabSyncProjectState(SyncStateEnum.fail)
    }
  }

  // Token 变化处理
  async function tokenChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value === '') {
      setGitlabSyncProjectState(SyncStateEnum.fail)
      setGitlabSyncProjectInfo(undefined)
    }
    setGitlabAccessToken(value)
    const store = await Store.load('store.json');
    await store.set('gitlabAccessToken', value)
    await store.save()
  }

  // 实例类型变化处理
  async function instanceTypeChangeHandler(value: GitlabInstanceType) {
    await setGitlabInstanceType(value)
  }

  // 自定义 URL 变化处理
  async function customUrlChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    await setGitlabCustomUrl(value)
  }

  // 获取当前实例的 Token 创建 URL
  function getTokenCreateUrl() {
    if (gitlabInstanceType === GitlabInstanceType.SELF_HOSTED) {
      return gitlabCustomUrl ? `${gitlabCustomUrl}/-/user_settings/personal_access_tokens` : '#'
    }
    const instance = GITLAB_INSTANCES[gitlabInstanceType]
    return `${instance.baseUrl}/-/user_settings/personal_access_tokens`
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      
      // 加载实例类型
      const instanceType = await store.get<GitlabInstanceType>('gitlabInstanceType')
      if (instanceType) {
        setGitlabInstanceType(instanceType)
      }
      
      // 加载自定义 URL
      const customUrl = await store.get<string>('gitlabCustomUrl')
      if (customUrl) {
        setGitlabCustomUrl(customUrl)
      }
      
      // 加载访问令牌
      const token = await store.get<string>('gitlabAccessToken')
      if (token) {
        setGitlabAccessToken(token)
      } else {
        setGitlabAccessToken('')
      }
    }
    init()
  }, [])



  return (
    <div className="rounded-md border p-4">
      <div className="flex justify-between items-center mb-2">
        <div className="flex gap-2 items-center">
          <span className="font-semibold">GitLab {t('settings.sync.settings')}</span>
        </div>
        <Badge className={`${gitlabSyncProjectState === SyncStateEnum.success ? 'bg-green-600' : 'bg-zinc-500'}`}>
          {gitlabSyncProjectState === SyncStateEnum.success ? 'Connected' : gitlabSyncProjectState === SyncStateEnum.checking ? 'Checking' : gitlabSyncProjectState === SyncStateEnum.creating ? 'Creating' : 'Not Connected'}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t('settings.sync.platformDesc')}</p>

      {/* 实例类型选择 */}
      <div className="space-y-2 mb-4">
        <label className="text-sm font-medium">{t('settings.sync.gitlabInstanceType')}</label>
        <Select value={gitlabInstanceType} onValueChange={instanceTypeChangeHandler}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('settings.sync.gitlabInstanceTypePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GitlabInstanceType.OFFICIAL}>
              <div className="flex items-center gap-2">
                <Globe className="size-4" />
                <div>
                  <div className="font-medium">GitLab.com</div>
                </div>
              </div>
            </SelectItem>
            <SelectItem value={GitlabInstanceType.JIHULAB}>
              <div className="flex items-center gap-2">
                <Globe className="size-4" />
                <div>
                  <div className="font-medium">极狐</div>
                </div>
              </div>
            </SelectItem>
            <SelectItem value={GitlabInstanceType.SELF_HOSTED}>
              <div className="flex items-center gap-2">
                <Server className="size-4" />
                <div>
                  <div className="font-medium">{t('settings.sync.gitlabInstanceTypeOptions.selfHosted')}</div>
                </div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('settings.sync.gitlabInstanceTypeDesc')}</p>
      </div>

      {/* 自定义 URL（自建实例时显示） */}
      {gitlabInstanceType === GitlabInstanceType.SELF_HOSTED && (
        <div className="space-y-2 mb-4">
          <label className="text-sm font-medium">GitLab URL</label>
          <Input
            value={gitlabCustomUrl}
            onChange={customUrlChangeHandler}
            placeholder="https://gitlab.example.com"
            type="url"
          />
          <p className="text-xs text-muted-foreground">{t('settings.sync.gitlabInstanceTypeOptions.selfHostedDesc')}</p>
        </div>
      )}

      {/* Token 输入 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">GitLab Access Token</label>
        <div className="flex gap-2">
          <Input
            value={gitlabAccessToken}
            onChange={tokenChangeHandler}
            type={gitlabAccessTokenVisible ? 'text' : 'password'}
            placeholder={t('settings.sync.enterToken')}
          />
          <Button variant="outline" size="icon" onClick={() => setGitlabAccessTokenVisible(!gitlabAccessTokenVisible)}>
            {gitlabAccessTokenVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
          value={gitlabCustomSyncRepo}
          onChange={(e) => setGitlabCustomSyncRepo(e.target.value)}
          placeholder={RepoNames.sync}
        />
        <p className="text-xs text-muted-foreground">{t('settings.sync.customSyncRepoDesc')}</p>
      </div>

      {/* 操作按钮 */}
      <div className="mt-4 flex gap-2 flex-wrap">
        {gitlabAccessToken ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={checkProjectState}
              disabled={gitlabSyncProjectState === SyncStateEnum.checking || gitlabSyncProjectState === SyncStateEnum.creating}
            >
              {gitlabSyncProjectState === SyncStateEnum.checking || gitlabSyncProjectState === SyncStateEnum.creating ? (
                <>
                  <RefreshCcw className="size-4 mr-1 animate-spin" />
                  {gitlabSyncProjectState === SyncStateEnum.checking ? t('settings.sync.checking') : t('settings.sync.creating')}
                </>
              ) : (
                <>
                  <RefreshCcw className="size-4 mr-1" />
                  {t('settings.sync.checkRepo')}
                </>
              )}
            </Button>
            {gitlabSyncProjectState === SyncStateEnum.fail && (
              <Button variant="outline" size="sm" onClick={createGitlabProject}>
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
      {gitlabSyncProjectInfo && (
        <div className="border-t mt-4 pt-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-10">
              <AvatarImage src={gitlabUserInfo?.avatar_url || ''} />
            </Avatar>
            <div>
              <h3 className="text-xl font-bold mb-1">
                <OpenBroswer title={gitlabSyncProjectInfo?.name_with_namespace || ''} url={gitlabSyncProjectInfo?.web_url || ''} />
              </h3>
              <p className="text-sm text-zinc-500">
                {gitlabSyncProjectInfo?.visibility === 'public' ? t('settings.sync.public') : t('settings.sync.private')} · {t('settings.sync.createdAt', { time: dayjs(gitlabSyncProjectInfo?.created_at).fromNow() })} · {t('settings.sync.updatedAt', { time: dayjs(gitlabSyncProjectInfo?.updated_at).fromNow() })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

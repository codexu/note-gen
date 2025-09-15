'use client'
import { Input } from "@/components/ui/input";
import { FormItem, SettingPanel, SettingRow } from "../components/setting-base";
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
import { checkSyncProjectState, createSyncProject, getUserInfo } from "@/lib/gitlab";
import { RepoNames, SyncStateEnum } from "@/lib/github.types";
import { GitlabInstanceType, GITLAB_INSTANCES } from "@/lib/gitlab.types";
import { DatabaseBackup, Eye, EyeOff, Globe, Server, Plus, RefreshCcw } from "lucide-react";
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
    gitlabAutoSync,
    setGitlabAutoSync,
    primaryBackupMethod,
    setPrimaryBackupMethod,
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

  // 获取当前实例显示名称
  function getInstanceDisplayName() {
    if (gitlabInstanceType === GitlabInstanceType.SELF_HOSTED) {
      return gitlabCustomUrl || '自建实例'
    }
    return GITLAB_INSTANCES[gitlabInstanceType].name
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
    <div className="mt-4">
      {/* Gitlab 实例选择 */}
      <SettingRow>
        <FormItem title={t('settings.sync.gitlabInstanceType')} desc={t('settings.sync.gitlabInstanceTypeDesc')}>
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
        </FormItem>
      </SettingRow>

      {/* 自建实例 URL 输入 */}
      {gitlabInstanceType === GitlabInstanceType.SELF_HOSTED && (
        <SettingRow>
          <FormItem title="GitLab URL" desc={t('settings.sync.gitlabInstanceTypeOptions.selfHostedDesc')}>
            <Input 
              value={gitlabCustomUrl} 
              onChange={customUrlChangeHandler} 
              placeholder="https://gitlab.example.com"
              type="url"
            />
          </FormItem>
        </SettingRow>
      )}

      {/* Access Token 输入 */}
      <SettingRow>
        <FormItem title="GitLab Access Token" desc={t('settings.sync.gitlabAccessTokenDesc', { instanceDisplayName: getInstanceDisplayName() })}>
          <OpenBroswer 
            url={getTokenCreateUrl()} 
            title={t('settings.sync.newToken')} 
            className="mb-2" 
          />
          <div className="flex gap-2">
            <Input 
              value={gitlabAccessToken} 
              onChange={tokenChangeHandler} 
              type={gitlabAccessTokenVisible ? 'text' : 'password'} 
            />
            <Button variant="outline" size="icon" onClick={() => setGitlabAccessTokenVisible(!gitlabAccessTokenVisible)}>
              {gitlabAccessTokenVisible ? <Eye /> : <EyeOff />}
            </Button>
          </div>
        </FormItem>
      </SettingRow>

      {/* 自定义仓库名输入 */}
      <SettingRow>
        <FormItem title={t('settings.sync.customSyncRepo')} desc={t('settings.sync.customSyncRepoDesc')}>
          <Input 
            value={gitlabCustomSyncRepo} 
            onChange={(e) => {
              setGitlabCustomSyncRepo(e.target.value)
            }}
            placeholder={RepoNames.sync}
          />
        </FormItem>
      </SettingRow>

      {/* 项目状态显示 */}
      <SettingRow>
        <FormItem title={t('settings.sync.repoStatus')}>
          <Card>
            <CardHeader className={`${gitlabSyncProjectInfo ? 'border-b' : ''}`}>
              <CardTitle className="flex justify-between items-center">
                <div className="flex gap-2 items-center">
                  <DatabaseBackup className="size-4" />
                  {getRepoName()}（{gitlabSyncProjectInfo?.visibility === 'public' ? t('settings.sync.public') : t('settings.sync.private')}）
                </div>
                <Badge className={`${gitlabSyncProjectState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>
                  {gitlabSyncProjectState}
                </Badge>
              </CardTitle>
              <CardDescription>
                <span>{t('settings.sync.syncRepoDesc')}</span>
              </CardDescription>
              {/* 手动检测和创建按钮 */}
              {gitlabAccessToken && (
                <div className="mt-3 flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={checkProjectState}
                    disabled={gitlabSyncProjectState === SyncStateEnum.checking}
                  >
                    <RefreshCcw className="size-4 mr-1" />
                    {gitlabSyncProjectState === SyncStateEnum.checking ? t('settings.sync.checking') : t('settings.sync.checkRepo')}
                  </Button>
                  {gitlabSyncProjectState === SyncStateEnum.fail && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={createGitlabProject}
                    >
                      <Plus className="size-4 mr-1" />
                      {t('settings.sync.createRepo')}
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            {
              gitlabSyncProjectInfo &&
              <CardContent className="flex items-center gap-4 mt-4">
                <Avatar className="size-12">
                  <AvatarImage src={gitlabUserInfo?.avatar_url || ''} />
                </Avatar>
                <div>
                  <h3 className="text-xl font-bold mb-1">
                    <OpenBroswer title={gitlabSyncProjectInfo?.name_with_namespace || ''} url={gitlabSyncProjectInfo?.web_url || ''} />
                  </h3>
                  <CardDescription className="flex">
                    <p className="text-zinc-500 leading-6">{t('settings.sync.createdAt', { time: dayjs(gitlabSyncProjectInfo?.created_at).fromNow() })}，</p>
                    <p className="text-zinc-500 leading-6">{t('settings.sync.updatedAt', { time: dayjs(gitlabSyncProjectInfo?.updated_at).fromNow() })}。</p>
                  </CardDescription>
                </div>
              </CardContent>
            }
          </Card>
        </FormItem>
      </SettingRow>

      {/* 自动同步设置 */}
      {
        gitlabSyncProjectInfo &&
        <>
          <SettingPanel title={t('settings.sync.autoSync')} desc={t('settings.sync.autoSyncDesc')}>
            <Select
              value={gitlabAutoSync}
              onValueChange={(value) => setGitlabAutoSync(value)}
              disabled={!gitlabAccessToken || gitlabSyncProjectState !== SyncStateEnum.success}
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
          </SettingPanel>
        </>
      }

      {/* 主要备份方式设置 */}
      <SettingRow className="mb-4">
        {primaryBackupMethod === 'gitlab' ? (
          <Button disabled variant="outline">
            {t('settings.sync.isPrimaryBackup', { type: 'GitLab' })}
          </Button>
        ) : (
          <Button 
            variant="outline" 
            onClick={() => setPrimaryBackupMethod('gitlab')}
            disabled={!gitlabAccessToken || gitlabSyncProjectState !== SyncStateEnum.success}
          >
            {t('settings.sync.setPrimaryBackup')}
          </Button>
        )}
      </SettingRow>
    </div>
  )
}

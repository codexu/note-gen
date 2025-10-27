'use client'
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Switch } from "@/components/ui/switch";
import { getUserInfo } from "@/lib/sync/github";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import useImageStore from "@/stores/imageHosting";
import { createImageRepo, checkImageRepoState } from "@/lib/imageHosting/github";
import { getImageRepoName } from "@/lib/sync/repo-utils";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

dayjs.extend(relativeTime)

export function GithubImageHosting() {

  const t = useTranslations();
  const { setImageRepoUserInfo, mainImageHosting, setMainImageHosting } = useImageStore()
  const [accessTokenVisible, setAccessTokenVisible] = useState(false)

  const {
    githubImageAccessToken,
    setGithubImageAccessToken,
    useImageRepo,
    jsdelivr,
    setJsdelivr,
    githubCustomImageRepo,
    setGithubCustomImageRepo,
  } = useSettingStore()
  const {
    imageRepoState,
    setImageRepoState,
    imageRepoInfo,
    setImageRepoInfo,
  } = useImageStore()

  // 检查按钮是否禁用
  const isChecking = imageRepoState === SyncStateEnum.checking;
  const isCreating = imageRepoState === SyncStateEnum.creating;

  // 创建 GitHub 仓库
  async function createGithubRepo() {
    try {
      setImageRepoState(SyncStateEnum.creating)
      const actualRepoName = await getImageRepoName()
      const info = await createImageRepo(actualRepoName)
      if (info) {
        setImageRepoInfo(info)
        setImageRepoState(SyncStateEnum.success)
      } else {
        setImageRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to create GitHub repo:', err)
      setImageRepoState(SyncStateEnum.fail)
    }
  }

  // 检查 GitHub 仓库状态
  async function checkGithubRepos() {
    try {
      setImageRepoState(SyncStateEnum.checking)
      const store = await Store.load('store.json');
      const accessToken = await store.get<string>('githubImageAccessToken')
      const userInfo = await getUserInfo(accessToken);
      if (!userInfo) {
        setImageRepoState(SyncStateEnum.fail)
        return;
      }
      setImageRepoUserInfo(userInfo)
      // 获取实际使用的仓库名（自定义或默认）
      const actualRepoName = await getImageRepoName()
      // 检查图床仓库状态
      const imageRepo = await checkImageRepoState(actualRepoName)
      if (imageRepo) {
        setImageRepoInfo(imageRepo)
        setImageRepoState(SyncStateEnum.success)
      } else {
        setImageRepoInfo(undefined)
        setImageRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check GitHub repos:', err)
      setImageRepoState(SyncStateEnum.fail)
    }
  }

  async function tokenChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value === '') {
      setImageRepoState(SyncStateEnum.fail)
      setImageRepoInfo(undefined)
    }
    await setGithubImageAccessToken(value)
    if (value) {
      checkGithubRepos()
    }
  }

  async function customRepoChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    await setGithubCustomImageRepo(value)
    // 如果有token，重新检查仓库状态
    if (githubImageAccessToken) {
      checkGithubRepos()
    }
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const token = await store.get<string>('githubImageAccessToken')
      if (token) {
        await setGithubImageAccessToken(token)
        checkGithubRepos()
      } else {
        await setGithubImageAccessToken('')
      }
    }
    init()
  }, [])

  const getStatusIcon = () => {
    switch (imageRepoState) {
      case SyncStateEnum.success:
        return <CheckCircle className="size-4 text-green-500" />;
      case SyncStateEnum.checking:
        return <Loader2 className="size-4 animate-spin text-blue-500" />;
      case SyncStateEnum.creating:
        return <Loader2 className="size-4 animate-spin text-yellow-500" />;
      case SyncStateEnum.fail:
      default:
        return <XCircle className="size-4 text-red-500" />;
    }
  };

  const getStatusText = () => {
    switch (imageRepoState) {
      case SyncStateEnum.success:
        return t('settings.imageHosting.github.repoExists');
      case SyncStateEnum.checking:
        return t('settings.imageHosting.github.checking');
      case SyncStateEnum.creating:
        return t('settings.imageHosting.github.creating');
      case SyncStateEnum.fail:
      default:
        return t('settings.imageHosting.github.repoNotExists');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>GitHub 图床</CardTitle>
            <CardDescription>
              使用 GitHub 仓库作为图片存储服务
            </CardDescription>
          </div>
          {imageRepoInfo && (
            <Button 
              onClick={() => setMainImageHosting('github')}
              disabled={mainImageHosting === 'github' || !githubImageAccessToken || imageRepoState !== SyncStateEnum.success}
              size="sm"
            >
              {mainImageHosting === 'github' ? 
                '当前主要图床' : 
                t('settings.imageHosting.setPrimaryBackup')
              }
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 状态显示 */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{t('settings.imageHosting.github.repoStatus')}</span>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="text-sm">{getStatusText()}</span>
          </div>
        </div>

        {/* 仓库操作按钮 */}
        {githubImageAccessToken && imageRepoState === SyncStateEnum.fail && (
          <div className="flex gap-2">
            <Button 
              onClick={createGithubRepo}
              size="sm"
              disabled={isCreating || isChecking}
            >
              {isCreating ? '创建中...' : '创建仓库'}
            </Button>
            <Button 
              onClick={checkGithubRepos}
              size="sm"
              variant="outline"
              disabled={isChecking || isCreating}
            >
              {isChecking ? '检测中...' : '重新检测'}
            </Button>
          </div>
        )}

        {/* 自定义仓库名 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">自定义图床仓库名</label>
          <p className="text-xs text-muted-foreground">留空则使用默认仓库名 &quot;{RepoNames.image}&quot;</p>
          <Input 
            value={githubCustomImageRepo} 
            onChange={customRepoChangeHandler}
            placeholder={`默认: ${RepoNames.image}`}
          />
        </div>

        {/* Access Token 配置 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">GitHub Access Token</label>
          <p className="text-xs text-muted-foreground">{t('settings.sync.newTokenDesc')}</p>
          <OpenBroswer url="https://github.com/settings/tokens/new" title={t('settings.sync.newToken')} className="mb-2" />
          <div className="flex gap-2">
            <Input 
              value={githubImageAccessToken} 
              onChange={tokenChangeHandler} 
              type={accessTokenVisible ? 'text' : 'password'} 
              placeholder="输入 GitHub Access Token"
            />
            <Button variant="outline" size="icon" onClick={() => setAccessTokenVisible(!accessTokenVisible)}>
              {accessTokenVisible ? <Eye /> : <EyeOff />}
            </Button>
          </div>
        </div>

        {/* 仓库信息 */}
        {imageRepoInfo && (
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('settings.sync.repoStatus')}</label>
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-4">
                <Avatar className="size-12">
                  <AvatarImage src={imageRepoInfo?.owner.avatar_url || ''} />
                </Avatar>
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2 mb-1">
                    <OpenBroswer title={imageRepoInfo?.full_name || ''} url={imageRepoInfo?.html_url || ''} />
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.sync.createdAt', { time: dayjs(imageRepoInfo?.created_at).fromNow() })}，
                    {t('settings.sync.updatedAt', { time: dayjs(imageRepoInfo?.updated_at).fromNow() })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* JSDelivr 设置 */}
        {imageRepoInfo && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">{t('settings.sync.jsdelivrSetting')}</label>
                <p className="text-xs text-muted-foreground">{t('settings.sync.jsdelivrSettingDesc')}</p>
              </div>
              <Switch 
                checked={jsdelivr} 
                onCheckedChange={(checked) => setJsdelivr(checked)} 
                disabled={!githubImageAccessToken || imageRepoState !== SyncStateEnum.success || !useImageRepo}
              />
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  )
}
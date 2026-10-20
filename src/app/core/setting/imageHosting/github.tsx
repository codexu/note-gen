'use client'
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TokenInputControl } from "@/app/core/setting/sync/components/token-input-control";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

dayjs.extend(relativeTime)

export function GithubImageHosting() {

  const t = useTranslations();
  const { setImageRepoUserInfo } = useImageStore()
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
        return <CheckCircle className="size-4 text-primary" />;
      case SyncStateEnum.checking:
        return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
      case SyncStateEnum.creating:
        return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
      case SyncStateEnum.fail:
      default:
        return <XCircle className="size-4 text-muted-foreground" />;
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
        <CardTitle>{t('settings.imageHosting.github.title')}</CardTitle>
        <CardDescription>{t('settings.imageHosting.github.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Item variant="muted">
            <ItemContent><ItemTitle>{t('settings.imageHosting.github.repoStatus')}</ItemTitle></ItemContent>
            <ItemActions>
              {getStatusIcon()}
              <span className="text-sm">{getStatusText()}</span>
            </ItemActions>
          </Item>

        {/* 仓库操作按钮 */}
        {githubImageAccessToken && imageRepoState === SyncStateEnum.fail && (
          <div className="flex gap-2">
            <Button 
              onClick={createGithubRepo}
              size="sm"
              disabled={isCreating || isChecking}
            >
              {isCreating
                ? t('settings.imageHosting.github.creating')
                : t('settings.imageHosting.github.createNewRepo')}
            </Button>
            <Button 
              onClick={checkGithubRepos}
              size="sm"
              variant="outline"
              disabled={isChecking || isCreating}
            >
              {isChecking
                ? t('settings.imageHosting.github.recheckingRepo')
                : t('settings.imageHosting.github.recheckRepo')}
            </Button>
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="github-image-repo">{t('settings.imageHosting.customRepoName')}</FieldLabel>
          <Input 
            id="github-image-repo"
            value={githubCustomImageRepo} 
            onChange={customRepoChangeHandler}
            placeholder={RepoNames.image}
          />
          <FieldDescription>{t('settings.imageHosting.customRepoNameDesc')}</FieldDescription>
        </Field>

        <Field>
          <FieldTitle>GitHub Access Token</FieldTitle>
          <TokenInputControl
            value={githubImageAccessToken}
            onChange={tokenChangeHandler}
            visible={accessTokenVisible}
            onVisibleChange={setAccessTokenVisible}
            tokenUrl="https://github.com/settings/personal-access-tokens/new?name=NoteGen&description=NoteGen+image+hosting&expires_in=none&contents=write&administration=write"
            placeholder={t('settings.sync.enterToken')}
            docsSection="image-hosting"
          />
          <FieldDescription>{t('settings.sync.newTokenDesc')}</FieldDescription>
        </Field>

        {/* 仓库信息 */}
        {imageRepoInfo && (
          <Field>
            <FieldTitle>{t('settings.sync.repoStatus')}</FieldTitle>
            <Item variant="outline">
              <ItemMedia>
                <Avatar className="size-12">
                  <AvatarImage src={imageRepoInfo?.owner.avatar_url || ''} alt={imageRepoInfo?.owner.login || 'GitHub'} />
                  <AvatarFallback>GH</AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  <OpenBroswer title={imageRepoInfo?.full_name || ''} url={imageRepoInfo?.html_url || ''} />
                </ItemTitle>
                <ItemDescription>
                  {t('settings.sync.createdAt', { time: dayjs(imageRepoInfo?.created_at).fromNow() })}，
                  {t('settings.sync.updatedAt', { time: dayjs(imageRepoInfo?.updated_at).fromNow() })}
                </ItemDescription>
              </ItemContent>
            </Item>
          </Field>
        )}

        {/* JSDelivr 设置 */}
        {imageRepoInfo && (
          <Field orientation="horizontal">
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="github-image-jsdelivr">{t('settings.sync.jsdelivrSetting')}</FieldLabel>
              <FieldDescription>{t('settings.sync.jsdelivrSettingDesc')}</FieldDescription>
            </div>
            <Switch
              id="github-image-jsdelivr"
              checked={jsdelivr}
              onCheckedChange={(checked) => setJsdelivr(checked)}
              disabled={!githubImageAccessToken || imageRepoState !== SyncStateEnum.success || !useImageRepo}
            />
          </Field>
        )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

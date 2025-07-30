'use client'
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { FormItem, SettingPanel, SettingRow } from "../components/setting-base";
import { useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Switch } from "@/components/ui/switch";
import { getUserInfo } from "@/lib/github";
import { RepoNames, SyncStateEnum } from "@/lib/github.types";
import { FileImage } from "lucide-react";
import useImageStore from "@/stores/imageHosting";
import { createImageRepo, checkImageRepoState } from "@/lib/imageHosting/github";
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
  } = useSettingStore()
  const {
    imageRepoState,
    setImageRepoState,
    imageRepoInfo,
    setImageRepoInfo,
  } = useImageStore()

  // 检查 GitHub 仓库状态
  async function checkGithubRepos() {
    try {
      setImageRepoState(SyncStateEnum.checking)
      const store = await Store.load('store.json');
      const accessToken = await store.get<string>('githubImageAccessToken')
      const userInfo = await getUserInfo(accessToken);
      if (!userInfo) return;
      setImageRepoUserInfo(userInfo)
      // 检查图床仓库状态
      const imageRepo = await checkImageRepoState(RepoNames.image)
      if (imageRepo) {
        setImageRepoInfo(imageRepo)
        setImageRepoState(SyncStateEnum.success)
      } else {
        setImageRepoState(SyncStateEnum.creating)
        const info = await createImageRepo(RepoNames.image)
        if (info) {
          setImageRepoInfo(info)
          setImageRepoState(SyncStateEnum.success)
        } else {
          setImageRepoState(SyncStateEnum.fail)
        }
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

  return (
    <div className="mt-4">
      <SettingRow>
        <FormItem title="Github Access Token" desc={t('settings.sync.newTokenDesc')}>
          <OpenBroswer url="https://github.com/settings/tokens/new" title={t('settings.sync.newToken')} className="mb-2" />
          <div className="flex gap-2">
            <Input value={githubImageAccessToken} onChange={tokenChangeHandler} type={accessTokenVisible ? 'text' : 'password'} />
            <Button variant="outline" size="icon" onClick={() => setAccessTokenVisible(!accessTokenVisible)}>
              {accessTokenVisible ? <Eye /> : <EyeOff />}
            </Button>
          </div>
        </FormItem>
      </SettingRow>
      <SettingRow>
        <FormItem title={t('settings.sync.repoStatus')}>
          <Card>
            <CardHeader className={`${imageRepoInfo ? 'border-b' : ''}`}>
              <CardTitle className="flex justify-between items-center">
                <div className="flex gap-2 items-center">
                  <FileImage className="size-4" />
                  {t('settings.sync.imageRepo')} （{ imageRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public') }）
                </div>
                <Badge className={`${imageRepoState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>{imageRepoState}</Badge>
              </CardTitle>
              <CardDescription>{t('settings.sync.imageRepoDesc')}</CardDescription>
            </CardHeader>
            {
              imageRepoInfo &&
              <CardContent className="flex items-center gap-4 mt-4">
                <Avatar className="size-12"  >
                  <AvatarImage src={imageRepoInfo?.owner.avatar_url || ''} />
                </Avatar>
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2 mb-1">
                    <OpenBroswer title={imageRepoInfo?.full_name || ''} url={imageRepoInfo?.html_url || ''} />
                  </h3>
                  <CardDescription className="flex">
                    <p className="text-zinc-500 leading-6">{t('settings.sync.createdAt', { time: dayjs(imageRepoInfo?.created_at).fromNow() })}，</p>
                    <p className="text-zinc-500 leading-6">{t('settings.sync.updatedAt', { time: dayjs(imageRepoInfo?.updated_at).fromNow() })}。</p>
                  </CardDescription>
                </div>
              </CardContent>
            }
          </Card>
        </FormItem>
      </SettingRow>
      {
        imageRepoInfo &&
        <>
          <SettingPanel title={t('settings.sync.jsdelivrSetting')} desc={t('settings.sync.jsdelivrSettingDesc')}>
            <Switch 
              checked={jsdelivr} 
              onCheckedChange={(checked) => setJsdelivr(checked)} 
              disabled={!githubImageAccessToken || imageRepoState !== SyncStateEnum.success || !useImageRepo}
            />
          </SettingPanel>
          <SettingRow className="mb-4">
            {mainImageHosting === 'github' ? (
              <Button disabled variant="outline">
                {t('settings.imageHosting.isPrimaryBackup', { type: 'Github' })}
              </Button>
            ) : (
              <Button 
                variant="outline" 
                onClick={() => setMainImageHosting('github')}
                disabled={!githubImageAccessToken || imageRepoState !== SyncStateEnum.success}
              >
                {t('settings.imageHosting.setPrimaryBackup')}
              </Button>
            )}
          </SettingRow>
        </>
      }
    </div>
  )
}
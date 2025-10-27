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
import { checkSyncRepoState, createSyncRepo, getUserInfo } from "@/lib/sync/gitee";
import { Button } from "@/components/ui/button";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import { DatabaseBackup, Eye, EyeOff, Plus, RefreshCcw } from "lucide-react";

dayjs.extend(relativeTime)

export function GiteeSync() {
  const t = useTranslations();
  const { 
    giteeAccessToken, 
    setGiteeAccessToken, 
    giteeAutoSync, 
    setGiteeAutoSync,
    primaryBackupMethod,
    setPrimaryBackupMethod,
    giteeCustomSyncRepo,
    setGiteeCustomSyncRepo
  } = useSettingStore()
  
  const {
    giteeSyncRepoState,
    setGiteeSyncRepoState,
    giteeSyncRepoInfo,
    setGiteeSyncRepoInfo
  } = useSyncStore()

  const [giteeAccessTokenVisible, setGiteeAccessTokenVisible] = useState<boolean>(false)

  // 获取实际使用的仓库名称
  const getRepoName = () => {
    return giteeCustomSyncRepo.trim() || RepoNames.sync
  }


  // 检查 Gitee 仓库状态（仅检查，不创建）
  async function checkRepoState() {
    try {
      setGiteeSyncRepoState(SyncStateEnum.checking)
      // 先清空之前的仓库信息
      setGiteeSyncRepoInfo(undefined)
      
      await getUserInfo();
      const repoName = getRepoName()
      const syncRepo = await checkSyncRepoState(repoName)
      
      if (syncRepo) {
        setGiteeSyncRepoInfo(syncRepo)
        setGiteeSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteeSyncRepoInfo(undefined)
        setGiteeSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitee repos:', err)
      setGiteeSyncRepoInfo(undefined)
      setGiteeSyncRepoState(SyncStateEnum.fail)
    }
  }

  // 手动创建仓库
  async function createGiteeRepo() {
    try {
      setGiteeSyncRepoState(SyncStateEnum.creating)
      const repoName = getRepoName()
      const info = await createSyncRepo(repoName, true)
      if (info) {
        setGiteeSyncRepoInfo(info)
        setGiteeSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteeSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to create Gitee repo:', err)
      setGiteeSyncRepoState(SyncStateEnum.fail)
    }
  }

  async function tokenChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value === '') {
      setGiteeSyncRepoState(SyncStateEnum.fail)
      setGiteeSyncRepoInfo(undefined)
    }
    setGiteeAccessToken(value)
    const store = await Store.load('store.json');
    await store.set('giteeAccessToken', value)
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const token = await store.get<string>('giteeAccessToken')
      if (token) {
        setGiteeAccessToken(token)
      } else {
        setGiteeAccessToken('')
      }
    }
    init()
  }, [])


  return (
    <div className="space-y-8">
      <FormItem title="Gitee 私人令牌" desc={t('settings.sync.giteeTokenDesc')}>
          <OpenBroswer url="https://gitee.com/profile/personal_access_tokens/new" title={t('settings.sync.newToken')} className="mb-2" />
          <div className="flex gap-2">
            <Input value={giteeAccessToken} onChange={tokenChangeHandler} type={giteeAccessTokenVisible ? 'text' : 'password'} />
            <Button variant="outline" size="icon" onClick={() => setGiteeAccessTokenVisible(!giteeAccessTokenVisible)}>
              {giteeAccessTokenVisible ? <Eye /> : <EyeOff />}
            </Button>
          </div>
      </FormItem>
      <FormItem title={t('settings.sync.customSyncRepo')} desc={t('settings.sync.customSyncRepoDesc')}>
          <Input 
            value={giteeCustomSyncRepo} 
            onChange={(e) => {
              setGiteeCustomSyncRepo(e.target.value)
            }}
            placeholder={RepoNames.sync}
          />
      </FormItem>
      <FormItem title={t('settings.sync.repoStatus')}>
          <Card>
            <CardHeader className={`${giteeSyncRepoInfo ? 'border-b' : ''}`}>
              <CardTitle className="flex justify-between items-center">
                <div className="flex gap-2 items-center">
                  <DatabaseBackup className="size-4" />
                  {getRepoName()}（{ giteeSyncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public') }）
                </div>
                <Badge className={`${giteeSyncRepoState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>{giteeSyncRepoState}</Badge>
              </CardTitle>
              <CardDescription>
                <span>{t('settings.sync.syncRepoDesc')}</span>
              </CardDescription>
              {/* 手动检测和创建按钮 */}
              {giteeAccessToken && (
                <div className="mt-3 flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={checkRepoState}
                    disabled={giteeSyncRepoState === SyncStateEnum.checking}
                  >
                    <RefreshCcw className="size-4 mr-1" />
                    {giteeSyncRepoState === SyncStateEnum.checking ? t('settings.sync.checking') : t('settings.sync.checkRepo')}
                  </Button>
                  {giteeSyncRepoState === SyncStateEnum.fail && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={createGiteeRepo}
                    >
                      <Plus className="size-4 mr-1" />
                      {t('settings.sync.createRepo')}
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            {
              giteeSyncRepoInfo &&
              <CardContent>
                <h3 className="text-xl font-bold mt-4 mb-2">
                  <OpenBroswer title={giteeSyncRepoInfo?.full_name || ''} url={giteeSyncRepoInfo?.html_url || ''} />
                </h3>
                <CardDescription className="flex">
                  <p className="text-zinc-500 leading-6">{t('settings.sync.createdAt', { time: dayjs(giteeSyncRepoInfo?.created_at).fromNow() })}，</p>
                  <p className="text-zinc-500 leading-6">{t('settings.sync.updatedAt', { time: dayjs(giteeSyncRepoInfo?.updated_at).fromNow() })}。</p>
                </CardDescription>
              </CardContent>
            }
          </Card>
      </FormItem>
      {
        giteeSyncRepoInfo &&
        <FormItem title={t('settings.others')}>
          <Item variant="outline">
            <ItemMedia variant="icon"><RefreshCcw className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('settings.sync.autoSync')}</ItemTitle>
              <ItemDescription>{t('settings.sync.giteeAutoSyncDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select
                value={giteeAutoSync}
                onValueChange={(value) => setGiteeAutoSync(value)}
                disabled={!giteeAccessToken || giteeSyncRepoState !== SyncStateEnum.success}
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
      <div>
        {primaryBackupMethod === 'gitee' ? (
          <Button disabled variant="outline">
            {t('settings.sync.isPrimaryBackup', { type: 'Gitee' })}
          </Button>
        ) : (
          <Button 
            variant="outline" 
            onClick={() => setPrimaryBackupMethod('gitee')}
            disabled={!giteeAccessToken || giteeSyncRepoState !== SyncStateEnum.success}
          >
            {t('settings.sync.setPrimaryBackup')}
          </Button>
        )}
      </div>
    </div>
  )
}

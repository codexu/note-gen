'use client'
import { Input } from "@/components/ui/input";
import { FormItem, SettingPanel, SettingRow } from "../components/setting-base";
import { useEffect } from "react";
import { useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import useSyncStore, { SyncStateEnum } from "@/stores/sync";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { checkSyncRepoState, getUserInfo } from "@/lib/gitee";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { RepoNames } from "@/lib/github.types";

dayjs.extend(relativeTime)

export function GiteeSync() {
  const t = useTranslations();
  const { 
    giteeAccessToken, 
    setGiteeAccessToken, 
    giteeAutoSync, 
    setGiteeAutoSync,
    primaryBackupMethod,
    setPrimaryBackupMethod 
  } = useSettingStore()
  
  const {
    giteeSyncRepoState,
    setGiteeSyncRepoState,
    giteeSyncRepoInfo,
    setGiteeSyncRepoInfo
  } = useSyncStore()

  async function checkRepoState() {
    try {
      // 设置检测中状态
      setGiteeSyncRepoState(SyncStateEnum.checking);
      
      // 先获取用户信息，确保有用户名
      await getUserInfo();
      
      // 检查同步仓库
      const syncRepo = await checkSyncRepoState(RepoNames.sync);
      if (syncRepo) {
        setGiteeSyncRepoInfo(syncRepo);
        setGiteeSyncRepoState(SyncStateEnum.success);
      } else {
        setGiteeSyncRepoState(SyncStateEnum.fail);
      }
    } catch (error) {
      // 失败时将状态设置为不可用
      setGiteeSyncRepoState(SyncStateEnum.fail);
      setGiteeSyncRepoInfo(undefined);
      
      toast({
        title: '检查仓库状态失败',
        description: (error as any).message,
        variant: 'destructive',
      });
    }
  }

  async function tokenChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value === '') {
      setGiteeSyncRepoState(SyncStateEnum.fail)
      setGiteeSyncRepoInfo(undefined)
    } else {
      // 有新的令牌值，但还未验证时先显示检测中状态
      setGiteeSyncRepoState(SyncStateEnum.checking)
    }
    setGiteeAccessToken(value)
    const store = await Store.load('store.json');
    await store.set('giteeAccessToken', value)
    
    // 如果有令牌，尝试检查仓库状态
    if (value) {
      checkRepoState();
    }
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const token = await store.get<string>('giteeAccessToken')
      if (token) {
        setGiteeAccessToken(token)
        // 初始化时检查仓库状态
        checkRepoState();
      } else {
        setGiteeAccessToken('')
      }
    }
    init()
  }, [])

  return (
    <>
      <SettingRow>
        <FormItem title="Gitee 私人令牌" desc={t('settings.sync.giteeTokenDesc')}>
          <OpenBroswer url="https://gitee.com/profile/personal_access_tokens/new" title={t('settings.sync.newToken')} className="mb-2" />
          <Input value={giteeAccessToken} onChange={tokenChangeHandler} />
        </FormItem>
      </SettingRow>
      <SettingRow>
        <FormItem title={t('settings.sync.repoStatus')}>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className={`${giteeSyncRepoInfo ? 'border-b' : ''}`}>
                <CardTitle className="flex justify-between items-center">
                  <span>{t('settings.sync.syncRepo')}（{ giteeSyncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public') }）</span>
                  <Badge className={`${giteeSyncRepoState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>{giteeSyncRepoState}</Badge>
                </CardTitle>
                <CardDescription>{t('settings.sync.syncRepoDesc')}</CardDescription>
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

          </div>
        </FormItem>
      </SettingRow>
      {
        giteeSyncRepoInfo &&
        <>
          <SettingPanel title={t('settings.sync.autoSync')} desc={t('settings.sync.giteeAutoSyncDesc')}>
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
          </SettingPanel>
        </>
      }
      <SettingRow>
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
      </SettingRow>
    </>
  )
}

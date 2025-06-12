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
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

dayjs.extend(relativeTime)

export function GithubSync() {
  const t = useTranslations();
  const { accessToken,
    setAccessToken,
    useImageRepo,
    setUseImageRepo,
    jsdelivr,
    setJsdelivr,
    autoSync,
    setAutoSync,
    primaryBackupMethod,
    setPrimaryBackupMethod
  } = useSettingStore()
  const {
    imageRepoState,
    setImageRepoState,
    syncRepoState,
    setSyncRepoState,
    imageRepoInfo,
    syncRepoInfo,
    setImageRepoInfo,
    setSyncRepoInfo
  } = useSyncStore()

  async function tokenChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value === '') {
      setImageRepoState(SyncStateEnum.fail)
      setSyncRepoState(SyncStateEnum.fail)
      setImageRepoInfo(undefined)
      setSyncRepoInfo(undefined)
    }
    setAccessToken(value)
    const store = await Store.load('store.json');
    await store.set('accessToken', value)
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const token = await store.get<string>('accessToken')
      if (token) {
        setAccessToken(token)
      } else {
        setAccessToken('')
      }
    }
    init()
  }, [])

  return (
    <>
      <SettingRow>
        <FormItem title="Github Access Token" desc={t('settings.sync.newTokenDesc')}>
          <OpenBroswer url="https://github.com/settings/tokens/new" title={t('settings.sync.newToken')} className="mb-2" />
          <Input value={accessToken} onChange={tokenChangeHandler} />
        </FormItem>
      </SettingRow>
      <SettingRow>
        <FormItem title={t('settings.sync.repoStatus')}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className={`${syncRepoInfo ? 'border-b' : ''}`}>
                <CardTitle className="flex justify-between items-center">
                  <span>{t('settings.sync.syncRepo')}（{ syncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public') }）</span>
                  <Badge className={`${syncRepoState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>{syncRepoState}</Badge>
                </CardTitle>
                <CardDescription>{t('settings.sync.syncRepoDesc')}</CardDescription>
              </CardHeader>
              {
                syncRepoInfo &&
                <CardContent>
                  <h3 className="text-xl font-bold mt-4 mb-2">
                    <OpenBroswer title={syncRepoInfo?.full_name || ''} url={syncRepoInfo?.html_url || ''} />
                  </h3>
                  <CardDescription className="flex">
                    <p className="text-zinc-500 leading-6">{t('settings.sync.createdAt', { time: dayjs(syncRepoInfo?.created_at).fromNow() })}，</p>
                    <p className="text-zinc-500 leading-6">{t('settings.sync.updatedAt', { time: dayjs(syncRepoInfo?.updated_at).fromNow() })}。</p>
                  </CardDescription>
                </CardContent>
              }
            </Card>
            <Card>
              <CardHeader className={`${imageRepoInfo ? 'border-b' : ''}`}>
                <CardTitle className="flex justify-between items-center">
                  <span>{t('settings.sync.imageRepo')} （{ imageRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public') }）</span>
                  <Badge className={`${imageRepoState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>{imageRepoState}</Badge>
                </CardTitle>
                <CardDescription>{t('settings.sync.imageRepoDesc')}</CardDescription>
              </CardHeader>
              {
                imageRepoInfo &&
                <CardContent>
                  <h3 className="text-xl font-bold mt-4 mb-2">
                    <OpenBroswer title={imageRepoInfo?.full_name || ''} url={imageRepoInfo?.html_url || ''} />
                  </h3>
                  <CardDescription className="flex">
                    <p className="text-zinc-500 leading-6">{t('settings.sync.createdAt', { time: dayjs(imageRepoInfo?.created_at).fromNow() })}，</p>
                    <p className="text-zinc-500 leading-6">{t('settings.sync.updatedAt', { time: dayjs(imageRepoInfo?.updated_at).fromNow() })}。</p>
                  </CardDescription>
                </CardContent>
              }
            </Card>
          </div>
        </FormItem>
      </SettingRow>
      {
        syncRepoInfo &&
        <>
          <SettingPanel title="自动同步" desc="选择编辑器在输入停止后自动同步的时间间隔">
            <Select
              value={autoSync}
              onValueChange={(value) => setAutoSync(value)}
              disabled={!accessToken || syncRepoState !== SyncStateEnum.success}
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
      {
        imageRepoInfo &&
        <>
          <SettingPanel title={t('settings.sync.imageRepoSetting')} desc={t('settings.sync.imageRepoSettingDesc')}>
            <Switch 
              checked={useImageRepo} 
              onCheckedChange={(checked) => setUseImageRepo(checked)} 
              disabled={!accessToken || imageRepoState !== SyncStateEnum.success}
            />
          </SettingPanel>
          <SettingPanel title={t('settings.sync.jsdelivrSetting')} desc={t('settings.sync.jsdelivrSettingDesc')}>
            <Switch 
              checked={jsdelivr} 
              onCheckedChange={(checked) => setJsdelivr(checked)} 
              disabled={!accessToken || imageRepoState !== SyncStateEnum.success || !useImageRepo}
            />
          </SettingPanel>
        </>
      }
      <SettingRow className="mb-4">
        {primaryBackupMethod === 'github' ? (
          <Button disabled variant="outline">
            {t('settings.sync.isPrimaryBackup', { type: 'Github' })}
          </Button>
        ) : (
          <Button 
            variant="outline" 
            onClick={() => setPrimaryBackupMethod('github')}
            disabled={!accessToken || syncRepoState !== SyncStateEnum.success}
          >
            {t('settings.sync.setPrimaryBackup')}
          </Button>
        )}
      </SettingRow>
    </>
  )
}
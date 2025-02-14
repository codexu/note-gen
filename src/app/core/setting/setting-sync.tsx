'use client'
import { Input } from "@/components/ui/input";
import { FormItem, SettingRow, SettingType } from "./setting-base";
import { useEffect } from "react";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import useSyncStore, { SyncStateEnum } from "@/stores/sync";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import zh from "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import { _t } from '@/locales';
dayjs.extend(relativeTime)
dayjs.locale(zh)

export function SettingSync({id, icon}: {id: string, icon?: React.ReactNode}) {
  const { accessToken, setAccessToken } = useSettingStore()
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
    <SettingType id={id} icon={icon} title={_t('sync_settings_title')}>
      <SettingRow>
        <FormItem title={_t('github_access_token')}>
          <Input value={accessToken} onChange={tokenChangeHandler} />
        </FormItem>
      </SettingRow>
      <SettingRow>
        <FormItem title={_t('repository_status')}>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className={`${syncRepoInfo ? 'border-b' : ''}`}>
                <CardTitle className="flex justify-between items-center">
                  <span>{_t('sync_repository')}（{ syncRepoInfo?.private ? _t('sync_repository_private') : _t('sync_repository_public') }）</span>
                  <Badge className={`${syncRepoState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>{syncRepoState}</Badge>
                </CardTitle>
                <CardDescription>{_t('sync_markdown_file')}</CardDescription>
              </CardHeader>
              {
                syncRepoInfo &&
                <CardContent>
                  <h3 className="text-xl font-bold mt-4 mb-2">
                    <OpenBroswer title={syncRepoInfo?.full_name || ''} url={syncRepoInfo?.html_url || ''} />
                  </h3>
                  <CardDescription className="flex">
                    <p className="text-zinc-500 leading-6">{_t('created_at_prefix')} { dayjs(syncRepoInfo?.created_at).fromNow() }，</p>
                    <p className="text-zinc-500 leading-6">{_t('updated_at_prefix')} { dayjs(syncRepoInfo?.updated_at).fromNow() }。</p>
                  </CardDescription>
                </CardContent>
              }
            </Card>
            <Card>
              <CardHeader className={`${imageRepoInfo ? 'border-b' : ''}`}>
                <CardTitle className="flex justify-between items-center">
                  <span>{_t('image_repository')} （{ imageRepoInfo?.private ? _t('image_repository_private') : _t('image_repository_public') }）</span>
                  <Badge className={`${imageRepoState === SyncStateEnum.success ? 'bg-green-800' : 'bg-red-800'}`}>{imageRepoState}</Badge>
                </CardTitle>
                <CardDescription>{_t('sync_your_images')}</CardDescription>
              </CardHeader>
              {
                imageRepoInfo &&
                <CardContent>
                  <h3 className="text-xl font-bold mt-4 mb-2">
                    <OpenBroswer title={imageRepoInfo?.full_name || ''} url={imageRepoInfo?.html_url || ''} />
                  </h3>
                  <CardDescription className="flex">
                    <p className="text-zinc-500 leading-6">{_t('created_at_prefix')} { dayjs(imageRepoInfo?.created_at).fromNow() }，</p>
                    <p className="text-zinc-500 leading-6">{_t('updated_at_prefix')} { dayjs(imageRepoInfo?.updated_at).fromNow() }。</p>
                  </CardDescription>
                </CardContent>
              }
            </Card>
          </div>
        </FormItem>
      </SettingRow>
    </SettingType>
  )
}

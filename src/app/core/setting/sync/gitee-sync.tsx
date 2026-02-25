'use client'
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import useSyncStore from "@/stores/sync";
import { Badge } from "@/components/ui/badge";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { checkSyncRepoState, createSyncRepo, getUserInfo } from "@/lib/sync/gitee";
import { Button } from "@/components/ui/button";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import { Eye, EyeOff, Plus, RefreshCcw } from "lucide-react";
import { Avatar, AvatarImage } from "@/components/ui/avatar";

dayjs.extend(relativeTime)

export function GiteeSync() {
  const t = useTranslations();
  const {
    giteeAccessToken,
    setGiteeAccessToken,
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
      
      // 添加超时保护，避免无限等待
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('检测超时')), 15000) // 15秒超时
      })
      
      // 使用 Promise.race 来处理超时
      await Promise.race([
        (async () => {
          // 先检查网络连接
          if (!navigator.onLine) {
            throw new Error('网络连接不可用')
          }
          
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
        })(),
        timeoutPromise
      ])
      
    } catch (err) {
      console.error('Failed to check Gitee repos:', err)
      setGiteeSyncRepoInfo(undefined)
      setGiteeSyncRepoState(SyncStateEnum.fail)
      
      // 如果是超时错误，显示特定提示
      if (err instanceof Error) {
        if (err.message === '检测超时') {
          console.warn('Gitee 仓库检测超时，可能是网络问题')
        } else if (err.message === '网络连接不可用') {
          console.warn('网络连接不可用，请检查网络设置')
        }
      }
    }
  }

  // 手动创建仓库
  async function createGiteeRepo() {
    try {
      setGiteeSyncRepoState(SyncStateEnum.creating)
      const repoName = getRepoName()
      
      // 添加超时保护
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('创建超时')), 20000) // 20秒超时
      })
      
      await Promise.race([
        (async () => {
          const info = await createSyncRepo(repoName, true)
          if (info) {
            setGiteeSyncRepoInfo(info)
            setGiteeSyncRepoState(SyncStateEnum.success)
          } else {
            setGiteeSyncRepoState(SyncStateEnum.fail)
          }
        })(),
        timeoutPromise
      ])
      
    } catch (err) {
      console.error('Failed to create Gitee repo:', err)
      setGiteeSyncRepoState(SyncStateEnum.fail)
      
      if (err instanceof Error && err.message === '创建超时') {
        console.warn('Gitee 仓库创建超时，可能是网络问题')
      }
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

    // 添加网络状态监听
    const handleOnline = () => {
      // Network connected
    }

    const handleOffline = () => {
      // Network disconnected
      setGiteeSyncRepoState(SyncStateEnum.fail)
      setGiteeSyncRepoInfo(undefined)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])


  return (
    <div className="rounded-md border p-4">
      <div className="flex justify-between items-center mb-2">
        <div className="flex gap-2 items-center">
          <span className="font-semibold">Gitee {t('settings.sync.settings')}</span>
        </div>
        <Badge className={`${giteeSyncRepoState === SyncStateEnum.success ? 'bg-green-600' : 'bg-zinc-500'}`}>
          {giteeSyncRepoState === SyncStateEnum.success ? 'Connected' : giteeSyncRepoState === SyncStateEnum.checking ? 'Checking' : giteeSyncRepoState === SyncStateEnum.creating ? 'Creating' : 'Not Connected'}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t('settings.sync.platformDesc')}</p>

      {/* Token 输入 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Gitee 私人令牌</label>
        <div className="flex gap-2">
          <Input value={giteeAccessToken} onChange={tokenChangeHandler} type={giteeAccessTokenVisible ? 'text' : 'password'} placeholder={t('settings.sync.enterToken')} />
          <Button variant="outline" size="icon" onClick={() => setGiteeAccessTokenVisible(!giteeAccessTokenVisible)}>
            {giteeAccessTokenVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
        <OpenBroswer url="https://gitee.com/profile/personal_access_tokens/new" title={t('settings.sync.newToken')} className="text-sm text-blue-500 hover:underline" />
      </div>

      {/* 自定义仓库 */}
      <div className="mt-4 space-y-2">
        <label className="text-sm font-medium">{t('settings.sync.customSyncRepo')}</label>
        <Input
          value={giteeCustomSyncRepo}
          onChange={(e) => setGiteeCustomSyncRepo(e.target.value)}
          placeholder={RepoNames.sync}
        />
        <p className="text-xs text-muted-foreground">{t('settings.sync.customSyncRepoDesc')}</p>
      </div>

      {/* 操作按钮 */}
      <div className="mt-4 flex gap-2 flex-wrap">
        {giteeAccessToken ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={checkRepoState}
              disabled={giteeSyncRepoState === SyncStateEnum.checking || giteeSyncRepoState === SyncStateEnum.creating}
            >
              {giteeSyncRepoState === SyncStateEnum.checking || giteeSyncRepoState === SyncStateEnum.creating ? (
                <>
                  <RefreshCcw className="size-4 mr-1 animate-spin" />
                  {giteeSyncRepoState === SyncStateEnum.checking ? t('settings.sync.checking') : t('settings.sync.creating')}
                </>
              ) : (
                <>
                  <RefreshCcw className="size-4 mr-1" />
                  {t('settings.sync.checkRepo')}
                </>
              )}
            </Button>
            {giteeSyncRepoState === SyncStateEnum.fail && (
              <Button variant="outline" size="sm" onClick={createGiteeRepo}>
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
      {giteeSyncRepoInfo && (
        <div className="border-t mt-4 pt-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-10">
              <AvatarImage src={giteeSyncRepoInfo?.owner?.avatar_url || ''} />
            </Avatar>
            <div>
              <h3 className="text-xl font-bold mb-1">
                <OpenBroswer title={giteeSyncRepoInfo?.full_name || ''} url={giteeSyncRepoInfo?.html_url || ''} />
              </h3>
              <p className="text-sm text-zinc-500">
                {giteeSyncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public')} · {t('settings.sync.createdAt', { time: dayjs(giteeSyncRepoInfo?.created_at).fromNow() })} · {t('settings.sync.updatedAt', { time: dayjs(giteeSyncRepoInfo?.updated_at).fromNow() })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

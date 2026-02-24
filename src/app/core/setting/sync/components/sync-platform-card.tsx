'use client'

import { Input } from "@/components/ui/input"
import { FormItem } from "../../components/setting-base"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useEffect, useState, useCallback } from "react"
import { useTranslations } from 'next-intl'
import { Store } from "@tauri-apps/plugin-store"
import { SyncStateEnum } from "@/lib/sync/github.types"
import { SyncPlatform } from "@/types/sync"
import { Eye, EyeOff, RefreshCcw, Loader2, AlertCircle, CheckCircle2, XCircle } from "lucide-react"

export interface SyncPlatformConfig {
  platform: SyncPlatform
  tokenKey: string
  tokenLabel: string
  tokenDesc: string
  tokenUrl: string
  tokenUrlText: string
}

interface SyncPlatformCardProps {
  config: SyncPlatformConfig
  accessToken: string
  setAccessToken: (token: string) => void
  syncRepoState: SyncStateEnum
  syncRepoInfo?: any
  customRepo: string
  setCustomRepo: (repo: string) => void
  defaultRepoName: string
  onCheckRepo: () => void
  onCreateRepo: () => void
  children?: React.ReactNode
}

export function SyncPlatformCard({
  config,
  accessToken,
  setAccessToken,
  syncRepoState,
  syncRepoInfo,
  customRepo,
  setCustomRepo,
  defaultRepoName,
  onCheckRepo,
  onCreateRepo,
  children,
}: SyncPlatformCardProps) {
  const t = useTranslations()
  const [tokenVisible, setTokenVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  // 初始化加载 token
  useEffect(() => {
    const init = async () => {
      try {
        const store = await Store.load('store.json')
        const token = await store.get<string>(config.tokenKey)
        if (token) {
          setAccessToken(token)
        }
      } catch (err) {
        console.error(`Failed to load ${config.platform} token:`, err)
      } finally {
        setIsInitializing(false)
      }
    }
    init()
  }, [config.tokenKey, setAccessToken])

  // 监听 syncRepoState 变化来显示错误
  useEffect(() => {
    if (syncRepoState === SyncStateEnum.fail && accessToken) {
      // 可以在这里设置错误消息，但通常由具体组件设置
    }
  }, [syncRepoState, accessToken])

  const handleTokenChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setAccessToken(value)
    setError(null)

    try {
      const store = await Store.load('store.json')
      await store.set(config.tokenKey, value)
      await store.save()
    } catch (err) {
      console.error('Failed to save token:', err)
    }
  }, [config.tokenKey, setAccessToken])

  const getRepoName = () => customRepo.trim() || defaultRepoName

  const isLoading = syncRepoState === SyncStateEnum.checking || syncRepoState === SyncStateEnum.creating
  const isConnected = syncRepoState === SyncStateEnum.success

  return (
    <div className="space-y-8">
      {/* Token 输入 */}
      <FormItem title={config.tokenLabel} desc={config.tokenDesc}>
        <a
          href={config.tokenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-500 hover:underline mb-2 inline-block"
        >
          {config.tokenUrlText}
        </a>
        <div className="flex gap-2">
          <Input
            value={accessToken}
            onChange={handleTokenChange}
            type={tokenVisible ? 'text' : 'password'}
            placeholder={t('settings.sync.enterToken')}
            disabled={isInitializing}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => setTokenVisible(!tokenVisible)}
          >
            {tokenVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </FormItem>

      {/* 自定义仓库 */}
      <FormItem title={t('settings.sync.customSyncRepo')} desc={t('settings.sync.customSyncRepoDesc')}>
        <Input
          value={customRepo}
          onChange={(e) => setCustomRepo(e.target.value)}
          placeholder={defaultRepoName}
        />
      </FormItem>

      {/* 仓库状态 */}
      <FormItem title={t('settings.sync.repoStatus')}>
        <Card>
          <CardHeader className={syncRepoInfo ? 'border-b' : ''}>
            <CardTitle className="flex justify-between items-center">
              <div className="flex gap-2 items-center">
                {getRepoName()}（{syncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public')}）
              </div>
              <StatusBadge state={syncRepoState} />
            </CardTitle>
            <CardDescription>
              <span>{t('settings.sync.syncRepoDesc')}</span>
            </CardDescription>

            {/* 操作按钮 */}
            <div className="mt-3 flex gap-2 flex-wrap">
              {accessToken ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCheckRepo}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="size-4 mr-1 animate-spin" />
                        {syncRepoState === SyncStateEnum.checking
                          ? t('settings.sync.checking')
                          : t('settings.sync.creating')}
                      </>
                    ) : (
                      <>
                        <RefreshCcw className="size-4 mr-1" />
                        {t('settings.sync.checkRepo')}
                      </>
                    )}
                  </Button>
                  {syncRepoState === SyncStateEnum.fail && (
                    <Button variant="outline" size="sm" onClick={onCreateRepo} disabled={isLoading}>
                      <Loader2 className={`size-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                      {t('settings.sync.createRepo')}
                    </Button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <AlertCircle className="size-4" />
                  {t('settings.sync.enterTokenHint')}
                </div>
              )}
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mt-3 flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="size-4" />
                {error}
              </div>
            )}
          </CardHeader>

          {/* 仓库信息 */}
          {syncRepoInfo && (
            <CardContent className="mt-4">
              {children}
            </CardContent>
          )}
        </Card>
      </FormItem>
    </div>
  )
}

// 状态徽章组件
function StatusBadge({ state }: { state: SyncStateEnum }) {
  const t = useTranslations()

  if (state === SyncStateEnum.success) {
    return (
      <Badge className="bg-green-600">
        <CheckCircle2 className="size-3 mr-1" />
        Connected
      </Badge>
    )
  }

  if (state === SyncStateEnum.checking || state === SyncStateEnum.creating) {
    return (
      <Badge className="bg-blue-600">
        <Loader2 className="size-3 mr-1 animate-spin" />
        {state === SyncStateEnum.checking ? 'Checking' : 'Creating'}
      </Badge>
    )
  }

  if (state === SyncStateEnum.fail) {
    return (
      <Badge className="bg-zinc-500">
        <XCircle className="size-3 mr-1" />
        Not Connected
      </Badge>
    )
  }

  return null
}

export { StatusBadge }

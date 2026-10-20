'use client'

import { useCallback } from 'react'

import { SyncPlatformCard } from './components/sync-platform-card'
import useSettingStore from '@/stores/setting'

const GITEE_CONFIG = {
  platform: 'gitee' as const,
  tokenKey: 'giteeAccessToken',
  tokenLabel: 'Gitee 私人令牌',
  tokenDesc: '',
  tokenUrl: 'https://gitee.com/profile/personal_access_tokens/new',
  tokenUrlText: '',
}

export function GiteeSync() {
  const { giteeAccessToken, setGiteeAccessToken } = useSettingStore()
  const handleAccessTokenChange = useCallback((token: string) => {
    void setGiteeAccessToken(token)
  }, [setGiteeAccessToken])

  return (
    <SyncPlatformCard
      config={GITEE_CONFIG}
      accessToken={giteeAccessToken}
      setAccessToken={handleAccessTokenChange}
    />
  )
}

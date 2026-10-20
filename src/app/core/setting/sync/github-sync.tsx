'use client'

import { SyncPlatformCard } from './components/sync-platform-card'
import useSettingStore from '@/stores/setting'

const GITHUB_CONFIG = {
  platform: 'github' as const,
  tokenKey: 'accessToken',
  tokenLabel: 'Github Access Token',
  tokenDesc: '',
  tokenUrl: 'https://github.com/settings/personal-access-tokens/new?name=NoteGen&description=NoteGen+sync&expires_in=none&contents=write&administration=write',
  tokenUrlText: '',
}

export function GithubSync() {
  const { accessToken, setAccessToken } = useSettingStore()

  return (
    <SyncPlatformCard
      config={GITHUB_CONFIG}
      accessToken={accessToken}
      setAccessToken={setAccessToken}
    />
  )
}

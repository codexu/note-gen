export type SyncPlatform = 'github' | 'gitee' | 'gitlab' | 'gitea'

export type SyncPlatformType = {
  platform: SyncPlatform
  name: string
  icon: string
}

export const SYNC_PLATFORMS: SyncPlatform[] = ['github', 'gitee', 'gitlab', 'gitea']

export const SYNC_PLATFORM_INFO: Record<SyncPlatform, SyncPlatformType> = {
  github: { platform: 'github', name: 'Github', icon: 'github' },
  gitee: { platform: 'gitee', name: 'Gitee', icon: 'gitee' },
  gitlab: { platform: 'gitlab', name: 'GitLab', icon: 'gitlab' },
  gitea: { platform: 'gitea', name: 'Gitea', icon: 'gitea' },
}

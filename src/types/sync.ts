export type SyncPlatform = 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'

export type SyncPlatformType = {
  platform: SyncPlatform
  name: string
  icon: string
}

export const SYNC_PLATFORMS: SyncPlatform[] = ['github', 'gitee', 'gitlab', 'gitea', 's3', 'webdav']

export const SYNC_PLATFORM_INFO: Record<SyncPlatform, SyncPlatformType> = {
  github: { platform: 'github', name: 'Github', icon: 'github' },
  gitee: { platform: 'gitee', name: 'Gitee', icon: 'gitee' },
  gitlab: { platform: 'gitlab', name: 'GitLab', icon: 'gitlab' },
  gitea: { platform: 'gitea', name: 'Gitea', icon: 'gitea' },
  s3: { platform: 's3', name: 'S3', icon: 's3' },
  webdav: { platform: 'webdav', name: 'WebDAV', icon: 'webdav' },
}

export interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
  endpoint: string
  pathPrefix: string
  customDomain?: string
}

export interface WebDAVConfig {
  url: string
  username: string
  password: string
  pathPrefix: string
}

export type SyncPlatform = 'local' | 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'

export type SyncPlatformType = {
  platform: SyncPlatform
  name: string
  icon: string
}

export const SYNC_PLATFORMS: SyncPlatform[] = ['local', 'github', 'gitee', 'gitlab', 'gitea', 's3', 'webdav', 'cloudFolder', 'selfHosted']

export const SYNC_PLATFORM_INFO: Record<SyncPlatform, SyncPlatformType> = {
  local: { platform: 'local', name: 'Local', icon: 'hard-drive' },
  github: { platform: 'github', name: 'Github', icon: 'github' },
  gitee: { platform: 'gitee', name: 'Gitee', icon: 'gitee' },
  gitlab: { platform: 'gitlab', name: 'GitLab', icon: 'gitlab' },
  gitea: { platform: 'gitea', name: 'Gitea', icon: 'gitea' },
  s3: { platform: 's3', name: 'S3', icon: 's3' },
  webdav: { platform: 'webdav', name: 'WebDAV', icon: 'webdav' },
  cloudFolder: { platform: 'cloudFolder', name: 'OneDrive / iCloud', icon: 'cloudFolder' },
  selfHosted: { platform: 'selfHosted', name: 'Self-hosted', icon: 'selfHosted' },
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

export interface CloudFolderConfig {
  path: string
  provider?: 'folder' | 'oneDrive'
  bookmarkBase64?: string
  displayName?: string
  oneDriveClientId?: string
  oneDriveRootId?: string
  oneDriveRootWebUrl?: string
  oneDriveWorkspacePath?: string
}

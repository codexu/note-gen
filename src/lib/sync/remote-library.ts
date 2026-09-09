import { exists, mkdir, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { dirname } from '@tauri-apps/api/path'
import { Store } from '@tauri-apps/plugin-store'
import { deleteFile as deleteGithubFile, getFiles as getGithubFiles, uploadFile as uploadGithubFile } from './github'
import { deleteFile as deleteGiteeFile, getFiles as getGiteeFiles, uploadFile as uploadGiteeFile } from './gitee'
import { deleteFile as deleteGitlabFile, getFileContent as getGitlabFileContent, getFiles as getGitlabFiles, uploadFile as uploadGitlabFile } from './gitlab'
import { deleteFile as deleteGiteaFile, getFileContent as getGiteaFileContent, getFiles as getGiteaFiles, uploadFile as uploadGiteaFile } from './gitea'
import { s3Delete, s3DownloadBytes, s3HeadObject, s3ListObjects, s3Upload } from './s3'
import { webdavDelete, webdavDownloadBytes, webdavHeadObject, webdavListObjects, webdavUpload } from './webdav'
import {
  androidCloudFolderWorkspaceDelete,
  androidCloudFolderWorkspaceDownloadBytes,
  androidCloudFolderWorkspaceHead,
  androidCloudFolderWorkspaceList,
  androidCloudFolderWorkspaceUpload,
  cloudFolderDelete,
  cloudFolderDownloadBytes,
  cloudFolderHeadObject,
  cloudFolderUpload,
  supportsCloudFolderWorkspace,
} from './cloud-folder'
import { ensureDirectoryExists, pullRemoteFile } from './auto-sync'
import { getDataSyncRepoName, getSyncRepoName } from './repo-utils'
import { getFilePathOptions } from '@/lib/workspace'
import { decodeBase64ToBytes, getRemoteFileContent } from './remote-file'
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'
import { recordSyncTiming } from './sync-timing'
import {
  createStaticAssetSyncMarker,
  rememberStaticAssetSyncMarker,
  withStaticAssetSyncLock,
} from './static-asset-sync-origin'

const MARKDOWN_FILE_PATTERN = /\.md$/i
const ONE_DRIVE_FILE_TRANSFER_CONCURRENCY = 3
const pendingLocalLibraryDownloads = new Map<string, Promise<boolean>>()

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await task(items[index], index)
    }
  }
  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
}

const STATIC_ASSET_CONTENT_TYPES: Record<string, string> = {
  bmp: 'image/bmp',
  css: 'text/css; charset=utf-8',
  gif: 'image/gif',
  html: 'text/html; charset=utf-8',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
}

export type RemoteLibraryOptions = {
  includeStaticAssets?: boolean
  platform?: SyncPlatform
}

export type RemoteRepositoryScope = 'workspace' | 'data'

type GitRemoteEntry = {
  name?: string
  path?: string
  type?: string
  sha?: string
  size?: number
}

export type RemoteLibraryFile = {
  path: string
  sha: string
  size?: number
  modifiedAt?: string
}

export type LocalLibraryFile = {
  path: string
  name: string
}

export type PullAllProgress = {
  phase: 'listing' | 'downloading' | 'uploading' | 'uploaded' | 'completed'
  current: number
  total: number
  path?: string
  sha?: string
}

export type PullAllResult = {
  total: number
  downloaded: number
  skipped: number
  failed: Array<{ path: string; message: string }>
}

export type UploadAllResult = {
  total: number
  uploaded: number
  failed: Array<{ path: string; message: string }>
}

async function getPlatform(store: Store): Promise<SyncPlatform> {
  return await store.get<SyncPlatform>('primaryBackupMethod') || 'github'
}

async function getFileTransferConcurrency(): Promise<number> {
  const store = await Store.load('store.json')
  if (await getPlatform(store) !== 'cloudFolder') return 1
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  return config?.provider === 'oneDrive' ? ONE_DRIVE_FILE_TRANSFER_CONCURRENCY : 1
}

async function getGitRepository(
  platform: Exclude<SyncPlatform, 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'>,
  scope: RemoteRepositoryScope,
) {
  return scope === 'data'
    ? getDataSyncRepoName(platform)
    : getSyncRepoName(platform)
}

function isLibraryPath(path: string, options: RemoteLibraryOptions): boolean {
  if (!path || path.startsWith('.') || path.split('/').some(part => part.startsWith('.'))) {
    return false
  }
  return options.includeStaticAssets === true || MARKDOWN_FILE_PATTERN.test(path)
}

export function getRemoteContentType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() || ''
  return STATIC_ASSET_CONTENT_TYPES[extension] || 'application/octet-stream'
}

function normalizeGitEntries(value: unknown): GitRemoteEntry[] {
  return Array.isArray(value) ? value as GitRemoteEntry[] : []
}

async function listGitRemoteFiles(
  platform: Exclude<SyncPlatform, 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'>,
  options: RemoteLibraryOptions
): Promise<RemoteLibraryFile[]> {
  const repo = await getSyncRepoName(platform)
  const queue = ['']
  const visited = new Set<string>()
  const files: RemoteLibraryFile[] = []

  while (queue.length > 0) {
    const path = queue.shift() || ''
    if (visited.has(path)) continue
    visited.add(path)

    let result: unknown
    switch (platform) {
      case 'github':
        result = await getGithubFiles({ path, repo })
        break
      case 'gitee':
        result = await getGiteeFiles({ path, repo })
        break
      case 'gitlab':
        result = await getGitlabFiles({ path, repo })
        break
      case 'gitea':
        result = await getGiteaFiles({ path, repo })
        break
    }

    for (const entry of normalizeGitEntries(result)) {
      const entryPath = entry.path || (path ? `${path}/${entry.name || ''}` : entry.name || '')
      if (!entryPath || entryPath.split('/').some(part => part.startsWith('.'))) continue

      if (entry.type === 'dir' || entry.type === 'tree') {
        queue.push(entryPath)
        continue
      }

      if (isLibraryPath(entryPath, options)) {
        files.push({
          path: entryPath,
          sha: entry.sha || '',
          size: entry.size,
        })
      }
    }
  }

  return files
}

async function listObjectStorageFiles(
  store: Store,
  platform: 's3' | 'webdav',
  options: RemoteLibraryOptions
): Promise<RemoteLibraryFile[]> {
  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) throw new Error('S3 未配置')
    const objects = await s3ListObjects(config, '')
    return objects
      .filter(object => isLibraryPath(object.key, options))
      .map(object => ({
        path: object.key,
        sha: object.etag,
        size: object.size,
        modifiedAt: object.lastModified,
      }))
  }

  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (!config) throw new Error('WebDAV 未配置')
  const queue = ['']
  const visited = new Set<string>()
  const files: RemoteLibraryFile[] = []

  while (queue.length > 0) {
    const path = queue.shift() || ''
    if (visited.has(path)) continue
    visited.add(path)
    const objects = await webdavListObjects(config, path)

    for (const object of objects) {
      const relativeObjectPath = object.key.replace(/^\/+/, '')
      const objectPath = path
        ? `${path}/${relativeObjectPath}`.replace(/\/$/, '')
        : relativeObjectPath.replace(/\/$/, '')

      if (object.key.endsWith('/')) {
        queue.push(objectPath)
      } else if (isLibraryPath(objectPath, options)) {
        files.push({
          path: objectPath,
          sha: object.etag,
          size: object.size,
          modifiedAt: object.lastModified,
        })
      }
    }
  }

  return files
}

async function listRemoteLibraryFilesRaw(options: RemoteLibraryOptions): Promise<RemoteLibraryFile[]> {
  const store = await Store.load('store.json')
  const platform = options.platform ?? await getPlatform(store)
  if (platform === 'selfHosted') return []
  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (!config?.path || !supportsCloudFolderWorkspace(config)) return []
    return (await androidCloudFolderWorkspaceList(config))
      .filter(object => isLibraryPath(object.key, options))
      .map(object => ({
        path: object.key,
        sha: object.etag,
        size: object.size,
        modifiedAt: new Date(object.modifiedAt).toISOString(),
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  }
  const files = platform === 's3' || platform === 'webdav'
    ? await listObjectStorageFiles(store, platform, options)
    : await listGitRemoteFiles(platform, options)

  return files.sort((left, right) => left.path.localeCompare(right.path))
}

export async function listRemoteLibraryFiles(options: RemoteLibraryOptions = {}): Promise<RemoteLibraryFile[]> {
  const startedAt = Date.now()
  try {
    const files = await listRemoteLibraryFilesRaw(options)
    recordSyncTiming('workspaceList', startedAt, { files: files.length, success: true })
    return files
  } catch (error) {
    recordSyncTiming('workspaceList', startedAt, { success: false })
    throw error
  }
}

export async function isLocalLibraryFile(path: string): Promise<boolean> {
  const pathOptions = await getFilePathOptions(path)
  return pathOptions.baseDir
    ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await exists(pathOptions.path)
}

export async function ensureLocalLibraryFile(path: string): Promise<boolean> {
  if (await isLocalLibraryFile(path)) return true

  const pendingDownload = pendingLocalLibraryDownloads.get(path)
  if (pendingDownload) return await pendingDownload

  const download = downloadRemoteLibraryFile(path)
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      pendingLocalLibraryDownloads.delete(path)
    })
  pendingLocalLibraryDownloads.set(path, download)
  return await download
}

export async function pullAllRemoteLibraryFiles(
  options: RemoteLibraryOptions = {},
  onProgress?: (progress: PullAllProgress) => void
): Promise<PullAllResult> {
  const startedAt = Date.now()
  onProgress?.({ phase: 'listing', current: 0, total: 0 })
  const files = await listRemoteLibraryFiles(options)
  const result = await pullRemoteLibraryFiles(files, onProgress)
  recordSyncTiming('workspacePullAll', startedAt, {
    total: result.total,
    downloaded: result.downloaded,
    skipped: result.skipped,
    failed: result.failed.length,
  })
  return result
}

export async function pullRemoteLibraryFolder(
  folderPath: string,
  onProgress?: (progress: PullAllProgress) => void
): Promise<PullAllResult> {
  onProgress?.({ phase: 'listing', current: 0, total: 0 })
  const normalizedFolderPath = folderPath.replace(/^\/+|\/+$/g, '')
  const files = (await listRemoteLibraryFiles({ includeStaticAssets: true }))
    .filter(file => file.path.startsWith(`${normalizedFolderPath}/`))
  // “下载文件夹”是用户明确发起的远端覆盖操作。已有本地文件也要
  // 重新下载，否则界面显示完成却无法取得远端更新。
  return await pullRemoteLibraryFiles(files, onProgress, { overwriteExisting: true })
}

async function pullRemoteLibraryFiles(
  files: RemoteLibraryFile[],
  onProgress?: (progress: PullAllProgress) => void,
  options: { overwriteExisting?: boolean } = {}
): Promise<PullAllResult> {
  const result: PullAllResult = { total: files.length, downloaded: 0, skipped: 0, failed: [] }
  const concurrency = await getFileTransferConcurrency()
  let started = 0

  await runWithConcurrency(files, concurrency, async file => {
    started += 1
    onProgress?.({ phase: 'downloading', current: started, total: files.length, path: file.path })

    try {
      await withStaticAssetSyncLock(file.path, async operationKey => {
        if (!options.overwriteExisting && await isLocalLibraryFile(file.path)) {
          result.skipped += 1
          return
        }

        const content = await downloadRemoteBytes(file.path)
        await saveLocalBytes(file.path, content, { operationKey })
        result.downloaded += 1
      })
    } catch (error) {
      result.failed.push({
        path: file.path,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  onProgress?.({ phase: 'completed', current: files.length, total: files.length })
  return result
}

export async function downloadRemoteLibraryFile(path: string): Promise<void> {
  await withStaticAssetSyncLock(path, async operationKey => {
    const pathOptions = await getFilePathOptions(path)
    const content = await downloadRemoteBytes(path)
    await saveLocalBytes(path, content, {
      operationKey,
      resolvedPathOptions: pathOptions,
    })
  })
}

export async function uploadAllLocalLibraryFiles(
  options: RemoteLibraryOptions = {},
  onProgress?: (progress: PullAllProgress) => void
): Promise<UploadAllResult> {
  const startedAt = Date.now()
  onProgress?.({ phase: 'listing', current: 0, total: 0 })
  const files = await collectLocalLibraryFiles('', options)
  const result = await uploadLocalLibraryFiles(files, onProgress)
  recordSyncTiming('workspaceUploadAll', startedAt, {
    total: result.total,
    uploaded: result.uploaded,
    failed: result.failed.length,
  })
  return result
}

export async function uploadLocalLibraryFolder(
  folderPath: string,
  onProgress?: (progress: PullAllProgress) => void
): Promise<UploadAllResult> {
  onProgress?.({ phase: 'listing', current: 0, total: 0 })
  const files = await collectLocalLibraryFiles(folderPath, { includeStaticAssets: true })
  return await uploadLocalLibraryFiles(files, onProgress)
}

export async function uploadLocalLibraryFile(path: string): Promise<string> {
  return await withStaticAssetSyncLock(path, async operationKey => {
    const pathOptions = await getFilePathOptions(path)
    const content = pathOptions.baseDir
      ? await readFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      : await readFile(pathOptions.path)
    const marker = await createStaticAssetSyncMarker(path, content, operationKey)

    const sha = await uploadRemoteBytes(path, content, `Upload file: ${path}`, getRemoteContentType(path))
    rememberStaticAssetSyncMarker(marker)
    return sha
  })
}

async function uploadLocalLibraryFiles(
  files: Array<{ path: string; name: string }>,
  onProgress?: (progress: PullAllProgress) => void
): Promise<UploadAllResult> {
  const result: UploadAllResult = { total: files.length, uploaded: 0, failed: [] }
  const concurrency = await getFileTransferConcurrency()
  let started = 0
  let completed = 0

  await runWithConcurrency(files, concurrency, async file => {
    started += 1
    onProgress?.({ phase: 'uploading', current: started, total: files.length, path: file.path })

    let sha = ''
    try {
      sha = await uploadLocalLibraryFile(file.path)
      result.uploaded += 1
    } catch (error) {
      result.failed.push({
        path: file.path,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      completed += 1
      if (sha) {
        onProgress?.({
          phase: 'uploaded',
          current: completed,
          total: files.length,
          path: file.path,
          sha,
        })
      }
    }
  })

  onProgress?.({ phase: 'completed', current: files.length, total: files.length })
  return result
}

async function collectLocalLibraryFiles(
  folderPath: string,
  options: RemoteLibraryOptions
): Promise<Array<{ path: string; name: string }>> {
  const files: Array<{ path: string; name: string }> = []
  const pathOptions = await getFilePathOptions(folderPath)
  const entries = pathOptions.baseDir
    ? await readDir(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await readDir(pathOptions.path)

  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('.') || entry.isSymlink) {
      continue
    }

    const entryPath = folderPath ? `${folderPath}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      files.push(...await collectLocalLibraryFiles(entryPath, options))
    } else if (entry.isFile && isLibraryPath(entryPath, options)) {
      files.push({ path: entryPath, name: entry.name })
    }
  }

  return files
}

export async function listLocalLibraryFiles(
  options: RemoteLibraryOptions = {},
): Promise<LocalLibraryFile[]> {
  return await collectLocalLibraryFiles('', options)
}

async function saveLocalBytes(
  path: string,
  content: Uint8Array,
  options: {
    operationKey?: string
    resolvedPathOptions?: Awaited<ReturnType<typeof getFilePathOptions>>
  } = {},
): Promise<void> {
  const { operationKey, resolvedPathOptions } = options
  if (!resolvedPathOptions) {
    await ensureDirectoryExists(path)
  }
  const pathOptions = resolvedPathOptions ?? await getFilePathOptions(path)
  const marker = await createStaticAssetSyncMarker(path, content, operationKey)
  if (resolvedPathOptions) {
    const parentPath = await dirname(pathOptions.path)
    if (pathOptions.baseDir) {
      await mkdir(parentPath, { baseDir: pathOptions.baseDir, recursive: true })
    } else {
      await mkdir(parentPath, { recursive: true })
    }
  }
  if (pathOptions.baseDir) {
    await writeFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
  } else {
    await writeFile(pathOptions.path, content)
  }
  rememberStaticAssetSyncMarker(marker)
}

async function downloadRemoteBytesRaw(
  path: string,
  scope: RemoteRepositoryScope = 'workspace',
): Promise<Uint8Array> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    const file = config ? await s3DownloadBytes(config, path) : null
    if (!file) throw new Error('S3 下载失败')
    return file.content
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    const file = config ? await webdavDownloadBytes(config, path) : null
    if (!file) throw new Error('WebDAV 下载失败')
    return file.content
  }

  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    const file = config?.path
      ? scope === 'workspace' && supportsCloudFolderWorkspace(config)
        ? await androidCloudFolderWorkspaceDownloadBytes(config, path)
        : scope === 'data'
          ? await cloudFolderDownloadBytes(config, path)
          : null
      : null
    if (!file) throw new Error('云盘文件夹下载失败')
    return file.content
  }

  if (platform === 'selfHosted') {
    throw new Error('自托管同步不使用旧远端工作区下载接口')
  }

  const repo = await getGitRepository(platform, scope)
  let file: unknown
  switch (platform) {
    case 'github':
      file = await getGithubFiles({ path, repo })
      break
    case 'gitee':
      file = await getGiteeFiles({ path, repo })
      break
    case 'gitlab':
      file = await getGitlabFileContent({ path, ref: 'main', repo })
      break
    case 'gitea':
      file = await getGiteaFileContent({ path, ref: 'main', repo })
      break
  }

  return decodeBase64ToBytes(getRemoteFileContent(file, path))
}

export async function downloadRemoteBytes(
  path: string,
  scope: RemoteRepositoryScope = 'workspace',
): Promise<Uint8Array> {
  const startedAt = Date.now()
  try {
    const content = await downloadRemoteBytesRaw(path, scope)
    recordSyncTiming('fileDownload', startedAt, {
      path,
      scope,
      bytes: content.byteLength,
      success: true,
    })
    return content
  } catch (error) {
    recordSyncTiming('fileDownload', startedAt, {
      path,
      scope,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function getExistingRemoteSha(platform: Exclude<SyncPlatform, 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'>, path: string, repo: string) {
  let entry: unknown
  switch (platform) {
    case 'github':
      entry = await getGithubFiles({ path, repo })
      break
    case 'gitee':
      entry = await getGiteeFiles({ path, repo })
      break
    case 'gitlab':
      entry = await getGitlabFiles({ path, repo })
      break
    case 'gitea':
      entry = await getGiteaFiles({ path, repo })
      break
  }

  return entry && !Array.isArray(entry) && typeof entry === 'object'
    ? (entry as { sha?: string }).sha
    : undefined
}

function getUploadedRemoteVersion(response: unknown): string {
  if (!response || typeof response !== 'object') return ''

  const responseRecord = response as Record<string, unknown>
  const wrappedData = 'data' in responseRecord ? responseRecord.data : responseRecord
  if (!wrappedData || typeof wrappedData !== 'object') return ''

  const dataRecord = wrappedData as Record<string, unknown>
  const contentData = dataRecord.content
  if (contentData && typeof contentData === 'object') {
    const contentSha = (contentData as Record<string, unknown>).sha
    if (typeof contentSha === 'string') return contentSha
  }

  for (const key of ['sha', 'id', 'commit_id'] as const) {
    const value = dataRecord[key]
    if (typeof value === 'string') return value
  }

  return ''
}

async function uploadRemoteContentRaw(
  path: string,
  content: string | Uint8Array,
  message: string,
  contentType?: string,
  scope: RemoteRepositoryScope = 'workspace',
): Promise<string> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    const result = config ? await s3Upload(config, path, content, undefined, contentType) : null
    if (!result) throw new Error('S3 上传失败')
    return result.etag || `uploaded:${path}`
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    const result = config ? await webdavUpload(config, path, content, undefined, contentType) : null
    if (!result) throw new Error('WebDAV 上传失败')
    return result.etag || `uploaded:${path}`
  }

  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    const result = config?.path
      ? scope === 'workspace' && supportsCloudFolderWorkspace(config)
        ? await androidCloudFolderWorkspaceUpload(config, path, content)
        : scope === 'data'
          ? await cloudFolderUpload(config, path, content)
          : null
      : null
    if (!result) throw new Error('云盘文件夹上传失败')
    return result.etag
  }

  if (platform === 'selfHosted') {
    throw new Error('自托管同步不使用旧远端工作区上传接口')
  }

  const repo = await getGitRepository(platform, scope)
  const sha = await getExistingRemoteSha(platform, path, repo)
  const filename = path.split('/').pop() || path
  let response: unknown

  switch (platform) {
    case 'github':
      response = await uploadGithubFile({ file: content, filename, path, repo, sha, message })
      break
    case 'gitee':
      response = await uploadGiteeFile({ file: content, filename, path, repo, sha, message })
      break
    case 'gitlab':
      response = await uploadGitlabFile({ file: content, filename, path, repo, sha, message })
      break
    case 'gitea':
      response = await uploadGiteaFile({ file: content, filename, path, repo, sha, message })
      break
  }

  if (!response) throw new Error(`${platform} 上传失败`)
  return getUploadedRemoteVersion(response) || sha || `uploaded:${path}`
}

async function uploadRemoteContent(
  path: string,
  content: string | Uint8Array,
  message: string,
  contentType?: string,
  scope: RemoteRepositoryScope = 'workspace',
): Promise<string> {
  const startedAt = Date.now()
  const bytes = typeof content === 'string'
    ? new TextEncoder().encode(content).byteLength
    : content.byteLength
  try {
    const version = await uploadRemoteContentRaw(path, content, message, contentType, scope)
    recordSyncTiming('fileUpload', startedAt, { path, scope, bytes, success: true })
    return version
  } catch (error) {
    recordSyncTiming('fileUpload', startedAt, { path, scope, bytes, success: false })
    throw error
  }
}

export async function uploadRemoteText(path: string, content: string, message: string): Promise<string> {
  return await uploadRemoteContent(path, content, message)
}

export async function uploadRemoteBytes(
  path: string,
  content: Uint8Array,
  message: string,
  contentType: string,
  scope: RemoteRepositoryScope = 'workspace',
): Promise<string> {
  return await uploadRemoteContent(path, content, message, contentType, scope)
}

export async function downloadRemoteText(path: string): Promise<string> {
  return await pullRemoteFile(path)
}

async function remoteFileExistsRaw(
  path: string,
  scope: RemoteRepositoryScope = 'workspace',
): Promise<boolean> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    return config ? Boolean(await s3HeadObject(config, path)) : false
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    return config ? Boolean(await webdavHeadObject(config, path)) : false
  }

  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (!config?.path) return false
    if (scope === 'workspace' && supportsCloudFolderWorkspace(config)) {
      return Boolean(await androidCloudFolderWorkspaceHead(config, path))
    }
    return scope === 'data' ? Boolean(await cloudFolderHeadObject(config, path)) : false
  }

  if (platform === 'selfHosted') return false

  const repo = await getGitRepository(platform, scope)
  return Boolean(await getExistingRemoteSha(platform, path, repo))
}

export async function remoteFileExists(
  path: string,
  scope: RemoteRepositoryScope = 'workspace',
): Promise<boolean> {
  const startedAt = Date.now()
  try {
    const found = await remoteFileExistsRaw(path, scope)
    recordSyncTiming('fileExists', startedAt, { path, scope, found, success: true })
    return found
  } catch (error) {
    recordSyncTiming('fileExists', startedAt, { path, scope, success: false })
    throw error
  }
}

export async function deleteRemoteFile(
  path: string,
  scope: RemoteRepositoryScope = 'workspace',
): Promise<boolean> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) return false
    if (!await s3HeadObject(config, path)) return true
    return s3Delete(config, path)
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (!config) return false
    if (!await webdavHeadObject(config, path)) return true
    return webdavDelete(config, path)
  }

  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (!config?.path) return false
    if (scope === 'workspace' && supportsCloudFolderWorkspace(config)) {
      return androidCloudFolderWorkspaceDelete(config, path)
    }
    if (scope === 'data') return cloudFolderDelete(config, path)
    return false
  }

  if (platform === 'selfHosted') return false

  const repo = await getGitRepository(platform, scope)
  const sha = await getExistingRemoteSha(platform, path, repo)
  if (!sha) return true

  switch (platform) {
    case 'github':
      return Boolean(await deleteGithubFile({ path, sha, repo }))
    case 'gitee':
      return Boolean(await deleteGiteeFile({ path, sha, repo }))
    case 'gitlab':
      return Boolean(await deleteGitlabFile({ path, repo }))
    case 'gitea':
      return Boolean(await deleteGiteaFile({ path, sha, repo }))
  }
}

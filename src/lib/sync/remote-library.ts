import type { RemoteWriteCondition } from './write-condition'
import { mutateFileConditionally as mutateGitlabFileConditionally } from './gitlab'
import { exists, mkdir, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { dirname } from '@tauri-apps/api/path'
import { Store } from '@tauri-apps/plugin-store'
import { deleteFile as deleteGithubFile, getDirectoryFiles as getGithubDirectoryFiles, getFiles as getGithubFiles, uploadFile as uploadGithubFile } from './github'
import { deleteFile as deleteGiteeFile, getDirectoryFiles as getGiteeDirectoryFiles, getFiles as getGiteeFiles, uploadFile as uploadGiteeFile } from './gitee'
import { deleteFile as deleteGitlabFile, getFileContent as getGitlabFileContent, getDirectoryFiles as getGitlabDirectoryFiles, uploadFile as uploadGitlabFile } from './gitlab'
import { deleteFile as deleteGiteaFile, getFileContent as getGiteaFileContent, getDirectoryFiles as getGiteaDirectoryFiles, uploadFile as uploadGiteaFile } from './gitea'
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
  cloudFolderListObjects,
  cloudFolderUpload,
  supportsCloudFolderWorkspace,
} from './cloud-folder'
import { ensureDirectoryExists, pullRemoteFile } from './auto-sync'
import { getDataSyncRepoName, getSyncRepoName } from './repo-utils'
import { getFilePathOptions } from '@/lib/workspace'
import { decodeBase64ToBytes, getRemoteFileContent } from './remote-file'
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'
import { recordSyncTiming } from './sync-timing'
import { prepareWorkspacePathUpload, retryWorkspacePathMoves } from './workspace-path-moves'
import { captureWorkspaceRemoteWriteGuard } from './workspace-remote-write-guard'
import { getCurrentEditorWorkspaceRoot, runEditorPathWriteTransaction } from '@/lib/editor-deactivation'
import { getFileDeletionRevision, isFileDeletionPending } from '@/stores/file-deletion'
import useSettingStore from '@/stores/setting'
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
  scope?: RemoteRepositoryScope
  onListProgress?: (path: string, files: number) => void
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
  platform: Exclude<SyncPlatform, 'local' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'>,
  scope: RemoteRepositoryScope,
) {
  return scope === 'data'
    ? getDataSyncRepoName(platform)
    : getSyncRepoName(platform)
}

function isLibraryPath(path: string, options: RemoteLibraryOptions): boolean {
  if (path.endsWith('/')) return false
  if (options.scope === 'data') return path.startsWith('.data/') && !path.split('/').includes('..')
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
  platform: Exclude<SyncPlatform, 'local' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'>,
  options: RemoteLibraryOptions
): Promise<RemoteLibraryFile[]> {
  const repo = await getGitRepository(platform, options.scope || 'workspace')
  const directoryCache = new Map<string, Promise<unknown>>()
  const queue = ['']
  const visited = new Set<string>()
  const files: RemoteLibraryFile[] = []

  while (queue.length > 0) {
    const path = queue.shift() || ''
    if (visited.has(path)) continue
    visited.add(path)
    options.onListProgress?.(path, files.length)

    let result: unknown
    switch (platform) {
      case 'github':
        result = await getGithubDirectoryFiles({ path, repo, cache: directoryCache })
        break
      case 'gitee':
        result = await getGiteeDirectoryFiles({ path, repo, cache: directoryCache })
        break
      case 'gitlab':
        result = await getGitlabDirectoryFiles({ path, repo })
        break
      case 'gitea':
        result = await getGiteaDirectoryFiles({ path, repo })
        break
    }

    for (const entry of normalizeGitEntries(result)) {
      const entryPath = entry.path || (path ? `${path}/${entry.name || ''}` : entry.name || '')
      if (!entryPath || (options.scope !== 'data' && entryPath.split('/').some(part => part.startsWith('.')))) continue

      if (entry.type === 'dir' || entry.type === 'tree') {
        if (options.scope !== 'data' || entryPath === '.data' || entryPath.startsWith('.data/')) queue.push(entryPath)
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
    const objects = await s3ListObjects(config, options.scope === 'data' ? '.data/' : '')
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
    options.onListProgress?.(path, files.length)
    const objects = await webdavListObjects(config, path)

    for (const object of objects) {
      const relativeObjectPath = object.key.replace(/^\/+/, '')
      const objectPath = path
        ? `${path}/${relativeObjectPath}`.replace(/\/$/, '')
        : relativeObjectPath.replace(/\/$/, '')

      if (object.key.endsWith('/')) {
        if (options.scope !== 'data' || objectPath === '.data' || objectPath.startsWith('.data/')) queue.push(objectPath)
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
  if (platform === 'selfHosted' || platform === 'local') return []
  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (!config?.path) throw new Error('Cloud folder is not configured')
    if (options.scope !== 'data' && !supportsCloudFolderWorkspace(config)) return []
    return (await (options.scope === 'data' ? cloudFolderListObjects(config, '.data/') : androidCloudFolderWorkspaceList(config)))
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
  await retryWorkspacePathMoves()
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
  await retryWorkspacePathMoves()
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
    const workspacePath = useSettingStore.getState().workspacePath || ''
    const deletionRevision = getFileDeletionRevision(file.path, workspacePath)
    started += 1
    onProgress?.({ phase: 'downloading', current: started, total: files.length, path: file.path })

    try {
      await withStaticAssetSyncLock(file.path, async operationKey => {
        if (!options.overwriteExisting && await isLocalLibraryFile(file.path)) {
          result.skipped += 1
          return
        }

        const content = await downloadRemoteBytes(file.path)
        await saveLocalBytes(file.path, content, {
          operationKey,
          beforeWrite: () => {
            if (isFileDeletionPending(file.path, workspacePath)
              || getFileDeletionRevision(file.path, workspacePath) !== deletionRevision) {
              throw new Error('The file was deleted during download')
            }
          },
        })
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
  const workspacePath = useSettingStore.getState().workspacePath || ''
  const deletionRevision = getFileDeletionRevision(path, workspacePath)
  if (isFileDeletionPending(path, workspacePath)) throw new Error('The file is being deleted')
  await retryWorkspacePathMoves()
  await withStaticAssetSyncLock(path, async operationKey => {
    const pathOptions = await getFilePathOptions(path)
    const content = await downloadRemoteBytes(path)
    await saveLocalBytes(path, content, {
      operationKey,
      resolvedPathOptions: pathOptions,
      beforeWrite: () => {
        if (isFileDeletionPending(path, workspacePath)
          || getFileDeletionRevision(path, workspacePath) !== deletionRevision) {
          throw new Error('The file was deleted during download')
        }
      },
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
    await prepareWorkspacePathUpload(path)
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

export async function saveLocalBytes(
  path: string,
  content: Uint8Array,
  options: {
    operationKey?: string
    platform?: SyncPlatform
    resolvedPathOptions?: Awaited<ReturnType<typeof getFilePathOptions>>
    beforeWrite?: () => void
  } = {},
): Promise<void> {
  const workspaceRoot = await getCurrentEditorWorkspaceRoot()
  await runEditorPathWriteTransaction(path, async () => {
    options.beforeWrite?.()
    if (isFileDeletionPending(path)) throw new Error('The file is being deleted')
    const { operationKey, resolvedPathOptions } = options
    if (!resolvedPathOptions) {
      await ensureDirectoryExists(path)
    }
    const pathOptions = resolvedPathOptions ?? await getFilePathOptions(path)
    const marker = await createStaticAssetSyncMarker(path, content, operationKey, options.platform)
    if (resolvedPathOptions) {
      const parentPath = await dirname(pathOptions.path)
      if (pathOptions.baseDir) {
        await mkdir(parentPath, { baseDir: pathOptions.baseDir, recursive: true })
      } else {
        await mkdir(parentPath, { recursive: true })
      }
    }
    options.beforeWrite?.()
    if (isFileDeletionPending(path)) throw new Error('The file is being deleted')
    if (pathOptions.baseDir) {
      await writeFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
    } else {
      await writeFile(pathOptions.path, content)
    }
    rememberStaticAssetSyncMarker(marker)
    return true
  }, workspaceRoot)
}

async function downloadRemoteBytesRaw(
  path: string,
  scope: RemoteRepositoryScope = 'workspace',
  target?: SyncPlatform,
  onVersion?: (version: string) => void,
): Promise<Uint8Array> {
  const store = await Store.load('store.json')
  const platform = target ?? await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    const file = config ? await s3DownloadBytes(config, path) : null
    if (!file) throw new Error('S3 下载失败')
    onVersion?.(file.etag)
    return file.content
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    const file = config ? await webdavDownloadBytes(config, path) : null
    if (!file) throw new Error('WebDAV 下载失败')
    onVersion?.(file.etag)
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
    onVersion?.(file.etag)
    return file.content
  }

  if (platform === 'selfHosted' || platform === 'local') {
    throw new Error('当前同步方式不支持远端工作区下载')
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
      file = await getGitlabFileContent({ path, repo })
      break
    case 'gitea':
      file = await getGiteaFileContent({ path, repo })
      break
  }

  if (file && typeof file === 'object' && 'sha' in file && typeof file.sha === 'string') onVersion?.(file.sha)
  return decodeBase64ToBytes(getRemoteFileContent(file, path))
}

export async function downloadRemoteBytes(
  path: string, scope: RemoteRepositoryScope = 'workspace', platform?: SyncPlatform,
): Promise<Uint8Array> {
  return (await downloadRemoteBytesWithVersion(path, scope, platform)).content
}

export async function downloadRemoteBytesWithVersion(
  path: string,
  scope: RemoteRepositoryScope = 'workspace',
  platform?: SyncPlatform,
): Promise<{ content: Uint8Array; version?: string }> {
  const startedAt = Date.now()
  try {
    let version: string | undefined
    const content = await downloadRemoteBytesRaw(path, scope, platform, value => { version = value })
    recordSyncTiming('fileDownload', startedAt, {
      path,
      scope,
      bytes: content.byteLength,
      success: true,
    })
    return { content, version }
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

async function getGitRemoteFileMetadata(
  platform: Exclude<SyncPlatform, 'local' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'>,
  path: string, repo: string,
): Promise<{ version: string; size?: number } | null> {
  const parent = path.split('/').slice(0, -1).join('/')
  let files: unknown
  switch (platform) {
    case 'github': files = await getGithubDirectoryFiles({ path: parent, repo }); break
    case 'gitee': files = await getGiteeDirectoryFiles({ path: parent, repo }); break
    case 'gitlab': files = await getGitlabDirectoryFiles({ path: parent, repo }); break
    case 'gitea': files = await getGiteaDirectoryFiles({ path: parent, repo }); break
  }
  const entry = normalizeGitEntries(files).find(file => file.path === path && file.type !== 'dir')
  return entry ? { version: entry.sha || '', size: entry.size } : null
}

async function getExistingRemoteSha(platform: Exclude<SyncPlatform, 'local' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'>, path: string, repo: string) {
  return (await getGitRemoteFileMetadata(platform, path, repo))?.version
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
  condition?: RemoteWriteCondition,
  target?: SyncPlatform,
  suppliedBeforeWrite?: () => Promise<void>,
): Promise<string> {
  const store = await Store.load('store.json')
  const platform = target ?? await getPlatform(store)
  // Platform-switch recovery owns its explicit target and version checks.
  const switchingTarget = target !== undefined && Boolean(await store.get('platformSwitchRecovery'))
  // A manual editor push supplies its own canonical-content guard; that
  // snapshot may legitimately precede the debounced disk save.
  const capturedGuard = scope === 'workspace' && !switchingTarget
    ? await captureWorkspaceRemoteWriteGuard(path, platform, true, suppliedBeforeWrite ? undefined : content) : undefined
  const beforeWrite = capturedGuard || suppliedBeforeWrite ? async () => {
    await capturedGuard?.()
    await suppliedBeforeWrite?.()
  } : undefined

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    const result = config ? await s3Upload(config, path, content, undefined, contentType, condition, beforeWrite) : null
    if (!result) throw new Error('S3 上传失败')
    return result.etag || `uploaded:${path}`
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    const result = config ? await webdavUpload(config, path, content, undefined, contentType, condition, beforeWrite) : null
    if (!result) throw new Error('WebDAV 上传失败')
    return result.etag || `uploaded:${path}`
  }

  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (condition && config?.provider !== 'oneDrive') throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
    const result = config?.path
      ? scope === 'workspace' && supportsCloudFolderWorkspace(config)
        ? await androidCloudFolderWorkspaceUpload(config, path, content, condition, beforeWrite)
        : scope === 'data'
          ? await cloudFolderUpload(config, path, content, condition)
          : null
      : null
    if (!result) throw new Error('云盘文件夹上传失败')
    return result.etag
  }

  if (platform === 'selfHosted' || platform === 'local') {
    throw new Error('当前同步方式不支持远端工作区上传')
  }

  const repo = await getGitRepository(platform, scope)
  const sha = condition ? condition.version || undefined : await getExistingRemoteSha(platform, path, repo)
  const filename = path.split('/').pop() || path
  let response: unknown

  switch (platform) {
    case 'github':
      response = await uploadGithubFile({ file: content, filename, path, repo, sha, message, guarded: Boolean(condition), beforeWrite })
      break
    case 'gitee':
      response = await uploadGiteeFile({ file: content, filename, path, repo, sha, message, guarded: Boolean(condition), beforeWrite })
      break
    case 'gitlab':
      if (condition) {
        await mutateGitlabFileConditionally(path, repo, condition, typeof content === 'string' ? new TextEncoder().encode(content) : content, beforeWrite)
        return '' // The final listing supplies the new blob version.
      }
      response = await uploadGitlabFile({ file: content, filename, path, repo, sha, message, beforeWrite })
      break
    case 'gitea':
      response = await uploadGiteaFile({ file: content, filename, path, repo, sha, message, guarded: Boolean(condition), beforeWrite })
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
  condition?: RemoteWriteCondition,
  target?: SyncPlatform,
  beforeWrite?: () => Promise<void>,
): Promise<string> {
  const startedAt = Date.now()
  const bytes = typeof content === 'string'
    ? new TextEncoder().encode(content).byteLength
    : content.byteLength
  try {
    const version = await uploadRemoteContentRaw(path, content, message, contentType, scope, condition, target, beforeWrite)
    recordSyncTiming('fileUpload', startedAt, { path, scope, bytes, success: true })
    return version
  } catch (error) {
    recordSyncTiming('fileUpload', startedAt, { path, scope, bytes, success: false })
    throw error
  }
}

export async function uploadRemoteText(path: string, content: string, message: string, beforeWrite?: () => Promise<void>): Promise<string> {
  return await uploadRemoteContent(path, content, message, undefined, 'workspace', undefined, undefined, beforeWrite)
}

/** Keep attachment existence checks create-only when backed by OneDrive. */
export async function getOneDriveCreateOnlyCondition(): Promise<RemoteWriteCondition | undefined> {
  const store = await Store.load('store.json')
  if (await getPlatform(store) !== 'cloudFolder') return undefined
  return (await store.get<CloudFolderConfig>('cloudFolderSyncConfig'))?.provider === 'oneDrive' ? { version: null } : undefined
}

export async function uploadRemoteBytes(
  path: string,
  content: Uint8Array,
  message: string,
  contentType: string,
  scope: RemoteRepositoryScope = 'workspace',
  condition?: RemoteWriteCondition,
  target?: SyncPlatform,
  beforeWrite?: () => Promise<void>,
): Promise<string> {
  return await uploadRemoteContent(path, content, message, contentType, scope, condition, target, beforeWrite)
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

  if (platform === 'selfHosted' || platform === 'local') return false

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

/** Read current version information without requesting the file's body. */
export async function getRemoteFileMetadata(
  path: string, scope: RemoteRepositoryScope = 'workspace', target?: SyncPlatform,
): Promise<{ version: string; size?: number } | null> {
  const store = await Store.load('store.json')
  const platform = target ?? await getPlatform(store)
  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) throw new Error('S3 未配置')
    const file = await s3HeadObject(config, path)
    return file ? { version: file.etag } : null
  }
  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (!config) throw new Error('WebDAV 未配置')
    const file = await webdavHeadObject(config, path)
    return file ? { version: file.etag } : null
  }
  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (!config?.path) throw new Error('云盘文件夹未配置')
    const file = scope === 'workspace' && supportsCloudFolderWorkspace(config)
      ? await androidCloudFolderWorkspaceHead(config, path)
      : await cloudFolderHeadObject(config, path)
    return file ? { version: file.etag, size: file.size } : null
  }
  if (platform === 'local' || platform === 'selfHosted') return null
  const repo = await getGitRepository(platform, scope)
  return getGitRemoteFileMetadata(platform, path, repo)
}

export async function deleteRemoteFile(
  path: string,
  scope: RemoteRepositoryScope = 'workspace',
  condition?: RemoteWriteCondition,
  target?: SyncPlatform,
  beforeDelete?: () => Promise<void>,
): Promise<boolean> {
  await beforeDelete?.()
  const store = await Store.load('store.json')
  const platform = target ?? await getPlatform(store)
  const switchingTarget = target !== undefined && Boolean(await store.get('platformSwitchRecovery'))
  const capturedGuard = scope === 'workspace' && !switchingTarget
    ? await captureWorkspaceRemoteWriteGuard(path, platform, false) : undefined
  const beforeWrite = beforeDelete || capturedGuard
    ? async () => { await beforeDelete?.(); await capturedGuard?.() }
    : undefined

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) return false
    if (!condition && !await s3HeadObject(config, path)) return true
    return s3Delete(config, path, undefined, condition, beforeWrite)
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (!config) return false
    if (!condition && !await webdavHeadObject(config, path)) return true
    return webdavDelete(config, path, undefined, condition, beforeWrite)
  }

  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (condition && config?.provider !== 'oneDrive') throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
    if (!config?.path) return false
    if (scope === 'workspace' && supportsCloudFolderWorkspace(config)) {
      return androidCloudFolderWorkspaceDelete(config, path, condition, beforeWrite)
    }
    if (scope === 'data') return cloudFolderDelete(config, path, condition)
    return false
  }

  if (platform === 'selfHosted' || platform === 'local') return false

  const repo = await getGitRepository(platform, scope)
  const sha = condition ? condition.version || undefined : await getExistingRemoteSha(platform, path, repo)
  if (!sha) { if (condition) throw new Error('SYNC_SWITCH_STALE'); return true }

  switch (platform) {
    case 'github':
      return Boolean(await deleteGithubFile({ path, sha, repo, guarded: Boolean(condition), beforeWrite }))
    case 'gitee':
      return Boolean(await deleteGiteeFile({ path, sha, repo, guarded: Boolean(condition), beforeWrite }))
    case 'gitlab':
      if (condition) return mutateGitlabFileConditionally(path, repo, condition, undefined, beforeWrite)
      return Boolean(await deleteGitlabFile({ path, repo, beforeWrite }))
    case 'gitea':
      return Boolean(await deleteGiteaFile({ path, sha, repo, guarded: Boolean(condition), beforeWrite }))
  }
}

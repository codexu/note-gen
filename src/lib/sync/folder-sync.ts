import { Store } from '@tauri-apps/plugin-store'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { collectMarkdownFiles } from '@/lib/files'
import { RepoNames } from './github.types'
import { getSyncRepoName } from './repo-utils'
import { getGiteaApiBaseUrl } from './gitea'
import { s3Upload } from './s3'
import { webdavUpload } from './webdav'
import { S3Config, WebDAVConfig, type SyncPlatform } from '@/types/sync'
import { buildGithubCreateTreePayload } from './folder-sync-payload'
import { buildRepoContentPath, debugSyncPath } from './remote-file'
import { fetchGiteeRead } from './gitee-request'
import { withGithubRepoWriteLock } from './github-repo-write-lock'
import { withGitRepoWriteLock } from './git-repo-write-lock'
import { captureWorkspaceRemoteWriteGuard } from './workspace-remote-write-guard'
import { fetchRemoteRead, recoverRemoteRead, recoverRemoteMutation } from './remote-mutation-recovery'
import { readDirectoryResponse, remoteRecord } from './directory-listing'
import { fetch as encodeFetch } from './encode-fetch'
import { getGitlabApiBaseUrl } from './gitlab'
import { gitBlobVersion } from './remote-content-cache'
import { syncStaleError } from './sync-stale-error'

export interface FolderSyncResult {
  success: boolean
  totalFiles: number
  successCount: number
  failedCount: number
  message: string
  errors?: string[]
}

type GitProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'
interface FolderUploadFile {
  path: string
  content: string
  sha?: string
  beforeWrite?: () => Promise<void>
}

export class FolderSync {
  private platform: string = 'github'

  constructor() {
    // 不再在 constructor 中初始化
  }

  /**
   * 初始化平台配置（在每次同步前调用以获取最新配置）
   */
  private async init() {
    const store = await Store.load('store.json')
    this.platform = await store.get<string>('primaryBackupMethod') || 'github'
  }

  async syncFolder(localFolderPath: string): Promise<FolderSyncResult> {
    // 每次同步前重新读取平台配置
    await this.init()

    try {
      const { retryWorkspacePathMoves } = await import('./workspace-path-moves')
      await retryWorkspacePathMoves()
      // 1. 获取本地文件夹下所有 Markdown 文件
      const markdownFiles = await collectMarkdownFiles(localFolderPath)

      if (markdownFiles.length === 0) {
        return {
          success: false,
          totalFiles: 0,
          successCount: 0,
          failedCount: 0,
          message: '当前文件夹下没有 Markdown 文件'
        }
      }

      // 2. 读取每个文件的内容
      const workspace = await getWorkspacePath()
      const filesToUpload: FolderUploadFile[] = []

      for (const file of markdownFiles) {
        const pathOptions = await getFilePathOptions(file.path)
        let content = ''

        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        const beforeWrite = await captureWorkspaceRemoteWriteGuard(file.path, this.platform as SyncPlatform, true, content)

        // 相对路径作为远程路径
        const remotePath = file.path
        debugSyncPath('folderSync.collectFile', {
          localFolderPath,
          sourcePath: file.path,
          remotePath,
        })

        filesToUpload.push({
          path: remotePath,
          content,
          beforeWrite
        })
      }

      // 3. 根据平台执行批量提交
      const message = `Sync folder: ${localFolderPath} - ${new Date().toLocaleString('zh-CN')}`
      let success = false
      const repoName = this.platform === 's3' || this.platform === 'webdav'
        ? RepoNames.sync
        : await getSyncRepoName(this.platform as GitProvider)

      switch (this.platform) {
        case 'github': {
          // GitHub 批量提交
          success = await this._githubBatchCommit(repoName, filesToUpload, message)
          break
        }
        case 'gitee': {
          // 先获取远程文件 SHA（用于覆盖）
          const giteeFiles = await this._getGiteeFiles(repoName)
          for (const file of filesToUpload) {
            if (giteeFiles[file.path]) {
              file.sha = giteeFiles[file.path].sha
            }
          }
          // Gitee: 逐个上传，带 SHA 可以覆盖
          success = await this._giteeBatchCommit(repoName, filesToUpload, message)
          break
        }
        case 'gitlab':
          success = await this._gitlabBatchCommit(repoName, filesToUpload, message)
          break
        case 'gitea':
          success = await this._giteaBatchCommit(repoName, filesToUpload)
          break
        case 's3':
          success = await this._s3BatchUpload(filesToUpload)
          break
        case 'webdav':
          success = await this._webdavBatchUpload(filesToUpload)
          break
        default:
          return {
            success: false,
            totalFiles: markdownFiles.length,
            successCount: 0,
            failedCount: markdownFiles.length,
            message: `不支持的平台: ${this.platform}`
          }
      }

      if (success) {
        return {
          success: true,
          totalFiles: markdownFiles.length,
          successCount: markdownFiles.length,
          failedCount: 0,
          message: `成功同步 ${markdownFiles.length} 个文件`
        }
      } else {
        return {
          success: false,
          totalFiles: markdownFiles.length,
          successCount: 0,
          failedCount: markdownFiles.length,
          message: '同步失败'
        }
      }
    } catch (error) {
      return {
        success: false,
        totalFiles: 0,
        successCount: 0,
        failedCount: 0,
        message: String(error),
        errors: [String(error)]
      }
    }
  }

  /**
   * 获取远程仓库中所有文件的 SHA
   */
  async _getGithubTreeFiles(
    repo: string,
    path: string
  ): Promise<Record<string, { sha: string; type: string }>> {
    const store = await Store.load('store.json')
    const accessToken = await store.get<string>('accessToken')
    const githubUsername = await store.get<string>('githubUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${accessToken}`)
    headers.append('Accept', 'application/vnd.github+json')
    headers.append('X-GitHub-Api-Version', '2022-11-28')

    // 使用 git tree API 获取指定路径下的所有文件
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/git/trees/main?recursive=1`
    const response = await fetch(url, { method: 'GET', headers, proxy })

    if (!response.ok) return {}

    const data = await response.json()
    const result: Record<string, { sha: string; type: string }> = {}

    if (data.tree) {
      for (const item of data.tree) {
        if (item.path && item.path.startsWith(path) && item.type === 'blob') {
          result[item.path] = { sha: item.sha, type: item.type }
        }
      }
    }

    return result
  }

  /**
   * 批量提交多个文件到 GitHub
   */
  async _githubBatchCommit(
    repo: string,
    files: FolderUploadFile[],
    message: string
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const accessToken = await store.get<string>('accessToken')
    const githubUsername = await store.get<string>('githubUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined
    if (!githubUsername) return false

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${accessToken}`)
    headers.append('Accept', 'application/vnd.github+json')
    headers.append('X-GitHub-Api-Version', '2022-11-28')
    headers.append('Content-Type', 'application/json')
    const capturedFiles = files.map(file => ({ ...file }))

    return await withGithubRepoWriteLock(githubUsername, repo, async () => {
      const baseUrl = `https://api.github.com/repos/${encodeURIComponent(githubUsername)}/${encodeURIComponent(repo)}`
      const read = async (resource: string) => remoteRecord(await readDirectoryResponse(await fetchRemoteRead(
        `${baseUrl}${resource}`, { headers: new Headers(headers), proxy })))
      const oid = (value: unknown): string => {
        if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) throw new Error('Invalid GitHub batch object version')
        return value.toLowerCase()
      }
      const repository = await read('')
      if (typeof repository.default_branch !== 'string' || !repository.default_branch.trim()) return false
      const branch = repository.default_branch.trim()
      const reference = `refs/heads/${branch}`
      const readHead = async () => {
        const value = await read(`/git/ref/heads/${encodeURIComponent(branch)}`)
        const object = remoteRecord(value.object)
        if (value.ref !== reference || object.type !== 'commit') throw new Error('Invalid GitHub batch reference')
        return oid(object.sha)
      }
      const parentCommitSha = await readHead()
      const parent = await read(`/git/commits/${parentCommitSha}`)
      if (oid(parent.sha) !== parentCommitSha) throw new Error('Invalid GitHub batch parent commit')
      const baseTreeSha = oid(remoteRecord(parent.tree).sha)
      const beforeWrite = async () => { for (const file of capturedFiles) await file.beforeWrite?.() }
      const postObject = async (resource: string, body: string) => {
        const response = await recoverRemoteMutation({ beforeWrite,
          send: () => fetch(`${baseUrl}${resource}`, { method: 'POST', headers: new Headers(headers), body, proxy }),
          // Tree and commit objects remain unreachable until the separate ref CAS.
          reconcile: async () => ({ state: 'unchanged' }),
        })
        return remoteRecord(await readDirectoryResponse(response))
      }
      const tree = await postObject('/git/trees', JSON.stringify(buildGithubCreateTreePayload(capturedFiles, baseTreeSha)))
      const commit = await postObject('/git/commits', JSON.stringify({
        message, tree: oid(tree.sha), parents: [parentCommitSha],
      }))
      const candidate = oid(commit.sha)
      const body = JSON.stringify({ sha: candidate, force: false })
      const response = await recoverRemoteMutation({ beforeWrite,
        send: () => fetch(`${baseUrl}/git/refs/heads/${encodeURIComponent(branch)}`, {
          method: 'PATCH', headers: new Headers(headers), body, proxy,
        }),
        reconcile: async () => {
          const current = await readHead()
          if (current === candidate) return { state: 'applied', value: new Response(null, { status: 200 }) }
          if (current === parentCommitSha) return { state: 'unchanged' }
          throw syncStaleError({ stage: 'apply', path: reference, source: 'remote', check: 'gitRef',
            expected: { sha: parentCommitSha, exists: true }, actual: { sha: current, exists: true } })
        },
      })
      return response.ok
    })
  }

  /**
   * 获取 Gitee 仓库中所有文件的 SHA（递归获取子目录）
   */
  async _getGiteeFiles(repo: string, path: string = ''): Promise<Record<string, { sha: string }>> {
    const store = await Store.load('store.json')
    const giteeAccessToken = await store.get<string>('giteeAccessToken')
    const giteeUsername = await store.get<string>('giteeUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!giteeAccessToken || !giteeUsername) {
      console.error('[Gitee] 缺少 accessToken 或 username')
      return {}
    }

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${giteeAccessToken}`)

    // 使用 Gitee API 获取仓库内容
    const encodedPath = buildRepoContentPath({ path })
    const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(giteeUsername)}/${encodeURIComponent(repo)}/contents${encodedPath ? '/' + encodedPath : ''}`
    const response = await fetchGiteeRead(url, { headers, proxy })

    if (!response.ok) {
      console.error('[Gitee] 获取文件列表失败:', await response.text())
      return {}
    }

    const data = await response.json()
    const result: Record<string, { sha: string }> = {}

    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.type === 'file' && item.path && item.sha) {
          result[item.path] = { sha: item.sha }
        } else if (item.type === 'dir' && item.path) {
          // 递归获取子目录
          const subFiles = await this._getGiteeFiles(repo, item.path)
          Object.assign(result, subFiles)
        }
      }
    }

    return result
  }

  /**
   * 获取 Gitea 仓库中所有文件的 SHA（递归获取子目录）
   */
  async _getGiteaFiles(repo: string, path: string = ''): Promise<Record<string, { sha: string }>> {
    const store = await Store.load('store.json')
    const giteaAccessToken = await store.get<string>('giteaAccessToken')
    const giteaUsername = await store.get<string>('giteaUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!giteaAccessToken || !giteaUsername) {
      console.error('[Gitea] 缺少 accessToken 或 username')
      return {}
    }

    let giteaUrl: string
    try {
      giteaUrl = await getGiteaApiBaseUrl()
    } catch {
      return {}
    }

    const apiBaseUrl = giteaUrl.endsWith('/') ? giteaUrl.slice(0, -1) : giteaUrl

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${giteaAccessToken}`)

      const encodedPath = buildRepoContentPath({ path })
      debugSyncPath('folderSync.gitea.listFiles', {
        inputPath: path,
        encodedPath,
      })
    const url = `${apiBaseUrl}/repos/${giteaUsername}/${repo}/contents${encodedPath ? '/' + encodedPath : ''}`

    try {
      const response = await fetch(url, { method: 'GET', headers, proxy })

      if (!response.ok) {
        console.error('[Gitea] 获取文件列表失败:', response.status)
        return {}
      }

      const data = await response.json()
      const result: Record<string, { sha: string }> = {}

      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.type === 'file' && item.path && item.sha) {
            result[item.path] = { sha: item.sha }
          } else if (item.type === 'dir' && item.path) {
            // 递归获取子目录
            const subFiles = await this._getGiteaFiles(repo, item.path)
            Object.assign(result, subFiles)
          }
        }
      }

      return result
    } catch (error) {
      console.error('[Gitea] 获取文件列表异常:', error)
      return {}
    }
  }

  /**
   * Gitee 批量提交
   * 逐个调用共享仓库写锁，空文件同样走受保护的 Git 传输。
   */
  async _giteeBatchCommit(
    repo: string,
    files: FolderUploadFile[],
    message: string
  ): Promise<boolean> {
    const { uploadFile } = await import('./gitee')
    let successCount = 0
    // The public uploader owns the shared repository lock, including its
    // empty-file Git transport. Never hold a second outer repository lock.
    for (const file of files) {
      try {
        if (await uploadFile({
          file: file.content, path: file.path, repo, sha: file.sha, message,
          guarded: true, beforeWrite: file.beforeWrite,
        })) successCount += 1
      } catch {
        console.error(`[Gitee] 上传文件 ${file.path} 失败`)
      }
    }
    return successCount > 0
  }

  /**
   * GitLab 批量提交（使用 commit with actions）
   */
  async _gitlabBatchCommit(
    repo: string,
    files: FolderUploadFile[],
    message: string
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
    const configuredBranch = (await store.get<string>('gitlabBranch') || '').trim()
    const gitlabProjectId = await store.get<string>(`gitlab_${repo}_project_id`)
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined
    if (!gitlabAccessToken || !gitlabProjectId) return false
    const apiBaseUrl = await getGitlabApiBaseUrl()
    const baseUrl = `${apiBaseUrl}/projects/${encodeURIComponent(gitlabProjectId)}`
    const headers = new Headers({ 'PRIVATE-TOKEN': gitlabAccessToken, 'Content-Type': 'application/json;charset=iso-8859-1' })
    const capturedFiles = files.map(file => ({ ...file }))
    type Version = { sha: string; lastCommitId: string } | null
    const oid = (value: unknown): string => {
      if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) throw new Error('Invalid GitLab batch object version')
      return value.toLowerCase()
    }
    return await withGitRepoWriteLock(apiBaseUrl, gitlabProjectId, async () => {
      const read = (resource: string) => fetchRemoteRead(`${baseUrl}${resource}`, { headers: new Headers(headers), proxy })
      const project = remoteRecord(await readDirectoryResponse(await read('')))
      const branch = configuredBranch || (typeof project.default_branch === 'string' ? project.default_branch.trim() : '') || 'main'
      const reference = `/repository/branches/${encodeURIComponent(branch)}`
      const readHead = async (allowEmpty: boolean): Promise<string | null> => {
        const response = await read(reference)
        if (response.status === 404 && allowEmpty) {
          // A readable project and an empty branch list can establish the first
          // create, never the disappearance of a previously observed branch.
          await readDirectoryResponse(await read(''))
          const branches = await readDirectoryResponse(await read('/repository/branches?per_page=1'))
          if (Array.isArray(branches) && !branches.length) return null
        }
        const value = remoteRecord(await readDirectoryResponse(response))
        return oid(remoteRecord(value.commit).id)
      }
      const initialHead = await readHead(true)
      const initiallyEmpty = initialHead === null
      const readVersions = async (head: string | null): Promise<Version[]> => {
        if (head === null) return capturedFiles.map(() => null)
        const versions: Version[] = []
        for (const file of capturedFiles) {
          // Keep non-ASCII metadata headers compatible with Tauri while every
          // HEAD in one observation reads the same immutable commit.
          const metadata = await recoverRemoteRead(() => encodeFetch(
            `${baseUrl}/repository/files/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(head)}`,
            { method: 'HEAD', headers: new Headers(headers), proxy, connectTimeout: 10_000, maxRedirections: 0 }))
          if (metadata.status === 404) { versions.push(null); continue }
          if (!metadata.ok) throw new Error(`GitLab batch metadata request failed: HTTP ${metadata.status}`)
          versions.push({ sha: oid(metadata.headers.get('x-gitlab-blob-id')),
            lastCommitId: oid(metadata.headers.get('x-gitlab-last-commit-id')) })
        }
        return versions
      }
      const original = await readVersions(initialHead)
      const desired: string[] = []
      for (let index = 0; index < capturedFiles.length; index++) {
        const file = capturedFiles[index]
        if (file.sha && original[index]?.sha !== file.sha.toLowerCase()) throw new Error('SYNC_SWITCH_STALE')
        desired.push(await gitBlobVersion(new TextEncoder().encode(file.content), original[index]?.sha.length))
      }
      const body = JSON.stringify({ branch, commit_message: message,
        actions: capturedFiles.map((file, index) => {
          const expected = original[index]
          return { action: expected ? 'update' : 'create', file_path: file.path, content: file.content,
            ...(expected ? { last_commit_id: expected.lastCommitId } : {}) }
        }) })
      const beforeWrite = async () => { for (const file of capturedFiles) await file.beforeWrite?.() }
      const response = await recoverRemoteMutation({ beforeWrite,
        send: () => fetch(`${baseUrl}/repository/commits`, { method: 'POST', headers: new Headers(headers), body, proxy }),
        reconcile: async () => {
          const current = await readVersions(await readHead(initiallyEmpty))
          if (current.every((version, index) => version?.sha === desired[index])) {
            return { state: 'applied', value: new Response(null, { status: 200 }) }
          }
          if (current.every((version, index) => {
            const expected = original[index]
            return expected === null ? version === null
              : version?.sha === expected.sha && version.lastCommitId === expected.lastCommitId
          })) {
            return { state: 'unchanged' }
          }
          throw new Error('SYNC_SWITCH_STALE')
        },
      })
      return response.ok
    })
  }

  /** Upload files through the public Gitea writer's repository lock. */
  async _giteaBatchCommit(
    repo: string,
    files: FolderUploadFile[]
  ): Promise<boolean> {
    const { uploadFile } = await import('./gitea')
    const remoteFiles = await this._getGiteaFiles(repo)
    for (const file of files) if (remoteFiles[file.path]) file.sha = remoteFiles[file.path].sha
    let successCount = 0
    const uploadedPaths = new Set<string>()
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const fileName = file.path.split('/').pop() || file.path
      try {
        const uploaded = await uploadFile({
          file: file.content, path: file.path, repo, sha: file.sha,
          message: file.sha ? `Update ${fileName}` : `Create ${fileName}`,
          guarded: true, beforeWrite: file.beforeWrite,
        })
        if (!uploaded) continue
      } catch {
        console.error(`[Gitea] 上传文件 ${file.path} 失败`)
        continue
      }
      successCount += 1
      uploadedPaths.add(file.path)
      if (index < files.length - 1) {
        const remaining = await this._getGiteaFiles(repo)
        for (const other of files.slice(index + 1)) {
          if (!uploadedPaths.has(other.path) && remaining[other.path]) other.sha = remaining[other.path].sha
        }
      }
    }
    return successCount > 0
  }

  /**
   * S3 批量上传
   */
  async _s3BatchUpload(
    files: Array<{ path: string; content: string }>
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const s3Config = await store.get<S3Config>('s3SyncConfig')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!s3Config || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.region || !s3Config.bucket) {
      console.error('[S3] 缺少配置')
      return false
    }

    // 使用并发上传
    const uploadPromises = files.map(async (file) => {
      const result = await s3Upload(s3Config, file.path, file.content, proxy)
      if (!result) {
        console.error(`[S3] 上传文件 ${file.path} 失败`)
      }
      return !!result
    })

    const results = await Promise.all(uploadPromises)
    const successCount = results.filter(r => r).length

    return successCount > 0
  }

  /**
   * WebDAV 批量上传
   */
  async _webdavBatchUpload(
    files: Array<{ path: string; content: string }>
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!webdavConfig || !webdavConfig.url || !webdavConfig.username || !webdavConfig.password) {
      console.error('[WebDAV] 缺少配置')
      return false
    }

    // 使用并发上传
    const uploadPromises = files.map(async (file) => {
      const result = await webdavUpload(webdavConfig, file.path, file.content, proxy)
      if (!result) {
        console.error(`[WebDAV] 上传文件 ${file.path} 失败`)
      }
      return !!result
    })

    const results = await Promise.all(uploadPromises)
    const successCount = results.filter(r => r).length

    return successCount > 0
  }
}

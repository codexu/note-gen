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
import { S3Config, WebDAVConfig } from '@/types/sync'
import { buildGithubTreeEntries, buildGitlabCommitActions } from './folder-sync-payload'

export interface FolderSyncResult {
  success: boolean
  totalFiles: number
  successCount: number
  failedCount: number
  message: string
  errors?: string[]
}

type GitProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

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
      const filesToUpload: Array<{ path: string; content: string; sha?: string }> = []

      for (const file of markdownFiles) {
        const pathOptions = await getFilePathOptions(file.path)
        let content = ''

        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        // 相对路径作为远程路径
        const remotePath = file.path

        filesToUpload.push({
          path: remotePath,
          content
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
    files: Array<{ path: string; content: string; sha?: string }>,
    message: string
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const accessToken = await store.get<string>('accessToken')
    const githubUsername = await store.get<string>('githubUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    // 构建 tree
    // 注意：GitHub API 不允许同时提供 sha 和 content
    // 只提供 content，让 GitHub 自动处理（新文件创建 blob，已存在文件也会创建新的 blob）
    const tree = buildGithubTreeEntries(files)

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${accessToken}`)
    headers.append('Accept', 'application/vnd.github+json')
    headers.append('X-GitHub-Api-Version', '2022-11-28')
    headers.append('Content-Type', 'application/json')

    // 1. 创建 tree
    const createTreeUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/trees`
    const treeResponse = await fetch(createTreeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tree }),
      proxy,
    })

    if (!treeResponse.ok) {
      console.error('创建 tree 失败:', await treeResponse.text())
      return false
    }

    const treeData = await treeResponse.json()

    // 2. 获取当前 commit SHA
    const refUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/ref/heads/main`
    const refResponse = await fetch(refUrl, { method: 'GET', headers, proxy })
    if (!refResponse.ok) return false
    const refData = await refResponse.json()
    const parentCommitSha = refData.object.sha

    // 3. 创建 commit
    const commitUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/commits`
    const commitResponse = await fetch(commitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [parentCommitSha],
      }),
      proxy,
    })

    if (!commitResponse.ok) {
      console.error('创建 commit 失败:', await commitResponse.text())
      return false
    }

    const commitData = await commitResponse.json()

    // 4. 更新 ref
    const updateRefUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/refs/heads/main`
    const updateResponse = await fetch(updateRefUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sha: commitData.sha,
        force: true,
      }),
      proxy,
    })

    return updateResponse.ok
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
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/contents${path ? '/' + path : ''}?access_token=${giteeAccessToken}`
    const response = await fetch(url, { method: 'GET', headers, proxy })

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

    // 对路径进行编码处理，与 getFiles 保持一致
    const encodedPath = path.replace(/\s/g, '_').split('/').map(encodeURIComponent).join('/')
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
   * 注意：Gitee API 不支持真正的批量操作，这里使用并发上传
   */
  async _giteeBatchCommit(
    repo: string,
    files: Array<{ path: string; content: string; sha?: string }>,
    message: string
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const giteeAccessToken = await store.get<string>('giteeAccessToken')
    const giteeUsername = await store.get<string>('giteeUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!giteeAccessToken || !giteeUsername) {
      console.error('[Gitee] 缺少 accessToken 或 username')
      return false
    }

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${giteeAccessToken}`)
    headers.append('Content-Type', 'application/json')

    // Gitee API: 使用单个文件操作，每个文件一次请求
    // 使用并发上传提高速度

    const uploadPromises = files.map(async (file) => {
      const base64Content = Buffer.from(file.content).toString('base64')
      const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/contents/${file.path}`

      const body: Record<string, unknown> = {
        access_token: giteeAccessToken,
        content: base64Content,
        message: message
      }

      // 如果有 SHA（文件已存在），使用 PUT 方法覆盖
      if (file.sha) {
        body.sha = file.sha
      }

      const response = await fetch(url, {
        method: file.sha ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(body),
        proxy
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[Gitee] 上传文件 ${file.path} 失败:`, errorText)
      }

      return response.ok
    })

    const results = await Promise.all(uploadPromises)
    const successCount = results.filter(r => r).length

    // 只要有一个文件成功就算成功
    return successCount > 0
  }

  /**
   * GitLab 批量提交（使用 commit with actions）
   */
  async _gitlabBatchCommit(
    repo: string,
    files: Array<{ path: string; content: string; sha?: string }>,
    message: string
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
    const gitlabUrl = await store.get<string>('gitlabUrl') || 'https://gitlab.com'
    const gitlabBranch = await store.get<string>('gitlabBranch') || 'main'
    const gitlabProjectId = await store.get<string>(`gitlab_${repo}_project_id`)
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!gitlabAccessToken) {
      console.error('[GitLab] 缺少 accessToken')
      return false
    }

    if (!gitlabProjectId) {
      console.error('[GitLab] 缺少 projectId')
      return false
    }

    const headers = new Headers()
    headers.append('PRIVATE-TOKEN', gitlabAccessToken)
    headers.append('Content-Type', 'application/json;charset=iso-8859-1')

    // 构建 actions 数组
    const actions = buildGitlabCommitActions(files)

    const url = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(gitlabProjectId)}/repository/commits`

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branch: gitlabBranch,
        commit_message: message,
        actions
      }),
      proxy
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[GitLab] 批量提交失败:', errorText)
      return false
    }

    return true
  }

  /**
   * Gitea 批量提交（使用单个文件上传 + 并发）
   * Gitea API 不支持批量 commit，需要逐个上传文件
   */
  async _giteaBatchCommit(
    repo: string,
    files: Array<{ path: string; content: string; sha?: string }>
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const giteaAccessToken = await store.get<string>('giteaAccessToken')
    const giteaUsername = await store.get<string>('giteaUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    let giteaUrl: string
    try {
      giteaUrl = await getGiteaApiBaseUrl()
    } catch (error) {
      console.error('[Gitea] 获取 API URL 失败:', error)
      return false
    }

    if (!giteaAccessToken || !giteaUsername) {
      console.error('[Gitea] 缺少配置: accessToken 或 username')
      return false
    }

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${giteaAccessToken}`)
    headers.append('Content-Type', 'application/json')

    const apiBaseUrl = giteaUrl.endsWith('/') ? giteaUrl.slice(0, -1) : giteaUrl

    // 先获取远程文件 SHA（用于覆盖）
    const remoteFiles = await this._getGiteaFiles(repo)

    // 为每个文件设置 SHA
    for (const file of files) {
      if (remoteFiles[file.path]) {
        file.sha = remoteFiles[file.path].sha
      }
    }

    // 使用顺序上传（避免并发导致分支锁定冲突）
    let successCount = 0
    const uploadedPaths = new Set<string>()

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const base64Content = Buffer.from(file.content).toString('base64')

      // 分离路径和文件名
      const lastSlashIndex = file.path.lastIndexOf('/')
      const dirPath = lastSlashIndex > 0 ? file.path.substring(0, lastSlashIndex) : ''
      const fileName = lastSlashIndex > 0 ? file.path.substring(lastSlashIndex + 1) : file.path

      // 编码路径
      const normalizedPath = dirPath
        ? `${dirPath.split('/').map(p => encodeURIComponent(p.replace(/\s/g, '_'))).join('/')}/${fileName.replace(/\s/g, '_')}`
        : fileName.replace(/\s/g, '_')

      const url = `${apiBaseUrl}/repos/${giteaUsername}/${repo}/contents/${normalizedPath}`

      const requestBody: Record<string, unknown> = {
        branch: 'main',
        content: base64Content,
        message: file.sha ? `Update ${fileName}` : `Create ${fileName}`
      }

      // 如果有 SHA，使用 PUT 覆盖
      if (file.sha) {
        requestBody.sha = file.sha
      }

      const response = await fetch(url, {
        method: file.sha ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(requestBody),
        proxy
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[Gitea] 上传文件 ${file.path} 失败:`, response.status, errorText)
        // 继续上传下一个文件
        continue
      }

      successCount++
      uploadedPaths.add(file.path)

      // 重新获取剩余文件的 SHA（因为分支已更新）
      if (i < files.length - 1) {
        const newRemoteFiles = await this._getGiteaFiles(repo)
        // 更新后续文件中尚未上传的文件的 SHA
        for (let j = i + 1; j < files.length; j++) {
          const otherFile = files[j]
          if (!uploadedPaths.has(otherFile.path) && newRemoteFiles[otherFile.path]) {
            otherFile.sha = newRemoteFiles[otherFile.path].sha
          }
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

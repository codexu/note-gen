import { Store } from '@tauri-apps/plugin-store'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { collectMarkdownFiles } from '@/lib/files'
import { RepoNames } from './github.types'

export interface FolderSyncResult {
  success: boolean
  totalFiles: number
  successCount: number
  failedCount: number
  message: string
  errors?: string[]
}

export class FolderSync {
  private platform: string = 'github'

  constructor() {
    this.init()
  }

  private async init() {
    const store = await Store.load('store.json')
    this.platform = await store.get<string>('primaryBackupMethod') || 'github'
  }

  async syncFolder(localFolderPath: string): Promise<FolderSyncResult> {
    // TODO: 实现
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
    const tree = files.map((file) => ({
      path: file.path,
      mode: '100644',
      type: 'blob',
      content: Buffer.from(file.content).toString('base64'),
      sha: file.sha, // 如果有 SHA 则带上，用于覆盖
    }))

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

      // 如果有 SHA（文件已存在），带上用于覆盖
      if (file.sha) {
        body.sha = file.sha
      }

      const response = await fetch(url, {
        method: 'POST',
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

    console.log(`[Gitee] 上传完成: 成功 ${successCount}/${files.length}`)

    // 只要有一个文件成功就算成功
    return successCount > 0
  }
}

import { fetch, type Proxy } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import { GITLAB_INSTANCES, GitlabInstanceType } from './gitlab.types'
import { GITEA_INSTANCES, GiteaInstanceType } from './gitea.types'
import { remoteRecord } from './directory-listing'
import { decodeBase64ToBytes, encodeRemoteFileContent, readSyncResponseJson } from './remote-file'
import { gitBlobVersion } from './remote-content-cache'
import { getOptionalSyncRepoName } from './repo-utils'
import { moveGiteePath } from './gitee-path-move'
import { withGitRepoWriteLock } from './git-repo-write-lock'
import { fetchRemoteRead, isRemoteConnectionError, RemoteMutationTransportError } from './remote-mutation-recovery'

export type GitMoveProvider = 'gitee' | 'gitlab' | 'gitea'
interface PathEntry {
  sha: string
  type: 'blob' | 'tree'
  mode: '100644' | '100755' | '040000'
}
interface MoveFile {
  /** Relative to the moved root; empty for a single file. */
  path: string
  sha: string
  mode: '100644' | '100755'
  lastCommitId?: string
}
export interface GitPlatformPathSnapshot {
  provider: GitMoveProvider
  branch: string
  root: PathEntry
  files: MoveFile[]
}
interface GitPlatformPathMoveResult {
  status: 'moved' | 'missing'
  files?: Array<{ path: string; version: string }>
}
class GitPathCommitError extends Error {
  constructor(message: string, readonly canCheckHead: boolean) {
    super(message)
    this.name = 'GitPathCommitError'
  }
}
interface MoveOptions {
  expected?: GitPlatformPathSnapshot
  rememberSource: (snapshot: GitPlatformPathSnapshot) => Promise<void>
  assertCurrent: () => Promise<boolean>
}
interface PlatformConfig {
  api: string
  username: string
  repo: string
  projectId: string
  token: string
  configuredBranch: string
  proxy?: Proxy
}
interface TreeEntry { path: string; sha: string; type: string; mode: string }
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i
const names = { gitee: 'Gitee', gitlab: 'GitLab', gitea: 'Gitea' }

function validPath(path: string): boolean {
  return Boolean(path) && !path.includes('\\') && !/^[a-z]:/i.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..')
}
function validEntry(value: unknown): value is PathEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  return typeof entry.sha === 'string' && SHA.test(entry.sha)
    && ((entry.type === 'tree' && entry.mode === '040000')
      || (entry.type === 'blob' && ['100644', '100755'].includes(String(entry.mode))))
}
export function isGitPlatformPathSnapshot(value: unknown): value is GitPlatformPathSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (!['gitee', 'gitlab', 'gitea'].includes(String(item.provider))
    || typeof item.branch !== 'string' || !item.branch || !validEntry(item.root)
    || !Array.isArray(item.files) || item.files.length === 0) return false
  const seen = new Set<string>()
  for (const value of item.files) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const file = value as Record<string, unknown>
    if (typeof file.path !== 'string' || (file.path !== '' && !validPath(file.path))
      || seen.has(file.path) || typeof file.sha !== 'string' || !SHA.test(file.sha)
      || !['100644', '100755'].includes(String(file.mode))
      || (item.provider === 'gitlab' && (typeof file.lastCommitId !== 'string' || !SHA.test(file.lastCommitId)))
      || (file.lastCommitId !== undefined && (typeof file.lastCommitId !== 'string' || !SHA.test(file.lastCommitId)))) return false
    seen.add(file.path)
  }
  if (item.root.type === 'tree') return !seen.has('')
  const only = item.files[0] as Record<string, unknown>
  return item.files.length === 1 && seen.has('') && only.sha === item.root.sha && only.mode === item.root.mode
}

async function config(provider: GitMoveProvider): Promise<PlatformConfig | null> {
  const store = await Store.load('store.json')
  const [username, repo, token, proxyUrl] = await Promise.all([
    store.get<string>(`${provider}Username`), getOptionalSyncRepoName(provider),
    store.get<string>(`${provider}AccessToken`), store.get<string>('proxy'),
  ])
  if (!username || !repo) return null
  let api = 'https://gitee.com/api/v5'
  let projectId = ''
  if (provider === 'gitlab') {
    const instance = await store.get<GitlabInstanceType>('gitlabInstanceType') || GitlabInstanceType.OFFICIAL
    let origin = instance === GitlabInstanceType.SELF_HOSTED
      ? (await store.get<string>('gitlabCustomUrl') || '').trim().replace(/\/+$/, '')
      : GITLAB_INSTANCES[instance]?.baseUrl
    if (!origin) return null
    if (!/^https?:\/\//.test(origin)) origin = `https://${origin}`
    api = `${origin}/api/v4`
    projectId = String(await store.get<string | number>(`gitlab_${repo}_project_id`) || '')
    if (!projectId) return null
  } else if (provider === 'gitea') {
    const instance = await store.get<GiteaInstanceType>('giteaInstanceType') || GiteaInstanceType.OFFICIAL
    let origin = instance === GiteaInstanceType.SELF_HOSTED
      ? (await store.get<string>('giteaCustomUrl') || '').trim().replace(/\/+$/, '')
      : GITEA_INSTANCES[instance]?.baseUrl
    if (!origin) return null
    if (!/^https?:\/\//.test(origin)) origin = `http://${origin}`
    api = `${origin}/api/v1`
  }
  const configuredBranch = (await store.get<string>(`${provider}Branch`) || '').trim()
  return { api, username, repo, projectId, token: token || '', configuredBranch, proxy: proxyUrl ? { all: proxyUrl } : undefined }
}

/** Contains no credentials; a journal must not follow a different server/account. */
export async function getGitPlatformMoveIdentity(provider: GitMoveProvider): Promise<string | null> {
  const captured = await config(provider)
  return captured ? JSON.stringify([captured.api, captured.username, captured.repo, captured.projectId, captured.configuredBranch]) : null
}

/** Rename existing remote bytes in one atomic remote operation per platform. */
export async function moveGitPlatformPath(
  provider: GitMoveProvider, source: string, target: string,
  { expected, rememberSource, assertCurrent }: MoveOptions,
): Promise<GitPlatformPathMoveResult> {
  const failure = (stage: string, detail: string) => new Error(
    `${names[provider]} 路径迁移失败（${source} → ${target}，${stage}）：${detail}`,
  )
  if (!validPath(source) || !validPath(target) || source === target
    || source.startsWith(`${target}/`) || target.startsWith(`${source}/`)
    || (expected !== undefined && (!isGitPlatformPathSnapshot(expected) || expected.provider !== provider))) {
    throw failure('校验记录', '路径或持久迁移快照无效')
  }
  const current = async () => {
    if (!await assertCurrent()) throw failure('校验上下文', '工作区、平台或迁移状态已变化，记录已保留')
  }
  const captured = await config(provider)
  await current()
  if (!captured?.token) throw failure('读取配置', '同步未配置完整')
  if (provider === 'gitee') return moveGiteePath({
    source, target, ...captured, expected, rememberSource, assertCurrent,
  })
  return withGitRepoWriteLock(captured.api, provider === 'gitlab' ? captured.projectId : `${captured.username}/${captured.repo}`, async (): Promise<GitPlatformPathMoveResult> => {
    const { api, username, repo, projectId, token, proxy } = captured
    const base = provider === 'gitlab' ? `${api}/projects/${encodeURIComponent(projectId)}`
      : `${api}/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (provider === 'gitlab') headers['PRIVATE-TOKEN'] = token
    else headers.Authorization = `token ${token}`
    const request = async (resource: string, stage: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      try {
        let response: Response
        try {
          response = method === 'GET'
            ? await fetchRemoteRead(`${base}${resource}`, { headers, proxy, signal: controller.signal })
            : await fetch(`${base}${resource}`, {
              method, headers: new Headers(headers), proxy, signal: controller.signal, maxRedirections: 0,
              body: body === undefined ? undefined : JSON.stringify(body),
            })
        } catch (error) {
          const message = failure(stage, '网络请求失败或超时，迁移记录已保留').message
          if (method === 'POST' && stage === '提交远端改名'
            && (controller.signal.aborted || isRemoteConnectionError(error))) throw new RemoteMutationTransportError(message)
          throw new Error(message)
        }
        if (!response.ok) {
          const message = failure(stage, `请求被拒绝（HTTP ${response.status}），迁移记录已保留`).message
          if (method === 'POST' && stage === '提交远端改名') {
            let reason = ''
            try {
              const data: unknown = await readSyncResponseJson(response, `${provider} / path move rejection`)
              if (data && typeof data === 'object') reason = JSON.stringify(data)
              else if (typeof data === 'string') reason = data
            } catch { /* The status and a later immutable snapshot are still usable. */ }
            const denied = /hook|protect|permission|authentic|authoriz|forbidden|not allowed|access denied|read.only/i.test(reason)
            const refConflict = /non.fast.forward|(?:branch|commit|reference|ref).*(?:changed|conflict|lock|updated)|failed to (?:push|update).*ref|not.*latest/i.test(reason)
            throw new GitPathCommitError(message, !denied && ([409, 422].includes(response.status) || refConflict))
          }
          throw new Error(message)
        }
        try { return await readSyncResponseJson(response, `${provider} / path move / ${stage}`) }
        catch { throw failure(stage, '响应格式无效，迁移记录已保留') }
      } finally { clearTimeout(timeout) }
    }
    const object = (value: unknown): Record<string, unknown> => {
      try { return remoteRecord(value) }
      catch { throw failure('校验快照', '远端对象格式无效') }
    }
    const sha = (value: unknown): string => {
      if (typeof value !== 'string' || !SHA.test(value)) throw failure('校验快照', 'Git 对象版本无效')
      return value.toLowerCase()
    }
    const metadata = object(await request('', '读取仓库'))
    if (metadata.empty === true || metadata.empty_repo === true) {
      if (expected) throw failure('读取仓库', '仓库已清空，无法确认先前迁移结果')
      return { status: 'missing' }
    }
    if (typeof metadata.default_branch !== 'string' || !metadata.default_branch) {
      const branches = await request('/branches', '确认空仓库')
      if (Array.isArray(branches) && branches.length === 0 && !expected) return { status: 'missing' }
      throw failure('读取默认分支', '没有有效默认分支')
    }
    const branch = captured.configuredBranch || metadata.default_branch
    if (expected && expected.branch !== branch) throw failure('校验默认分支', '默认分支已变化，原迁移记录已保留')
    const encodedBranch = encodeURIComponent(branch)
    const branchResource = provider === 'gitlab' ? `/repository/branches/${encodedBranch}` : `/branches/${encodedBranch}`
    const readHead = async (): Promise<string> => {
      const data = object(await request(branchResource, '读取分支版本'))
      return sha(object(data.commit).id ?? object(data.commit).sha)
    }

    interface SnapshotReader {
      find: (path: string) => Promise<TreeEntry | null>
      files: (path: string, entry: TreeEntry) => Promise<MoveFile[]>
      head: string
    }
    const reader = async (): Promise<SnapshotReader> => {
      const head = await readHead()
      const cache = new Map<string, Promise<TreeEntry[]>>()
      let rootSha = head
      if (provider === 'gitea') {
        const commit = object(await request(`/git/commits/${head}`, '读取提交快照'))
        if (sha(commit.sha) !== head) throw failure('读取提交快照', '提交版本不一致')
        rootSha = sha(object(commit.tree).sha)
      }
      const directory = (pathOrSha: string): Promise<TreeEntry[]> => {
        const existing = cache.get(pathOrSha)
        if (existing) return existing
        const pending = (async () => {
          const entries: TreeEntry[] = []
          const seen = new Set<string>()
          let page = 1
          while (true) {
            const query = new URLSearchParams({ ref: head, path: pathOrSha, per_page: '100', page: String(page) })
            const resource = provider === 'gitlab' ? `/repository/tree?${query}`
              : `/git/trees/${encodeURIComponent(pathOrSha)}?page=${page}&per_page=100`
            const value = await request(resource, '读取完整目录快照')
            const data = provider === 'gitlab' ? null : object(value)
            const list = provider === 'gitlab' ? value : data?.tree
            if (!Array.isArray(list) || data?.truncated === true) throw failure('读取目录快照', '目录列表被截断或格式无效')
            for (const item of list) {
              const entry = object(item)
              const path = entry.path
              const localName = provider === 'gitlab' && typeof path === 'string' ? path.split('/').pop() : path
              const normalized = { sha: sha(entry.sha ?? entry.id), type: entry.type, mode: entry.mode }
              if (typeof localName !== 'string' || !localName || localName.includes('/')
                || localName === '.' || localName === '..' || seen.has(localName)
                || typeof normalized.type !== 'string' || typeof normalized.mode !== 'string') {
                throw failure('读取目录快照', '包含重复或无效目录条目')
              }
              seen.add(localName)
              entries.push({ sha: normalized.sha, type: normalized.type, mode: normalized.mode, path: localName })
            }
            if (provider === 'gitea') {
              if (typeof data?.total_count !== 'number' || !Number.isSafeInteger(data.total_count)
                || data.total_count < entries.length) throw failure('读取目录快照', '目录条目总数无效')
              if (entries.length === data.total_count) break
              if (list.length === 0) throw failure('读取目录快照', '目录列表缺页')
            } else if (list.length < 100) break
            page += 1
          }
          return entries
        })()
        cache.set(pathOrSha, pending)
        return pending
      }
      const find = async (path: string): Promise<TreeEntry | null> => {
        let tree = provider === 'gitlab' ? '' : rootSha
        let parent = ''
        const parts = path.split('/')
        for (let index = 0; index < parts.length; index += 1) {
          const entries = await directory(tree)
          const entry = entries.find(item => item.path === parts[index])
          if (!entry) return null
          if (index === parts.length - 1) return entry
          if (entry.type !== 'tree') throw failure('校验父目录', '父路径是文件，迁移记录已保留')
          parent = parent ? `${parent}/${entry.path}` : entry.path
          tree = provider === 'gitlab' ? parent : entry.sha
        }
        return null
      }
      const files = async (path: string, entry: TreeEntry): Promise<MoveFile[]> => {
        if (entry.type === 'blob') return [{ path: '', sha: entry.sha, mode: entry.mode as MoveFile['mode'] }]
        const collected: MoveFile[] = []
        const visit = async (directoryPath: string, treeSha: string, relative: string) => {
          for (const child of await directory(provider === 'gitlab' ? directoryPath : treeSha)) {
            const childPath = relative ? `${relative}/${child.path}` : child.path
            if (child.type === 'tree') await visit(`${directoryPath}/${child.path}`, child.sha, childPath)
            else {
              if (!validEntry(child)) throw failure('读取源目录', '源目录包含链接、子模块或不支持的文件类型，原文件已保留')
              collected.push({ path: childPath, sha: child.sha, mode: child.mode as MoveFile['mode'] })
            }
          }
        }
        await visit(path, entry.sha, '')
        return collected.sort((a, b) => a.path.localeCompare(b.path))
      }
      return { find, files, head }
    }
    const join = (root: string, relative: string) => relative ? `${root}/${relative}` : root
    const equalEntry = (a: TreeEntry, b: PathEntry) => a.sha === b.sha && a.mode === b.mode && a.type === b.type
    const sameFiles = (actual: MoveFile[], wanted: MoveFile[]) => actual.length === wanted.length
      && actual.every(file => wanted.some(item => item.path === file.path && item.sha === file.sha && item.mode === file.mode))
    let snapshot = expected
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      let view = await reader()
      const sourceEntry = await view.find(source)
      const targetEntry = await view.find(target)
      await current()
      if (!snapshot) {
        if (!sourceEntry) {
          if (targetEntry) throw failure('校验目标路径', '源路径不存在但目标已存在，无法确认迁移结果')
          return { status: 'missing' }
        }
        if (targetEntry) throw failure('校验目标路径', '远端目标已存在，原有内容已保留')
        if (!validEntry(sourceEntry)) throw failure('读取源路径', '源路径是链接、子模块或不支持的文件类型，原文件已保留')
        const files = await view.files(source, sourceEntry)
        if (files.length === 0) throw failure('读取源目录', '源目录没有可迁移普通文件')
        if (provider === 'gitlab') {
          for (const file of files) {
            const data = object(await request(`/repository/files/${encodeURIComponent(join(source, file.path))}?ref=${view.head}`, '读取文件版本'))
            if (sha(data.blob_id) !== file.sha) throw failure('读取文件版本', '文件版本与目录快照不一致')
            file.lastCommitId = sha(data.last_commit_id)
          }
        }
        snapshot = { provider, branch, root: { sha: sourceEntry.sha, type: sourceEntry.type, mode: sourceEntry.mode }, files }
        await rememberSource(snapshot)
        await current()
      }
      const frozen = snapshot
      if (!sourceEntry && targetEntry && equalEntry(targetEntry, frozen.root)) {
        return { status: 'moved', files: await versions(view, frozen) }
      }
      if (!sourceEntry || !equalEntry(sourceEntry, frozen.root)) throw failure('校验源路径', '远端源内容已变化，迁移记录已保留')
      if (targetEntry) throw failure('校验目标路径', '远端目标已存在，原有内容已保留')
      if (!sameFiles(await view.files(source, sourceEntry), frozen.files)) throw failure('校验源目录', '源目录清单与持久快照不一致')
      if (provider === 'gitlab' && (expected !== undefined || attempt > 0)) {
        for (const file of frozen.files) {
          const data = object(await request(`/repository/files/${encodeURIComponent(join(source, file.path))}?ref=${view.head}`, '校验原始文件提交'))
          if (sha(data.blob_id) !== file.sha || sha(data.last_commit_id) !== file.lastCommitId) {
            throw failure('校验原始文件提交', '源文件最后提交已变化，未接受新的源版本')
          }
        }
      }
      try {
        if (provider === 'gitlab') {
          await current()
          const result = object(await request('/repository/commits', '提交远端改名', 'POST', {
            branch, commit_message: `Move ${source} to ${target}`, force: false,
            actions: frozen.files.map(file => ({
              action: 'move', file_path: join(target, file.path), previous_path: join(source, file.path),
              last_commit_id: file.lastCommitId,
            })),
          }))
          sha(result.id)
        } else {
          const files: Array<Record<string, unknown>> = []
          for (const file of frozen.files) files.push({
            operation: 'update', from_path: join(source, file.path), path: join(target, file.path),
            sha: file.sha, content: await blob(file.sha),
          })
          // Older Gitea versions support from_path with update; the byte snapshot is
          // fetched by immutable blob SHA and checked, never from the local editor.
          await current()
          await request('/contents', '提交远端改名', 'POST', { branch, message: `Move ${source} to ${target}`, files })
        }
      } catch (error) {
        if (error instanceof RemoteMutationTransportError) {
          await current()
          const repository = object(await request('', '确认断线后的分支'))
          if ((captured.configuredBranch || repository.default_branch) !== frozen.branch) {
            throw failure('校验默认分支', '默认分支已变化，迁移记录已保留')
          }
          const observed = await reader()
          const oldSource = await observed.find(source)
          const newTarget = await observed.find(target)
          if (!oldSource && newTarget && equalEntry(newTarget, frozen.root)
            && sameFiles(await observed.files(target, newTarget), frozen.files)) {
            return { status: 'moved', files: await versions(observed, frozen) }
          }
          if (attempt < 2) continue // The next pass rechecks every original version.
          throw error
        }
        if (error instanceof GitPathCommitError && error.canCheckHead && attempt < 2) {
          await current()
          const latestHead = await readHead()
          if (latestHead !== view.head) {
            const repository = object(await request('', '确认重试分支'))
            if ((captured.configuredBranch || repository.default_branch) !== frozen.branch) {
              throw failure('校验重试分支', '默认分支已变化，迁移记录已保留')
            }
            continue
          }
        }
        throw error
      }

      await current()
      view = await reader()
      if (await view.find(source)) throw failure('校验最终路径', '旧路径仍有文件，迁移记录已保留')
      const finalEntry = await view.find(target)
      if (!finalEntry || !equalEntry(finalEntry, frozen.root)
        || !sameFiles(await view.files(target, finalEntry), frozen.files)) {
        throw failure('校验迁移结果', '目标与原始快照不一致，迁移记录已保留')
      }
      return { status: 'moved', files: await versions(view, frozen) }
    }
    throw failure('提交远端改名', '已达到安全重试次数，迁移记录已保留')

    async function blob(version: string): Promise<string> {
      const data = object(await request(`/git/blobs/${version}`, '读取不可变正文'))
      if (sha(data.sha) !== version || typeof data.content !== 'string'
        || (data.encoding !== undefined && data.encoding !== 'base64')) throw failure('读取不可变正文', '远端正文格式或版本无效')
      let bytes: Uint8Array
      try { bytes = decodeBase64ToBytes(data.content) }
      catch { throw failure('校验正文', 'Base64 正文无效') }
      if (await gitBlobVersion(bytes, version.length) !== version) throw failure('校验正文', '远端正文不匹配 Git 对象版本')
      return encodeRemoteFileContent(bytes)
    }
    async function versions(latest: SnapshotReader, identity: GitPlatformPathSnapshot) {
      const files: Array<{ path: string; version: string }> = []
      for (const file of identity.files) {
        const path = join(target, file.path)
        if (provider === 'gitlab') {
          const data = object(await request(`/repository/files/${encodeURIComponent(path)}?ref=${latest.head}`, '读取改名后版本'))
          if (sha(data.blob_id) !== file.sha) throw failure('读取改名后版本', '目标内容发生变化')
        }
        files.push({ path, version: file.sha })
      }
      await current()
      return files
    }
  })
}

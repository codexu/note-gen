import { fetch, type Proxy } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import { remoteRecord } from './directory-listing'
import { readSyncResponseJson } from './remote-file'
import { getSyncRepoName } from './repo-utils'
import { withGithubRepoWriteLock } from './github-repo-write-lock'
import { fetchRemoteRead, isRemoteConnectionError, recoverRemoteMutation, RemoteMutationTransportError } from './remote-mutation-recovery'

export interface GitPathEntry {
  sha: string
  type: 'blob' | 'tree'
  mode: '100644' | '100755' | '040000'
}

interface MoveGithubPathResult {
  status: 'moved' | 'missing'
  entry?: GitPathEntry
}

interface MoveGithubPathOptions {
  source: string
  target: string
  expected?: GitPathEntry
  /** Persist the immutable source identity before any remote mutation. */
  rememberSource: (entry: GitPathEntry) => Promise<void>
  /** Check the captured workspace/repository and the pending local move. */
  assertCurrent: () => Promise<boolean>
}

interface GitTreeEntry {
  path: string
  mode: string
  type: string
  sha: string
}

const SHA_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i

class GithubRefUpdateError extends Error {
  constructor(message: string, readonly canCheckConcurrentUpdate: boolean) {
    super(message)
    this.name = 'GithubRefUpdateError'
  }
}

function validPath(path: string): boolean {
  return Boolean(path) && !path.includes('\\') && !/^[a-z]:/i.test(path)
    && path.split('/').every(part => part && !part.startsWith('.'))
}

/** Move immutable remote bytes. Serialize local repository writers and retry a
 * competing external commit only while the original source identity is intact. */
export async function moveGithubPath({
  source, target, expected, rememberSource, assertCurrent,
}: MoveGithubPathOptions): Promise<MoveGithubPathResult> {
  const failure = (stage: string, detail: string) => new Error(
    `GitHub 路径迁移失败（${source} → ${target}，${stage}）：${detail}`,
  )
  if (!validPath(source) || !validPath(target) || source === target
    || source.startsWith(`${target}/`) || target.startsWith(`${source}/`)) {
    throw failure('校验迁移记录', '路径无效或互相包含，远端文件未迁移')
  }
  const current = async (): Promise<void> => {
    if (!await assertCurrent()) throw failure('校验迁移上下文', '工作区或迁移状态已变化，迁移记录已保留')
  }
  const pathEntry = (entry: GitTreeEntry | GitPathEntry): GitPathEntry => {
    if (SHA_PATTERN.test(entry.sha)) {
      if (entry.type === 'tree' && entry.mode === '040000') {
        return { sha: entry.sha.toLowerCase(), type: 'tree', mode: '040000' }
      }
      if (entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755')) {
        return { sha: entry.sha.toLowerCase(), type: 'blob', mode: entry.mode }
      }
    }
    throw failure('校验文件类型', '源路径不是普通文件或目录，远端文件未迁移')
  }
  let captured = expected === undefined ? undefined : pathEntry(expected)
  const matches = (entry: GitTreeEntry, identity: GitPathEntry): boolean => entry.sha === identity.sha
    && entry.type === identity.type && entry.mode === identity.mode
  const store = await Store.load('store.json')
  // All requests in this operation use the same credentials and destination.
  const [token, owner, repo, proxyUrl] = await Promise.all([
    store.get<string>('accessToken'),
    store.get<string>('githubUsername'),
    getSyncRepoName('github'),
    store.get<string>('proxy'),
  ])
  await current()
  if (!token || !owner || !repo) throw failure('读取配置', 'GitHub 同步未配置')
  const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
  const repositoryIsEmpty = async (): Promise<boolean> => {
    const controller = new AbortController()
    const requestTimeout = setTimeout(() => controller.abort(), 15_000)
    try {
      let response: Response
      try {
        response = await fetchRemoteRead(`${baseUrl}/branches?per_page=1`, {
          method: 'GET', headers, proxy, signal: controller.signal,
        })
      } catch {
        throw failure('确认空仓库', '网络请求失败或超时，迁移记录已保留')
      }
      if (!response.ok) throw failure('确认空仓库', `请求被拒绝（HTTP ${response.status}）`)
      let branches: unknown
      try { branches = await readSyncResponseJson(response, `github / ${source} / branches`) }
      catch { throw failure('确认空仓库', '响应格式无效或读取超时，迁移记录已保留') }
      if (!Array.isArray(branches)) throw failure('确认空仓库', '分支列表格式无效，迁移记录已保留')
      return branches.length === 0
    } finally {
      clearTimeout(requestTimeout)
    }
  }

  const request = async (
    resource: string,
    stage: string,
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const controller = new AbortController()
    const requestTimeout = setTimeout(() => controller.abort(), 15_000)
    try {
      let response: Response
      try {
        const send = () => fetch(`${baseUrl}${resource}`, {
          method, headers: new Headers(headers), proxy, signal: controller.signal,
          maxRedirections: 0, body: body === undefined ? undefined : JSON.stringify(body),
        })
        response = method === 'GET'
          ? await fetchRemoteRead(`${baseUrl}${resource}`, {
            headers: { ...headers, 'Cache-Control': 'no-cache' }, proxy, signal: controller.signal,
          })
          : method === 'POST'
            // Creating unreachable immutable objects cannot advance a branch.
            ? await recoverRemoteMutation({ send, reconcile: async () => ({ state: 'unchanged' }), beforeWrite: current })
            : await send()
      } catch (error) {
        // Native transport errors may include proxy credentials. Keep only our
        // own source/stage context; neither tokens nor raw response bodies escape.
        const message = failure(stage, '网络请求失败或超时，迁移记录已保留').message
        if (method === 'PATCH' && (controller.signal.aborted || isRemoteConnectionError(error))) {
          throw new RemoteMutationTransportError(message)
        }
        throw new Error(message)
      }
      if (!response.ok) {
        if (method === 'GET' && resource.startsWith('/git/ref/')
          && [404, 409].includes(response.status) && await repositoryIsEmpty()) return { empty: true }
        if (method === 'PATCH' && [401, 403, 409, 412, 422, 429].includes(response.status)) {
          let reason = ''
          try {
            const rejection = remoteRecord(await readSyncResponseJson(response, `github / ${source} / ${stage}`))
            const messages: string[] = typeof rejection.message === 'string' ? [rejection.message] : []
            if (Array.isArray(rejection.errors)) {
              for (const item of rejection.errors as unknown[]) {
                if (typeof item === 'string') messages.push(item)
                else if (item && typeof item === 'object' && 'message' in item && typeof item.message === 'string') {
                  messages.push(item.message)
                }
              }
            }
            reason = messages.join(' ').toLowerCase()
          } catch { /* Preserve the HTTP error even if its body is unreadable. */ }
          const protectedBranch = /protected branch|branch protection|repository rule|rule violation|signed commit|required status check|pull request|gh006|gh013/.test(reason)
          const limited = /rate limit|abuse|spam/.test(reason) || response.status === 429
          const permission = /permission|not permitted|not allowed|resource not accessible|workflow scope|refusing to allow|bad credentials/.test(reason)
            || response.status === 401 || (response.status === 403 && !limited && !protectedBranch)
          const concurrent = /not a fast.?forward|reference update failed|reference has changed/.test(reason)
          const detail = protectedBranch ? '远端分支保护或仓库规则拒绝更新'
            : limited ? 'GitHub 请求受到频率限制，请稍后重试'
              : permission ? 'GitHub 令牌权限不足，无法更新远端分支'
                : concurrent ? '远端分支被其他同步更新，迁移待办已保留'
                  : 'GitHub 拒绝更新分支引用，迁移待办已保留'
          throw new GithubRefUpdateError(failure(stage, `${detail}（HTTP ${response.status}）`).message,
            [409, 412, 422].includes(response.status) && !protectedBranch && !permission && !limited)
        }
        throw failure(stage, `请求被拒绝（HTTP ${response.status}），迁移记录已保留`)
      }
      try {
        return remoteRecord(await readSyncResponseJson(response, `github / ${source} / ${stage}`))
      } catch {
        throw failure(stage, '响应格式无效或读取超时，迁移记录已保留')
      }
    } finally {
      clearTimeout(requestTimeout)
    }
  }
  const readSha = (value: unknown, stage: string): string => {
    if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
      throw failure(stage, 'Git 对象版本无效，已保留旧文件')
    }
    return value.toLowerCase()
  }
  const readObject = (value: unknown, stage: string): Record<string, unknown> => {
    try { return remoteRecord(value) }
    catch { throw failure(stage, 'Git 对象格式无效，已保留旧文件') }
  }

  return withGithubRepoWriteLock(owner, repo, async (): Promise<MoveGithubPathResult> => {
    await current()
    const repository = await request('', '读取默认分支')
    if (typeof repository.default_branch !== 'string' || !repository.default_branch) {
      if (await repositoryIsEmpty()) {
        await current()
        if (captured) throw failure('校验迁移结果', '已记录迁移快照的远端分支不存在，迁移记录已保留')
        return { status: 'missing' }
      }
      throw failure('读取默认分支', '仓库没有有效默认分支，已保留旧文件')
    }
    const branch = repository.default_branch
    const reference = `refs/heads/${branch}`
    const refResource = `/git/refs/heads/${encodeURIComponent(branch)}`
    const attemptMove = async (attempt: number, verifyOnly = false): Promise<MoveGithubPathResult> => {
      const head = await request(`/git/ref/heads/${encodeURIComponent(branch)}`, '读取分支版本')
      if (head.empty === true) {
        await current()
        if (captured) throw failure('校验迁移结果', '已记录迁移快照的远端分支不存在，迁移记录已保留')
        return { status: 'missing' }
      }
      const headObject = readObject(head.object, '读取分支版本')
      if (head.ref !== reference || headObject.type !== 'commit') {
        throw failure('读取分支版本', '默认分支未指向提交，已保留旧文件')
      }
      const parent = readSha(headObject.sha, '读取分支版本')
      const commit = await request(`/git/commits/${parent}`, '读取提交快照')
      if (readSha(commit.sha, '读取提交快照') !== parent) {
        throw failure('读取提交快照', '提交版本不一致，已保留旧文件')
      }
      const baseTree = readSha(readObject(commit.tree, '读取提交快照').sha, '读取提交快照')
      const trees = new Map<string, Promise<GitTreeEntry[]>>()
      const readTree = (treeSha: string): Promise<GitTreeEntry[]> => {
        const cached = trees.get(treeSha)
        if (cached) return cached
        const pending = (async () => {
          // Read each immutable directory separately: never accept a truncated
          // recursive tree as evidence that a file is missing.
          const data = await request(`/git/trees/${treeSha}`, '读取目录快照')
          if (readSha(data.sha, '读取目录快照') !== treeSha
            || data.truncated !== false || !Array.isArray(data.tree)) {
            throw failure('读取目录快照', '目录快照不完整，已保留旧文件')
          }
          const seen = new Set<string>()
          return data.tree.map((value: unknown) => {
            const entry = readObject(value, '读取目录快照')
            if (typeof entry.path !== 'string' || !entry.path || entry.path.includes('/')
              || entry.path === '.' || entry.path === '..' || seen.has(entry.path)
              || typeof entry.mode !== 'string' || typeof entry.type !== 'string') {
              throw failure('读取目录快照', '目录条目无效，已保留旧文件')
            }
            seen.add(entry.path)
            return {
              path: entry.path, mode: entry.mode, type: entry.type,
              sha: readSha(entry.sha, '读取目录快照'),
            }
          })
        })()
        trees.set(treeSha, pending)
        return pending
      }
      const findEntry = async (path: string): Promise<GitTreeEntry | null> => {
        let treeSha = baseTree
        const segments = path.split('/')
        for (let depth = 0; depth < segments.length; depth += 1) {
          const entries = await readTree(treeSha)
          const entry = entries.find(candidate => candidate.path === segments[depth])
          if (!entry) return null
          if (depth === segments.length - 1) return entry
          if (entry.type !== 'tree' || entry.mode !== '040000') {
            throw failure('校验父目录', `路径经过非目录对象，已保留旧文件：${path}`)
          }
          treeSha = entry.sha
        }
        return null
      }

      const sourceEntry = await findEntry(source)
      const targetEntry = await findEntry(target)
      await current()
      if (!sourceEntry) {
        // A lost ref-update response is recoverable only from the identity saved
        // before that write. An arbitrary existing target never proves completion.
        if (targetEntry && captured && matches(targetEntry, captured)) {
          return { status: 'moved', entry: captured }
        }
        if (targetEntry) throw failure('校验目标路径', '源路径不存在但目标已存在，无法确认先前迁移结果')
        if (captured) throw failure('校验迁移结果', '已记录的远端源和目标均不存在，无法确认迁移结果')
        return { status: 'missing' }
      }
      const entry = pathEntry(sourceEntry)
      if (captured && !matches(sourceEntry, captured)) {
        throw failure('校验源路径', '远端源文件或目录在上次尝试后发生变化，迁移记录已保留')
      }
      if (targetEntry) throw failure('校验目标路径', '远端目标路径已存在，原有内容已保留')
      if (verifyOnly) throw failure('确认迁移结果', '已达到安全重试次数，迁移记录已保留')
      await rememberSource(entry)
      // Keep the first identity across retries, including a first attempt without
      // a pre-existing journal snapshot. Unrelated commits may change; these bytes may not.
      captured = entry
      await current()
      const newTree = await request('/git/trees', '创建迁移目录', 'POST', {
        base_tree: baseTree,
        tree: [
          { path: target, mode: entry.mode, type: entry.type, sha: entry.sha },
          { path: source, mode: entry.mode, type: entry.type, sha: null },
        ],
      })
      const newTreeSha = readSha(newTree.sha, '创建迁移目录')
      await current()
      const newCommit = await request('/git/commits', '创建迁移提交', 'POST', {
        message: `Move ${source} to ${target}`,
        tree: newTreeSha,
        parents: [parent],
      })
      const newCommitSha = readSha(newCommit.sha, '创建迁移提交')
      // If a competing writer advanced the branch, this commit is not a descendant
      // of its new head. GitHub rejects the non-fast-forward update atomically.
      await current()
      const latestRepository = await request('', '校验默认分支')
      if (latestRepository.default_branch !== branch) throw failure('校验默认分支', '默认分支已变化，迁移记录已保留')
      let updated: Record<string, unknown>
      try {
        updated = await request(refResource, '应用迁移提交', 'PATCH', {
          sha: newCommitSha, force: false,
        })
      } catch (error) {
        if (error instanceof RemoteMutationTransportError) {
          await current()
          const repository = await request('', '确认断线后的默认分支')
          if (repository.default_branch !== branch) throw failure('校验默认分支', '默认分支已变化，迁移记录已保留')
          // Re-read the immutable tree even after the final failed PATCH.
          // Source absence plus the saved target identity confirms completion.
          return attemptMove(attempt + 1, attempt >= 2)
        }
        if (error instanceof GithubRefUpdateError && error.canCheckConcurrentUpdate && attempt < 2) {
          await current()
          const latestHead = await request(`/git/ref/heads/${encodeURIComponent(branch)}`, '确认分支并发更新')
          if (latestHead.ref === reference) {
            const latestObject = readObject(latestHead.object, '确认分支并发更新')
            if (latestObject.type === 'commit' && readSha(latestObject.sha, '确认分支并发更新') !== parent) {
              // Re-read the new immutable tree and verify source/target again.
              // An unchanged head means rejection, not a reason to retry blindly.
              return attemptMove(attempt + 1)
            }
          }
        }
        throw error
      }
      const updatedObject = readObject(updated.object, '应用迁移提交')
      if (updated.ref !== reference || updatedObject.type !== 'commit'
        || readSha(updatedObject.sha, '应用迁移提交') !== newCommitSha) {
        throw failure('应用迁移提交', '无法确认分支更新结果，迁移记录已保留')
      }
      return { status: 'moved', entry }
    }
    return attemptMove(0)
  })
}

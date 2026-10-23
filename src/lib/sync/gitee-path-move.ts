import { fetch, type Proxy } from '@tauri-apps/plugin-http'
import { remoteRecord } from './directory-listing'
import { readSyncResponseJson } from './remote-file'
import { withGitRepoWriteLock } from './git-repo-write-lock'
import { isSyncStaleError } from './sync-stale-error'
import { fetchRemoteRead, isRemoteConnectionError, RemoteMutationTransportError } from './remote-mutation-recovery'
import {
  assertReceivePackStatus, createGitObject, encodeGitPack, encodeGitTree,
  encodeReceivePackRequest, parseReceivePackAdvertisement, type GitObject, type GitTreeEntry,
} from './git-http'
import type { GitPlatformPathSnapshot } from './git-platform-path-move'

interface Options {
  source: string
  target: string
  username: string
  repo: string
  token: string
  configuredBranch: string
  proxy?: Proxy
  expected?: GitPlatformPathSnapshot
  rememberSource: (snapshot: GitPlatformPathSnapshot) => Promise<void>
  assertCurrent: () => Promise<boolean>
}
const oidPattern = /^[a-f0-9]{40}$/

/** Reuse the smart HTTP transport already used for Gitee's empty-file uploads.
 * Moving an existing blob/tree only creates ancestor trees and one commit; the
 * receive-pack old ref is a compare-and-swap over the entire remote operation. */
export async function moveGiteePath(options: Options): Promise<{
  status: 'moved' | 'missing'; files?: Array<{ path: string; version: string }>
}> {
  return withGitRepoWriteLock('https://gitee.com/api/v5', `${options.username}/${options.repo}`,
    () => performGiteePathMove(options))
}

async function performGiteePathMove(options: Options, attempt = 0, verifyOnly = false): Promise<{
  status: 'moved' | 'missing'; files?: Array<{ path: string; version: string }>
}> {
  const { source, target, username, repo, token, configuredBranch, proxy, expected, rememberSource, assertCurrent } = options
  const failure = (stage: string, detail: string) => new Error(`Gitee 路径迁移失败（${source} → ${target}，${stage}）：${detail}`)
  const current = async () => {
    if (!await assertCurrent()) throw failure('校验上下文', '工作区、平台或迁移状态已变化，记录已保留')
  }
  const repositoryPath = `${encodeURIComponent(username)}/${encodeURIComponent(repo)}`
  const apiBase = 'https://gitee.com/api/v5'
  const resourceBase = `/repos/${repositoryPath}`
  const gitBase = `https://gitee.com/${repositoryPath}.git`
  const authorization = `Basic ${Buffer.from(`${username}:${token}`, 'utf-8').toString('base64')}`
  const readApiValue = async (resource: string): Promise<unknown> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      let response: Response
      try {
        response = await fetchRemoteRead(`${apiBase}${resource}`, {
          headers: { Authorization: `Bearer ${token}` }, proxy, signal: controller.signal, maxRedirections: 0,
        })
      } catch { throw failure('读取远端快照', '网络请求失败或超时，迁移记录已保留') }
      if (!response.ok) throw failure('读取远端快照', `请求被拒绝（HTTP ${response.status}），记录已保留`)
      try { return await readSyncResponseJson(response, `gitee / ${source} / path move`) }
      catch { throw failure('读取远端快照', '响应格式无效，记录已保留') }
    } finally { clearTimeout(timeout) }
  }
  const readApi = async (resource: string) => remoteRecord(await readApiValue(resource))
  const bytes = async (response: Response): Promise<Uint8Array> => {
    const limit = 32 * 1024 * 1024
    if (Number(response.headers.get('content-length')) > limit) throw failure('读取 Git 响应', '响应体过大')
    const reader = response.body?.getReader()
    if (!reader) throw failure('读取 Git 响应', '响应没有正文')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.length
        if (length > limit) {
          await reader.cancel()
          throw failure('读取 Git 响应', '响应体过大')
        }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    const result = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
    return result
  }
  const gitRequest = async (resource: string, body?: Uint8Array): Promise<Uint8Array> => {
    const type = body ? 'application/x-git-receive-pack-result' : 'application/x-git-receive-pack-advertisement'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      let response: Response
      try {
        const requestHeaders: Record<string, string> = { Authorization: authorization, Accept: type }
        if (body) requestHeaders['Content-Type'] = 'application/x-git-receive-pack-request'
        const requestOptions = {
          proxy, maxRedirections: 0, signal: controller.signal,
          headers: requestHeaders,
        }
        response = body
          ? await fetch(`${gitBase}${resource}`, { ...requestOptions, method: 'POST', body: Uint8Array.from(body).buffer })
          : await fetchRemoteRead(`${gitBase}${resource}`, requestOptions)
      } catch (error) {
        const message = failure('提交 Git 改名', '网络请求失败或超时，结果待确认，迁移记录已保留').message
        if (body && (controller.signal.aborted || isRemoteConnectionError(error))) throw new RemoteMutationTransportError(message)
        throw new Error(message)
      }
      if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== type) {
        throw failure('读取 Git 响应', `服务端拒绝 Git 协议请求（HTTP ${response.status}），记录已保留`)
      }
      try { return await bytes(response) }
      catch (error) {
        if (body && (controller.signal.aborted || isRemoteConnectionError(error))) {
          throw new RemoteMutationTransportError(failure('读取 Git 响应', '响应中断，结果待确认，迁移记录已保留').message)
        }
        throw error
      }
    } finally { clearTimeout(timeout) }
  }
  const oid = (value: unknown): string => {
    if (typeof value !== 'string' || !oidPattern.test(value)) throw failure('校验 Git 对象', '对象版本无效')
    return value
  }
  const repository = await readApi(resourceBase)
  let advertisement
  try { advertisement = parseReceivePackAdvertisement(await gitRequest('/info/refs?service=git-receive-pack')) }
  catch { throw failure('读取 Git 分支', 'Git 分支响应无效或读取失败，记录已保留') }
  if (typeof repository.default_branch !== 'string' || !repository.default_branch) {
    if (!expected && advertisement.refs.size === 0) {
      const branches = await readApiValue(`${resourceBase}/branches`)
      if (Array.isArray(branches) && branches.length === 0) {
        await current()
        return { status: 'missing' }
      }
    }
    throw failure('读取默认分支', '仓库没有有效默认分支，记录已保留')
  }
  const defaultBranch = repository.default_branch
  const branch = configuredBranch || defaultBranch
  if (expected && expected.branch !== branch) throw failure('校验默认分支', '默认分支已变化，记录已保留')
  const ref = `refs/heads/${branch}`
  if (!advertisement.capabilities.has('report-status')) throw failure('读取 Git 分支', '服务器不支持确认提交结果')
  const head = advertisement.refs.get(ref)
  if (!head) {
    if (advertisement.refs.size === 0 && !expected) return { status: 'missing' }
    throw failure('读取 Git 分支', '远端分支不存在，记录已保留')
  }
  const commit = await readApi(`${resourceBase}/commits/${oid(head)}`)
  if (commit.sha !== head) throw failure('读取提交快照', '提交版本不一致')
  let root = oid(remoteRecord(remoteRecord(commit.commit).tree).sha)
  const trees = new Map<string, GitTreeEntry[]>()
  const readTree = async (sha: string): Promise<GitTreeEntry[]> => {
    const cached = trees.get(sha)
    if (cached) return cached
    const data = await readApi(`${resourceBase}/git/trees/${sha}`)
    if (data.truncated !== false || !Array.isArray(data.tree)) throw failure('读取目录快照', '目录快照不完整')
    const entries = data.tree.map(value => {
      const entry = remoteRecord(value)
      if (typeof entry.path !== 'string' || typeof entry.mode !== 'string') throw failure('读取目录快照', '目录条目无效')
      const mode = entry.mode.replace(/^0+/, '')
      const type = mode === '40000' ? 'tree' : mode === '160000' ? 'commit' : 'blob'
      if (entry.type !== type) throw failure('读取目录快照', '文件模式与类型不一致')
      return { name: entry.path, oid: oid(entry.sha), mode }
    })
    // Gitee sometimes echoes the requested commit in tree.sha. Reconstruct the
    // actual immutable Git tree instead of trusting that response field.
    let actual: string
    try { actual = (await createGitObject('tree', encodeGitTree(entries))).oid }
    catch { throw failure('校验目录快照', '目录条目或模式无效') }
    if (actual !== sha) throw failure('校验目录快照', '目录内容与 Git 版本不一致')
    trees.set(sha, entries)
    return entries
  }
  const find = async (path: string): Promise<GitTreeEntry | null> => {
    let tree = root
    const segments = path.split('/')
    for (let depth = 0; depth < segments.length; depth += 1) {
      const entry = (await readTree(tree)).find(candidate => candidate.name === segments[depth])
      if (!entry) return null
      if (depth === segments.length - 1) return entry
      if (entry.mode !== '40000') throw failure('校验父目录', '父路径不是目录')
      tree = entry.oid
    }
    return null
  }
  const sourceEntry = await find(source)
  const targetEntry = await find(target)
  const matches = (entry: GitTreeEntry, identity: GitPlatformPathSnapshot['root']) => entry.oid === identity.sha
    && (entry.mode === '40000' ? '040000' : entry.mode) === identity.mode
  const fileList = async (entry: GitTreeEntry): Promise<GitPlatformPathSnapshot['files']> => {
    const files: GitPlatformPathSnapshot['files'] = []
    const collect = async (child: GitTreeEntry, path: string): Promise<void> => {
      if (child.mode === '40000') {
        for (const nested of await readTree(child.oid)) await collect(nested, path ? `${path}/${nested.name}` : nested.name)
      } else if (child.mode === '100644' || child.mode === '100755') files.push({ path, sha: child.oid, mode: child.mode })
      // Linked entries and submodules remain untouched inside the moved tree.
    }
    await collect(entry, '')
    return files
  }
  const verifyFiles = async (entry: GitTreeEntry, identity: GitPlatformPathSnapshot): Promise<void> => {
    const files = await fileList(entry)
    if (files.length !== identity.files.length || files.some(file => !identity.files.some(saved =>
      saved.path === file.path && saved.sha === file.sha && saved.mode === file.mode))) {
      throw failure('校验迁移清单', '持久文件清单与不可变目录快照不一致，记录已保留')
    }
  }
  await current()
  if (!sourceEntry) {
    if (targetEntry && expected && matches(targetEntry, expected.root)) {
      await verifyFiles(targetEntry, expected)
      await current()
      return { status: 'moved', files: expected.files.map(file => ({ path: file.path ? `${target}/${file.path}` : target, version: file.sha })) }
    }
    if (!targetEntry && !expected) return { status: 'missing' }
    throw failure('校验迁移结果', '源路径缺失且目标不能确认属于先前迁移，记录已保留')
  }
  if (!['40000', '100644', '100755'].includes(sourceEntry.mode)) throw failure('校验源路径', '源路径不是普通文件或目录')
  if (targetEntry) throw failure('校验目标路径', '远端目标已存在，原有内容已保留')
  if (expected && !matches(sourceEntry, expected.root)) throw failure('校验源版本', '远端源内容已变化，记录已保留')
  if (expected) await verifyFiles(sourceEntry, expected)
  if (verifyOnly) throw failure('确认迁移结果', '已达到安全重试次数，迁移记录已保留')
  let snapshot = expected
  if (!snapshot) {
    const files = await fileList(sourceEntry)
    if (files.length === 0) throw failure('读取源目录', '源目录没有可迁移普通文件')
    snapshot = { provider: 'gitee', branch, root: {
      sha: sourceEntry.oid, type: sourceEntry.mode === '40000' ? 'tree' : 'blob',
      mode: sourceEntry.mode === '40000' ? '040000' : sourceEntry.mode as '100644' | '100755',
    }, files }
    await rememberSource(snapshot)
  }
  const objects = new Map<string, GitObject>()
  const patchTree = async (tree: string | undefined, parts: string[], replacement: GitTreeEntry | null, top = true): Promise<string | undefined> => {
    const entries = tree ? [...await readTree(tree)] : []
    const name = parts[0]
    const index = entries.findIndex(entry => entry.name === name)
    if (parts.length === 1) {
      if (index >= 0) entries.splice(index, 1)
      if (replacement) entries.push({ ...replacement, name })
    } else {
      const existing = index >= 0 ? entries[index] : undefined
      if (existing && existing.mode !== '40000') throw failure('生成目录', '父路径不是目录')
      const child = await patchTree(existing?.oid, parts.slice(1), replacement, false)
      if (index >= 0) entries.splice(index, 1)
      if (child) entries.push({ name, mode: '40000', oid: child })
    }
    if (!entries.length && !top) return undefined
    const object = await createGitObject('tree', encodeGitTree(entries))
    objects.set(object.oid, object)
    trees.set(object.oid, entries)
    return object.oid
  }
  root = (await patchTree(root, source.split('/'), null))!
  root = (await patchTree(root, target.split('/'), sourceEntry))!
  const user = await readApi('/user')
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0
    || typeof user.login !== 'string' || !user.login || /[\s<>@\0]/.test(user.login)) throw failure('读取提交身份', '用户身份无效')
  const name = (typeof user.name === 'string' ? user.name : user.login).replace(/[<>\r\n\0]/g, '').trim() || user.login
  const author = `${name} <${user.id}+${user.login}@user.noreply.gitee.com>`
  const timestamp = Math.floor(Date.now() / 1000)
  const newCommit = await createGitObject('commit', new TextEncoder().encode([
    `tree ${root}`, `parent ${head}`, `author ${author} ${timestamp} +0000`, `committer ${author} ${timestamp} +0000`,
    '', `Move ${source} to ${target}`, '',
  ].join('\n')))
  objects.set(newCommit.oid, newCommit)
  const pack = await encodeGitPack([...objects.values()])
  const request = encodeReceivePackRequest(head, newCommit.oid, ref, pack, advertisement.capabilities)
  if ((await readApi(resourceBase)).default_branch !== defaultBranch) throw failure('校验默认分支', '默认分支已变化，记录已保留')
  await current()
  let report: Uint8Array
  try { report = await gitRequest('/git-receive-pack', request) }
  catch (error) {
    if (!(error instanceof RemoteMutationTransportError)) throw error
    await current()
    return performGiteePathMove({ ...options, expected: snapshot }, attempt + 1, attempt >= 2)
  }
  try { assertReceivePackStatus(report, ref, head, `${source} → ${target}`) }
  catch (error) {
    const reason = error instanceof Error ? error.message : ''
    const canCheckHead = isSyncStaleError(error) || ['failed to update ref', 'failed to update refs', 'failed to update ref(s)']
      .some(message => reason === `Git rejected ${ref}: ${message}`)
    let headChanged = false
    if (canCheckHead && attempt < 2) {
      try {
        const latest = parseReceivePackAdvertisement(await gitRequest('/info/refs?service=git-receive-pack'))
        headChanged = latest.refs.has(ref) && latest.refs.get(ref) !== head
      } catch { /* Preserve the original rejection if discovery fails. */ }
    }
    if (headChanged) {
      await current()
      // Stay inside the already-held repository lock. Freeze the first source
      // snapshot across retries; never adopt a new blob/tree or overwrite a target.
      return performGiteePathMove({ ...options, expected: snapshot }, attempt + 1)
    }
    throw failure('提交远端改名', 'Git 分支已变化或服务器拒绝提交，远端原文件和记录已保留')
  }
  await current()
  return { status: 'moved', files: snapshot.files.map(file => ({ path: file.path ? `${target}/${file.path}` : target, version: file.sha })) }
}

import { fetch, type Proxy } from '@tauri-apps/plugin-http'
import { remoteRecord } from './directory-listing'
import { fetchGiteeRead } from './gitee-request'
import { isSyncStaleError, syncStaleError, withSyncStaleContext } from './sync-stale-error'
import {
  assertReceivePackStatus, createGitObject, encodeGitPack, encodeGitTree,
  encodeReceivePackRequest, parseReceivePackAdvertisement, type GitObject,
} from './git-http'

const encoder = new TextEncoder()
const zeroOid = '0'.repeat(40)
const oidPattern = /^[a-f0-9]{40}$/
const uploads = new Map<string, Promise<void>>()

interface EmptyUploadOptions {
  username: string
  token: string
  repo: string
  path: string
  message: string
  expectedVersion: string | null
  proxy?: Proxy
}
interface TreeEntry { name: string; mode: string; oid: string; size?: number }
interface UploadResult { data: { content: { sha: string }; commit?: { sha: string } } }

function fileState(entry: TreeEntry) {
  return { sha: entry.oid, exists: true, ...(entry.size !== undefined ? { size: entry.size } : {}) }
}

function pathSegments(path: string) {
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..'
    || segment.toLowerCase() === '.git' || /[\0\r\n]/.test(segment))) {
    throw new Error('Invalid Gitee Git upload path')
  }
  return segments
}

async function responseBytes(response: Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Gitee Git response is too large')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Gitee Git response has no body')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) {
        await reader.cancel()
        throw new Error('Gitee Git response is too large')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

function defaultBranch(repository: Record<string, unknown>): string | null {
  if (repository.default_branch === null || repository.default_branch === undefined) return null
  if (typeof repository.default_branch !== 'string' || !repository.default_branch) {
    throw new Error('Gitee repository has no valid default branch')
  }
  return repository.default_branch
}

async function performEmptyUpload(
  options: EmptyUploadOptions, attempt = 0, originalRef?: { name: string; existed: boolean; oid?: string },
): Promise<UploadResult> {
  const { username, token, repo, path, message, expectedVersion, proxy } = options
  const segments = pathSegments(path)
  if (expectedVersion !== null && !oidPattern.test(expectedVersion)) throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
  if (!username || !token || !repo || /[\0\r\n:]/.test(username)) throw new Error('Gitee sync is not configured')
  const repositoryPath = `${encodeURIComponent(username)}/${encodeURIComponent(repo)}`
  const apiBase = 'https://gitee.com/api/v5'
  const repoResource = `/repos/${repositoryPath}`
  const gitBase = `https://gitee.com/${repositoryPath}.git`
  const authorization = `Basic ${Buffer.from(`${username}:${token}`, 'utf-8').toString('base64')}`
  const readApi = async (resource: string): Promise<unknown> => {
    const response = await fetchGiteeRead(`${apiBase}${resource}`, {
      headers: { Authorization: `Bearer ${token}` }, proxy,
    })
    if (!response.ok) throw new Error(`Gitee API request failed: HTTP ${response.status}`)
    const bytes = await responseBytes(response, 32 * 1024 * 1024)
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
    catch { throw new Error('Invalid Gitee API response while preparing the Git upload') }
  }
  const gitRequest = async (resource: string, body?: Uint8Array) => {
    let response: Response
    try {
      response = await fetch(`${gitBase}${resource}`, {
        method: body ? 'POST' : 'GET', proxy, maxRedirections: 0,
        headers: {
          Authorization: authorization,
          Accept: body ? 'application/x-git-receive-pack-result' : 'application/x-git-receive-pack-advertisement',
          ...(body ? { 'Content-Type': 'application/x-git-receive-pack-request' } : {}),
        },
        // Use an owned ArrayBuffer for the native HTTP bridge on every platform.
        ...(body ? { body: Uint8Array.from(body).buffer } : {}),
      })
    } catch {
      throw new Error(body
        ? 'Gitee Git upload result could not be confirmed. Rescan before retrying.'
        : 'Gitee Git connection failed')
    }
    if (!response.ok) throw new Error(`Gitee Git request failed: HTTP ${response.status}`)
    const expectedType = body ? 'application/x-git-receive-pack-result' : 'application/x-git-receive-pack-advertisement'
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== expectedType) {
      throw new Error('Gitee did not return a Git smart HTTP response')
    }
    return responseBytes(response, 16 * 1024 * 1024)
  }

  // Do not use the provider's cached/fallback branch name for a ref mutation.
  const repository = remoteRecord(await readApi(repoResource))
  const configuredBranch = defaultBranch(repository)
  const advertisement = parseReceivePackAdvertisement(await gitRequest('/info/refs?service=git-receive-pack'))
  if (!advertisement.capabilities.has('report-status')) throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
  const branch = configuredBranch || 'master'
  const ref = `refs/heads/${branch}`
  const refPath = `${path} / ${ref}`
  const treeContextPath = (directory: string) => `${path} / tree ${directory}`
  const head = advertisement.refs.get(ref)
  const refState = (oid: string | undefined) => ({
    exists: oid !== undefined,
    ...(oid !== undefined && oidPattern.test(oid) ? { sha: oid } : {}),
  })
  if (originalRef && originalRef.name !== ref) throw syncStaleError({
    stage: 'apply', path: `${path} / ${originalRef.name} → ${ref}`, source: 'remote', check: 'configuration',
    expected: { exists: originalRef.existed, ...(originalRef.oid ? { sha: originalRef.oid } : {}) },
    actual: refState(head),
  })
  if (originalRef?.existed && !head) throw syncStaleError({
    stage: 'apply', path: refPath, source: 'remote', check: 'gitRef',
    expected: { exists: true, ...(originalRef.oid ? { sha: originalRef.oid } : {}) }, actual: { exists: false },
  })
  if (!head) {
    // A missing default ref is not an empty repository. Prove both the API's
    // branch list and the Git advertisement are empty before creating a root.
    const branches = await readApi(`${repoResource}/branches`)
    if (!Array.isArray(branches)) throw syncStaleError({
      stage: 'apply', path: refPath, source: 'remote', check: 'inventory', expected: { exists: false },
    })
    if (branches.length || advertisement.refs.size) throw syncStaleError({
      stage: 'apply', path: refPath, source: 'remote', check: 'gitRef', expected: { exists: true }, actual: { exists: false },
    })
  } else if (!configuredBranch || !oidPattern.test(head)) throw syncStaleError({
    stage: 'apply', path: refPath, source: 'remote', check: configuredBranch ? 'gitRef' : 'configuration',
    expected: { exists: true }, actual: refState(head),
  })

  const readTree = async (oid: string, treePath: string): Promise<TreeEntry[]> => {
    const tree = remoteRecord(await readApi(`${repoResource}/git/trees/${oid}`))
    if (tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error('Gitee Git tree is incomplete')
    const entries = tree.tree.map((item: unknown): TreeEntry => {
      const entry = remoteRecord(item)
      if (typeof entry.path !== 'string' || !entry.path || entry.path.includes('/') || /[\0]/.test(entry.path)
        || typeof entry.sha !== 'string' || !oidPattern.test(entry.sha) || typeof entry.mode !== 'string') {
        throw new Error('Invalid Gitee Git tree entry')
      }
      const mode = entry.mode.replace(/^0+/, '')
      const type = mode === '40000' ? 'tree' : mode === '160000' ? 'commit' : 'blob'
      if (!['40000', '100644', '100755', '120000', '160000'].includes(mode) || entry.type !== type) {
        throw new Error('Invalid Gitee Git tree mode')
      }
      return {
        name: entry.path, mode, oid: entry.sha,
        ...(type === 'blob' && typeof entry.size === 'number' && Number.isSafeInteger(entry.size) && entry.size >= 0
          ? { size: entry.size } : {}),
      }
    })
    if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error('Repeated Gitee Git tree entry')
    // Gitee echoes the requested revision in tree.sha, including commit IDs.
    // Verify the reconstructed tree against its actual immutable tree ID.
    const actualOid = (await createGitObject('tree', encodeGitTree(entries))).oid
    if (actualOid !== oid) throw syncStaleError({
      stage: 'apply', path: treeContextPath(treePath), source: 'remote', check: 'gitTree',
      expected: { sha: oid, exists: true }, actual: { sha: actualOid, exists: true },
    })
    return entries
  }
  let entries: TreeEntry[] = []
  if (head) {
    const commit = remoteRecord(await readApi(`${repoResource}/commits/${head}`))
    const root = remoteRecord(remoteRecord(commit.commit).tree)
    if (commit.sha !== head) throw syncStaleError({
      stage: 'apply', path: refPath, source: 'remote', check: 'gitCommit', expected: { sha: head, exists: true },
      actual: { exists: true, ...(typeof commit.sha === 'string' && oidPattern.test(commit.sha) ? { sha: commit.sha } : {}) },
    })
    if (typeof root.sha !== 'string' || !oidPattern.test(root.sha)) throw syncStaleError({
      stage: 'apply', path: treeContextPath('/'), source: 'remote', check: 'gitTree', expected: { exists: true },
    })
    entries = await readTree(root.sha, '/')
  }
  const ancestors: Array<{ entries: TreeEntry[]; name: string }> = []
  for (const name of segments.slice(0, -1)) {
    const ancestorPath = [...ancestors.map(ancestor => ancestor.name), name].join('/')
    const child = entries.find(entry => entry.name === name)
    if (child && child.mode !== '40000') throw syncStaleError({
      stage: 'apply', path: `${path} / ${ancestorPath}`, source: 'remote', check: 'fileType',
      expected: { exists: true }, actual: fileState(child),
    })
    ancestors.push({ entries, name })
    entries = child ? await readTree(child.oid, ancestorPath) : []
  }
  const filename = segments[segments.length - 1]
  const existing = entries.find(entry => entry.name === filename)
  // Match the caller's original create-only/blob condition at the captured
  // branch tip. A retry must never replace this with a freshly accepted SHA.
  if (expectedVersion === null ? Boolean(existing) : existing?.oid !== expectedVersion) throw syncStaleError({
    stage: 'apply', path, source: 'remote', check: 'version',
    expected: { sha: expectedVersion, exists: expectedVersion !== null },
    actual: existing ? fileState(existing) : { exists: false },
  })
  if (existing && !['100644', '100755'].includes(existing.mode)) throw syncStaleError({
    stage: 'apply', path, source: 'remote', check: 'fileType',
    expected: { sha: expectedVersion, exists: true }, actual: fileState(existing),
  })
  const blob = await createGitObject('blob', new Uint8Array())
  if (existing?.oid === blob.oid) return { data: { content: { sha: blob.oid } } }

  const objects = new Map<string, GitObject>([[blob.oid, blob]])
  const replaceEntry = async (siblings: TreeEntry[], entry: TreeEntry) => {
    const content = encodeGitTree([...siblings.filter(sibling => sibling.name !== entry.name), entry])
    const tree = await createGitObject('tree', content)
    objects.set(tree.oid, tree)
    return tree.oid
  }
  let rootOid = await replaceEntry(entries, { name: filename, mode: existing?.mode || '100644', oid: blob.oid })
  for (const ancestor of ancestors.reverse()) {
    rootOid = await replaceEntry(ancestor.entries, { name: ancestor.name, mode: '40000', oid: rootOid })
  }

  const user = remoteRecord(await readApi('/user'))
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0
    || typeof user.login !== 'string' || !user.login || /[\s<>@\0]/.test(user.login)) {
    throw new Error('Invalid Gitee Git author')
  }
  const name = (typeof user.name === 'string' ? user.name : user.login).replace(/[<>\r\n\0]/g, '').trim() || user.login
  // Use Gitee's private commit address even when /user exposes a real email.
  const author = `${name} <${user.id}+${user.login}@user.noreply.gitee.com>`
  const timestamp = Math.floor(Date.now() / 1000)
  if (message.includes('\0')) throw new Error('Invalid Gitee Git commit message')
  const commit = await createGitObject('commit', encoder.encode([
    `tree ${rootOid}`, ...(head ? [`parent ${head}`] : []),
    `author ${author} ${timestamp} +0000`, `committer ${author} ${timestamp} +0000`,
    '', message, '',
  ].join('\n')))
  objects.set(commit.oid, commit)
  const pack = await encodeGitPack([...objects.values()])
  const request = encodeReceivePackRequest(head || zeroOid, commit.oid, ref, pack, advertisement.capabilities)
  if (defaultBranch(remoteRecord(await readApi(repoResource))) !== configuredBranch) throw syncStaleError({
    stage: 'apply', path: refPath, source: 'remote', check: 'configuration', expected: refState(head),
  })
  // HTTP success alone never confirms a push. A rejected ref can be rebuilt
  // against a newer tip only while retaining the original file condition.
  const report = await gitRequest('/git-receive-pack', request)
  try { assertReceivePackStatus(report, ref, head || zeroOid, refPath) }
  catch (error) {
    const reason = error instanceof Error ? error.message : ''
    let stale = isSyncStaleError(error)
    let staleError = error
    if (['failed to update ref', 'failed to update refs', 'failed to update ref(s)']
      .some(message => reason === `Git rejected ${ref}: ${message}`)) {
      // Git sometimes omits the old-value mismatch from report-status. Only
      // classify that generic rejection as a conflict when the ref did move.
      try {
        const current = parseReceivePackAdvertisement(await gitRequest('/info/refs?service=git-receive-pack'))
        const actualHead = current.refs.get(ref)
        stale = actualHead !== head
        if (stale) staleError = syncStaleError({
          stage: 'apply', path: refPath, source: 'remote', check: 'gitRef',
          expected: refState(head), actual: refState(actualHead),
        })
      } catch { /* Keep the original server rejection if discovery fails. */ }
    }
    if (stale) {
      // Our other uploads may advance the branch while leaving this file
      // untouched. Recheck every tree and the original SHA/create-only guard.
      if (attempt < 2) return performEmptyUpload(options, attempt + 1, originalRef || { name: ref, existed: Boolean(head), oid: head })
      throw withSyncStaleContext(staleError, {
        stage: 'apply', path: refPath, source: 'remote', check: 'gitRef', expected: refState(head),
      })
    }
    throw error
  }
  return { data: { content: { sha: blob.oid }, commit: { sha: commit.oid } } }
}

/** Serialize our own empty-file pushes; other writers remain protected by CAS. */
export async function uploadEmptyGiteeFile(options: EmptyUploadOptions): Promise<UploadResult> {
  const key = JSON.stringify([options.username, options.repo])
  const previous = uploads.get(key) || Promise.resolve()
  const result = previous.then(() => performEmptyUpload(options))
  const settled = result.then(() => {}, () => {})
  uploads.set(key, settled)
  try { return await result }
  finally { if (uploads.get(key) === settled) uploads.delete(key) }
}

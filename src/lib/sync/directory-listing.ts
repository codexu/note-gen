import { parseSyncJson } from './remote-file'

export interface RemoteDirectoryEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  sha: string
  size?: number
  modifiedAt?: string
}

export function remoteRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid remote directory response')
  }
  return value as Record<string, unknown>
}

function responseLocation(response: Response) {
  try {
    const url = new URL(response.url)
    return `${url.origin}${url.pathname}`
  } catch { return 'remote directory' }
}

async function readResponseJson(response: Response): Promise<unknown> {
  const context = `HTTP ${response.status}, ${responseLocation(response)}`
  return parseSyncJson<unknown>(await response.text(), context)
}

export async function readDirectoryResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Remote directory request failed: HTTP ${response.status} (${responseLocation(response)})`)
  return readResponseJson(response)
}

export function parseDirectoryEntries(data: unknown): RemoteDirectoryEntry[] {
  if (!Array.isArray(data)) throw new Error('Expected a remote directory listing')
  const seenPaths = new Set<string>()
  return data.map(value => {
    const entry = remoteRecord(value)
    const sha = entry.sha ?? entry.id
    if (typeof entry.name !== 'string' || typeof entry.path !== 'string'
      || typeof sha !== 'string' || typeof entry.type !== 'string') {
      throw new Error('Invalid remote directory entry')
    }
    if (!['file', 'dir', 'blob', 'tree', 'symlink', 'submodule', 'commit'].includes(entry.type)
      || seenPaths.has(entry.path)) {
      throw new Error('Invalid or repeated remote directory entry')
    }
    seenPaths.add(entry.path)
    return {
      name: entry.name,
      path: entry.path,
      type: entry.type === 'dir' || entry.type === 'tree' ? 'dir' : 'file',
      sha,
      size: typeof entry.size === 'number' ? entry.size : undefined,
    }
  })
}

// 逐层读取非递归 Git Tree，避免 Contents 的目录数量上限。
// 找不到子目录时，只有已成功读取的父树才能证明该目录确实不存在。
export async function readGitTreeDirectory(
  path: string,
  request: (resource: string) => Promise<Response>,
  cache?: Map<string, Promise<unknown>>,
  ref?: string,
): Promise<RemoteDirectoryEntry[]> {
  // A fresh cache belongs to one inventory walk, never to a later validation.
  // Parent trees and repository metadata are reused across sibling directories.
  const read = (resource: string, root = false): Promise<unknown> => {
    const existing = cache?.get(resource)
    if (existing) return existing
    const pending = (async () => {
      const response = await request(resource)
      if (root && response.status === 409) {
        const error = remoteRecord(await readResponseJson(response))
        if (typeof error.message === 'string' && /repository is empty/i.test(error.message)) return { tree: [] }
        throw new Error('Remote repository tree is unavailable')
      }
      return readDirectoryResponse(response)
    })()
    cache?.set(resource, pending)
    return pending
  }
  let treeSha = ref
  if (!treeSha) {
    const repository = remoteRecord(await read(''))
    if (repository.empty === true || repository.empty_repo === true) return []
    if (typeof repository.default_branch !== 'string' || !repository.default_branch) {
      // Gitee reports null for a new repository's default branch without an
      // explicit empty flag. Confirm it has no branches before treating it as empty.
      const branches = await read('/branches')
      if (Array.isArray(branches) && branches.length === 0) return []
      throw new Error('Remote repository has no default branch')
    }
    treeSha = repository.default_branch
  }
  const segments = path.split('/').filter(Boolean)
  for (let depth = 0; depth <= segments.length; depth += 1) {
    // A pinned ref must remain readable; its disappearance cannot prove that
    // a file was deleted successfully.
    const tree = remoteRecord(await read(`/git/trees/${encodeURIComponent(treeSha)}`, depth === 0 && !ref))
    if ((ref ? tree.truncated !== false : tree.truncated === true) || !Array.isArray(tree.tree)) {
      throw new Error('Remote directory listing is incomplete')
    }
    const seenNames = new Set<string>()
    const entries = tree.tree.map(value => {
      const entry = remoteRecord(value)
      if (typeof entry.path !== 'string' || entry.path.includes('/')
        || typeof entry.sha !== 'string' || typeof entry.type !== 'string'
        || (ref && (!entry.path || entry.path === '.' || entry.path === '..' || seenNames.has(entry.path)
          || !/^[a-f0-9]{40}$/i.test(entry.sha) || !['blob', 'tree', 'commit'].includes(entry.type)))) {
        throw new Error('Invalid Git tree entry')
      }
      seenNames.add(entry.path)
      return entry
    })
    if (depth === segments.length) {
      return parseDirectoryEntries(entries.map(entry => ({
        ...entry,
        name: entry.path,
        path: path ? `${path}/${entry.path}` : entry.path,
      })))
    }
    const directory = entries.find(entry => entry.path === segments[depth] && entry.type === 'tree')
    if (!directory) return []
    treeSha = directory.sha as string
  }
  return []
}

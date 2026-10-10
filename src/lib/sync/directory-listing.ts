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

export async function readDirectoryResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Remote directory request failed: ${response.status}`)
  return response.json()
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
): Promise<RemoteDirectoryEntry[]> {
  const repository = remoteRecord(await readDirectoryResponse(await request('')))
  if (typeof repository.default_branch !== 'string' || !repository.default_branch) {
    throw new Error('Remote repository has no default branch')
  }
  let treeSha = repository.default_branch
  const segments = path.split('/').filter(Boolean)
  for (let depth = 0; depth <= segments.length; depth += 1) {
    const tree = remoteRecord(await readDirectoryResponse(
      await request(`/git/trees/${encodeURIComponent(treeSha)}`),
    ))
    if (tree.truncated === true || !Array.isArray(tree.tree)) {
      throw new Error('Remote directory listing is incomplete')
    }
    const entries = tree.tree.map(value => {
      const entry = remoteRecord(value)
      if (typeof entry.path !== 'string' || entry.path.includes('/')
        || typeof entry.sha !== 'string' || typeof entry.type !== 'string') {
        throw new Error('Invalid Git tree entry')
      }
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

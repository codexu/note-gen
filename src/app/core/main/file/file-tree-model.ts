import type { DirTree } from '@/stores/article'

export const FILE_TREE_ROOT_ID = '__notegen_file_tree_root__'

export type FileTreeNode = {
  id: string
  item: DirTree | null
  path: string
  isFolder: boolean
  childrenLoaded: boolean
  children: string[]
}

export type FileTreeModel = {
  nodes: Map<string, FileTreeNode>
  rootChildren: string[]
  folderIds: string[]
  idByPath: Map<string, string>
}

export type FileTreeSearchIndex = {
  entries: Map<string, string>
  names: Map<string, string>
  trigrams: Map<string, Set<string>>
}

export type FileTreeVisibilityOptions = {
  showCloudFiles: boolean
  showAssetsFolders: boolean
  assetsFolderName: string
}

export function isFileTreeEntryVisible(
  item: DirTree,
  options: FileTreeVisibilityOptions,
) {
  return (
    (options.showCloudFiles || item.isLocale)
    && (
      options.showAssetsFolders
      || item.isFile
      || item.name !== options.assetsFolderName
    )
  )
}

/** Build a display-only tree without mutating the source used by sync and IO. */
export function filterFileTreeByVisibility(
  tree: DirTree[],
  options: FileTreeVisibilityOptions,
): DirTree[] {
  if (options.showCloudFiles && options.showAssetsFolders) return tree

  return tree.flatMap((item) => {
    if (!isFileTreeEntryVisible(item, options)) return []

    return [{
      ...item,
      children: item.children
        ? filterFileTreeByVisibility(item.children, options)
        : undefined,
    }]
  })
}

function createNodeId(path: string, isFolder: boolean) {
  return `${isFolder ? 'folder' : 'file'}:${path}`
}

export function buildFileTreeModel(tree: DirTree[]): FileTreeModel {
  const nodes = new Map<string, FileTreeNode>()
  const folderIds: string[] = []
  const idByPath = new Map<string, string>()

  function visit(items: DirTree[], parentPath = ''): string[] {
    return items.map((item) => {
      const path = parentPath ? `${parentPath}/${item.name}` : item.name
      const isFolder = !item.isFile
      const id = createNodeId(path, isFolder)
      const children = isFolder ? visit(item.children ?? [], path) : []

      nodes.set(id, {
        id,
        item,
        path,
        isFolder,
        childrenLoaded: item.childrenLoaded === true,
        children,
      })
      idByPath.set(path, id)
      if (isFolder) folderIds.push(id)

      return id
    })
  }

  const rootChildren = visit(tree)
  nodes.set(FILE_TREE_ROOT_ID, {
    id: FILE_TREE_ROOT_ID,
    item: null,
    path: '',
    isFolder: true,
    childrenLoaded: true,
    children: rootChildren,
  })

  return {
    nodes,
    rootChildren,
    folderIds,
    idByPath,
  }
}

export function filterFileTreeByQuery(tree: DirTree[], query: string): DirTree[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return tree

  function filter(items: DirTree[], parentPath = ''): DirTree[] {
    return items.flatMap((item) => {
      const path = parentPath ? `${parentPath}/${item.name}` : item.name
      const children = item.children ? filter(item.children, path) : undefined
      const matches = path.toLocaleLowerCase().includes(normalizedQuery)

      if (!matches && (!children || children.length === 0)) {
        return []
      }

      return [{
        ...item,
        children,
      }]
    })
  }

  return filter(tree)
}

export function buildFileTreeSearchIndex(tree: DirTree[]): FileTreeSearchIndex {
  const entries = new Map<string, string>()
  const names = new Map<string, string>()
  const trigrams = new Map<string, Set<string>>()

  function visit(items: DirTree[], parentPath = '') {
    for (const item of items) {
      const path = parentPath ? `${parentPath}/${item.name}` : item.name
      const normalized = path.toLocaleLowerCase()
      const normalizedName = item.name.toLocaleLowerCase()
      entries.set(path, normalized)
      names.set(path, normalizedName)

      const grams = new Set<string>()
      for (let index = 0; index <= normalized.length - 3; index += 1) {
        grams.add(normalized.slice(index, index + 3))
      }
      for (const gram of grams) {
        const paths = trigrams.get(gram) ?? new Set<string>()
        paths.add(path)
        trigrams.set(gram, paths)
      }

      if (item.children) visit(item.children, path)
    }
  }

  visit(tree)
  return { entries, names, trigrams }
}

export function searchFileTreeIndex(index: FileTreeSearchIndex, query: string): Set<string> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return new Set(index.entries.keys())

  const visiblePaths = new Set<string>()
  for (const path of getFileTreeSearchMatches(index, normalizedQuery)) {
    const parts = path.split('/')
    for (let depth = 1; depth <= parts.length; depth += 1) {
      visiblePaths.add(parts.slice(0, depth).join('/'))
    }
  }
  return visiblePaths
}

export function getFileTreeSearchMatches(index: FileTreeSearchIndex, query: string): Set<string> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return new Set(index.entries.keys())

  let candidates: Iterable<string> = index.entries.keys()
  if (normalizedQuery.length >= 3) {
    const queryGrams = Array.from(
      { length: normalizedQuery.length - 2 },
      (_, gramIndex) => normalizedQuery.slice(gramIndex, gramIndex + 3)
    )
    const smallestBucket = queryGrams
      .map(gram => index.trigrams.get(gram) ?? new Set<string>())
      .sort((left, right) => left.size - right.size)[0]
    candidates = smallestBucket ?? []
  }

  const nameMatches = new Set<string>()
  const pathMatches = new Set<string>()
  for (const path of candidates) {
    if (index.names.get(path)?.includes(normalizedQuery)) nameMatches.add(path)
    else if (index.entries.get(path)?.includes(normalizedQuery)) pathMatches.add(path)
  }
  return nameMatches.size > 0 ? nameMatches : pathMatches
}

export function filterFileTreeByPathSet(tree: DirTree[], visiblePaths: Set<string>): DirTree[] {
  function filter(items: DirTree[], parentPath = ''): DirTree[] {
    return items.flatMap(item => {
      const path = parentPath ? `${parentPath}/${item.name}` : item.name
      if (!visiblePaths.has(path)) return []

      return [{
        ...item,
        children: item.children ? filter(item.children, path) : undefined,
      }]
    })
  }

  return filter(tree)
}

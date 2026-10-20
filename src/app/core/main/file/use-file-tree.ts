import {
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { useEffect, useMemo } from 'react'

import type { DirTree } from '@/stores/article'

import {
  FILE_TREE_ROOT_ID,
  buildFileTreeModel,
  type FileTreeNode,
} from './file-tree-model'

type UseFileTreeOptions = {
  expandedPaths: string[]
  filterActive: boolean
  items: DirTree[]
  loadExpandedFolder: (path: string) => void | Promise<void>
  selectedPaths: string[]
  setExpandedPath: (path: string, expanded: boolean) => void | Promise<void>
  setSelectedPaths: (paths: string[]) => void
}

export function useFileTree({
  expandedPaths,
  filterActive,
  items,
  loadExpandedFolder,
  selectedPaths,
  setExpandedPath,
  setSelectedPaths,
}: UseFileTreeOptions) {
  const model = useMemo(
    () => buildFileTreeModel(items),
    [items]
  )
  const expandedItemIds = useMemo(
    () => filterActive
      ? model.folderIds
      : expandedPaths.flatMap(path => {
          const id = model.idByPath.get(path)
          return id ? [id] : []
        }),
    [expandedPaths, filterActive, model]
  )
  const selectedItemIds = useMemo(
    () => selectedPaths.flatMap(path => {
      const id = model.idByPath.get(path)
      return id ? [id] : []
    }),
    [model, selectedPaths]
  )

  const tree = useTree<FileTreeNode>({
    rootItemId: FILE_TREE_ROOT_ID,
    getItemName: item => item.getItemData().item?.name ?? '',
    isItemFolder: item => item.getItemData().isFolder,
    dataLoader: {
      getItem: itemId => model.nodes.get(itemId) ?? model.nodes.get(FILE_TREE_ROOT_ID)!,
      getChildren: itemId => model.nodes.get(itemId)?.children ?? [],
    },
    state: {
      expandedItems: expandedItemIds,
      selectedItems: selectedItemIds,
    },
    setExpandedItems: nextIds => {
      if (filterActive) return

      const resolvedIds = typeof nextIds === 'function' ? nextIds(expandedItemIds) : nextIds
      const nextPaths = resolvedIds.flatMap(id => {
        const path = model.nodes.get(id)?.path
        return path ? [path] : []
      })
      const currentPaths = new Set(expandedPaths)
      const nextPathSet = new Set(nextPaths)

      for (const path of expandedPaths) {
        if (!nextPathSet.has(path)) {
          void setExpandedPath(path, false)
        }
      }
      for (const path of nextPaths) {
        if (!currentPaths.has(path)) {
          void setExpandedPath(path, true)
          void loadExpandedFolder(path)
        }
      }
    },
    setSelectedItems: nextIds => {
      const resolvedIds = typeof nextIds === 'function' ? nextIds(selectedItemIds) : nextIds
      setSelectedPaths(resolvedIds.flatMap(id => {
        const path = model.nodes.get(id)?.path
        return path ? [path] : []
      }))
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
    ],
  })

  useEffect(() => {
    tree.rebuildTree()
  }, [tree, model])

  return {
    model,
    tree,
  }
}

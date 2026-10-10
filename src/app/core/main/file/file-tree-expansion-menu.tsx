'use client'

import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/enhanced-context-menu'
import useArticleStore from '@/stores/article'

export function FileTreeExpansionMenu({ disabled = false, folderPath }: { disabled?: boolean; folderPath?: string }) {
  const t = useTranslations('article.file.toolbar')
  const expandAllFolders = useArticleStore(state => state.expandAllFolders)
  const collapseAllFolders = useArticleStore(state => state.collapseAllFolders)
  const hasFolders = useArticleStore(state => state.fileTree.some(item => !item.isFile))
  const hasExpandedFolders = useArticleStore(state => state.collapsibleList.some(path => (
    folderPath === undefined || path === folderPath || path.startsWith(`${folderPath}/`)
  )))

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem disabled={disabled || !hasFolders} onSelect={() => expandAllFolders(folderPath)} menuType="file">
          <ChevronsUpDown className="mr-2 size-4" />
          {t(folderPath === undefined ? 'expandAll' : 'expandFolderTree')}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled || !hasExpandedFolders} onSelect={() => collapseAllFolders(folderPath)} menuType="file">
          <ChevronsDownUp className="mr-2 size-4" />
          {t(folderPath === undefined ? 'collapseAll' : 'collapseFolderTree')}
        </ContextMenuItem>
      </ContextMenuGroup>
    </>
  )
}

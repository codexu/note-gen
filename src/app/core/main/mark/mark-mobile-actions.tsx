'use client'

import { useTranslations } from 'next-intl'
import { MoreVertical, FolderOpen, File, Link2, RefreshCw, Trash2, RotateCcw, XCircle } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Mark } from '@/db/marks'
import { Tag } from '@/db/tags'
import { useIsMobile } from '@/hooks/use-mobile'

interface MarkMobileActionsProps {
  mark: Mark
  tags: Tag[]
  currentTagId: number | null
  trashState: boolean
  isMultiSelectMode: boolean
  selectedMarkIds: Set<number>
  onTransfer: (tagId: number, e?: React.MouseEvent) => void
  onCopyLink: (e?: React.MouseEvent) => void
  onRegenerateDesc: (e?: React.MouseEvent) => void
  onShowInFolder: (e?: React.MouseEvent) => void
  onShowInFile: (e?: React.MouseEvent) => void
  onRestore: (e?: React.MouseEvent) => void
  onDelete: (e?: React.MouseEvent) => void
  onDeleteForever: (e?: React.MouseEvent) => void
}

export function MarkMobileActions({ 
  mark,
  tags,
  currentTagId,
  trashState,
  isMultiSelectMode,
  selectedMarkIds,
  onTransfer,
  onCopyLink,
  onRegenerateDesc,
  onShowInFolder,
  onShowInFile,
  onRestore,
  onDelete,
  onDeleteForever
}: MarkMobileActionsProps) {
  const t = useTranslations()
  const isMobile = useIsMobile()

  // 只在移动端显示
  if (!isMobile) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-11 w-11 shrink-0"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {!trashState && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {isMultiSelectMode && selectedMarkIds.size > 0 
                ? t('record.mark.toolbar.moveSelectedTags', { count: selectedMarkIds.size })
                : t('record.mark.toolbar.moveTag')
              }
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {tags.map((tag) => (
                <DropdownMenuItem 
                  key={tag.id}
                  disabled={tag.id === currentTagId}
                  onClick={(e) => onTransfer(tag.id, e)}
                >
                  {tag.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        
        <DropdownMenuItem 
          disabled={isMultiSelectMode || !mark.url}
          onClick={(e) => onCopyLink(e)}
        >
          <Link2 className="mr-2 h-4 w-4" />
          {t('record.mark.toolbar.copyLink')}
        </DropdownMenuItem>
        
        <DropdownMenuItem 
          disabled={isMultiSelectMode || mark.type === 'text'}
          onClick={(e) => onRegenerateDesc(e)}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('record.mark.toolbar.regenerateDesc')}
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem 
          disabled={isMultiSelectMode || mark.type === 'text'}
          onClick={(e) => onShowInFolder(e)}
        >
          <FolderOpen className="mr-2 h-4 w-4" />
          {t('record.mark.toolbar.viewFolder')}
        </DropdownMenuItem>
        
        <DropdownMenuItem 
          disabled={isMultiSelectMode || mark.type === 'text'}
          onClick={(e) => onShowInFile(e)}
        >
          <File className="mr-2 h-4 w-4" />
          {t('record.mark.toolbar.viewFile')}
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        {trashState ? (
          <>
            <DropdownMenuItem 
              disabled={isMultiSelectMode}
              onClick={(e) => onRestore(e)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('record.mark.toolbar.restore')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => onDeleteForever(e)}>
              <XCircle className="mr-2 h-4 w-4 text-red-600" />
              <span className="text-red-600">
                {isMultiSelectMode && selectedMarkIds.size > 0 
                  ? t('record.mark.toolbar.deleteSelectedForever', { count: selectedMarkIds.size })
                  : t('record.mark.toolbar.deleteForever')
                }
              </span>
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={(e) => onDelete(e)}>
            <Trash2 className="mr-2 h-4 w-4 text-red-600" />
            <span className="text-red-600">
              {isMultiSelectMode && selectedMarkIds.size > 0 
                ? t('record.mark.toolbar.deleteSelected', { count: selectedMarkIds.size })
                : t('record.mark.toolbar.delete')
              }
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

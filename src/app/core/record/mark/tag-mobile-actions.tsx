'use client'

import { useTranslations } from 'next-intl'
import { MoreVertical, Edit2, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tag } from '@/db/tags'
import { useIsMobile } from '@/hooks/use-mobile'

interface TagMobileActionsProps {
  tag: Tag
  onRename: (tag: Tag) => void
  onDelete: (tagId: number) => void
  isEditing: boolean
}

export function TagMobileActions({ tag, onRename, onDelete, isEditing }: TagMobileActionsProps) {
  const t = useTranslations()
  const isMobile = useIsMobile()

  // 只在移动端显示
  if (!isMobile) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <div 
          role="button"
          tabIndex={0}
          className="inline-flex items-center justify-center h-6 w-6 shrink-0 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
            }
          }}
        >
          <MoreVertical className="h-4 w-4" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem 
          disabled={isEditing}
          onClick={(e) => {
            e.stopPropagation()
            onRename(tag)
          }}
        >
          <Edit2 className="mr-2 h-4 w-4" />
          {t('record.mark.tag.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem 
          disabled={tag.isLocked}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(tag.id)
          }}
        >
          <Trash2 className="mr-2 h-4 w-4 text-red-600" />
          <span className="text-red-600">{t('record.mark.tag.delete')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

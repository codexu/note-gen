'use client'

import { useTranslations } from 'next-intl'
import { Memory } from '@/db/memories'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'

interface MemoryItemProps {
  memory: Memory
  onDelete: () => void
}

export function MemoryItem({ memory, onDelete }: MemoryItemProps) {
  const t = useTranslations('settings.memories')

  const categoryLabel = memory.category === 'preference' ? t('preference') : t('memory')

  return (
    <div className="group flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors">
      <Badge className="shrink-0 mt-0.5">
        {categoryLabel}
      </Badge>
      <p className="flex-1 text-sm leading-relaxed line-clamp-1">{memory.content}</p>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onDelete}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

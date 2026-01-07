"use client"

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Tag } from 'lucide-react'
import useTagStore from '@/stores/tag'
import useMarkStore from '@/stores/mark'
import useChatStore from '@/stores/chat'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function TagLinkToggle() {
  const { currentTag } = useTagStore()
  const { marks } = useMarkStore()
  const { isLinkMark, setIsLinkMark } = useChatStore()
  const t = useTranslations('record.chat.input')
  const hasMarks = currentTag && marks.filter(m => m.tagId === currentTag.id).length > 0

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <Tag className="size-4" />
        <Label className="text-sm font-medium">{t('tagLink.on')} {currentTag?.name}({marks.length})</Label>
      </div>
      <Switch
        checked={isLinkMark}
        onCheckedChange={setIsLinkMark}
        disabled={!hasMarks}
      />
    </div>
  )
}

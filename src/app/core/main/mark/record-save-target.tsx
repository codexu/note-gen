'use client'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Tag } from '@/db/tags'
import { useTranslations } from 'next-intl'

interface RecordSaveTargetProps {
  selectedTagId: number
  tags: Tag[]
  onTagChange: (tagId: number) => void
}

export function RecordSaveTarget({ selectedTagId, tags, onTagChange }: RecordSaveTargetProps) {
  const t = useTranslations()
  const selectedTag = tags.find((tag) => tag.id === selectedTagId)

  if (tags.length === 0) {
    return null
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="record-save-target" className="text-xs font-medium text-muted-foreground">
        {t('record.capture.saveTarget')}
      </Label>
      <Select value={String(selectedTag?.id ?? selectedTagId)} onValueChange={(value) => onTagChange(Number(value))}>
        <SelectTrigger id="record-save-target" className="h-9 max-w-full [&_[data-slot=select-value]]:truncate">
          <SelectValue placeholder={t('record.capture.saveTargetPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>{tags.map((tag) => (
            <SelectItem key={tag.id} value={String(tag.id)}>
              {tag.name}
            </SelectItem>
          ))}</SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

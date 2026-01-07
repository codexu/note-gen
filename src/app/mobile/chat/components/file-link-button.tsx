"use client"

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { AtSign } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface FileLinkButtonProps {
  onFileLinkClick: () => void
  disabled?: boolean
}

export function FileLinkButton({ onFileLinkClick, disabled = false }: FileLinkButtonProps) {
  const t = useTranslations('mobile.chat.drawer.attachments')

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <AtSign className="size-4" />
        <Label className="text-sm font-medium">{t('linkNote')}</Label>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onFileLinkClick}
        disabled={disabled}
      >
        {t('linkNote')}
      </Button>
    </div>
  )
}

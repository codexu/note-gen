'use client'

import { ExternalLink, FileText } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Mark } from '@/db/marks'
import { getDocumentFileName } from '@/lib/document-parser'
import { cn, isHttpUrl } from '@/lib/utils'
import { canOpenMarkSource } from './mark-open-path'

interface RecordFileButtonProps {
  mark: Pick<Mark, 'type' | 'url' | 'desc'>
  onOpen: () => void
  className?: string
  mobile?: boolean
  disabled?: boolean
}

export function RecordFileButton({ mark, onOpen, className, mobile, disabled }: RecordFileButtonProps) {
  const t = useTranslations('record.mark.toolbar')
  if (mark.type !== 'file') return null
  const source = mark.url?.trim()
  if (!source) return null

  const webSource = isHttpUrl(source)
  const fileUri = /^(?:content|file):\/\//i.test(source)
  const sourceName = webSource || fileUri ? getDocumentFileName(source) : source.split(/[/\\]/).pop()
  const name = (/^content:\/\//i.test(source) && mark.desc?.trim()) || sourceName || source
  const canOpen = webSource || (mobile && fileUri) || canOpenMarkSource({ type: mark.type, url: source })

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('min-w-12 shrink gap-1.5 px-2 text-start', mobile ? 'h-11 max-w-28' : 'max-w-48 @max-sm/record-detail:max-w-28', className)}
      aria-label={`${t('viewFile')} ${name}`}
      title={name}
      disabled={disabled || !canOpen}
      onClick={onOpen}
    >
      <FileText aria-hidden="true" className="text-muted-foreground" />
      <span className="min-w-0 truncate">{name}</span>
      {canOpen && <ExternalLink aria-hidden="true" className="hidden text-muted-foreground @lg/record-detail:block" />}
    </Button>
  )
}

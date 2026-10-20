"use client"

import { FileIcon, FolderOpen, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PersistedChatAttachment, RuntimeChatAttachment } from '@/lib/chat-attachments'

function formatSize(bytes?: number) {
  if (bytes === undefined) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
}

interface PendingAttachmentsProps {
  attachments: RuntimeChatAttachment[]
  onRemove: (id: string) => void
}

export function PendingFileAttachments({ attachments, onRemove }: PendingAttachmentsProps) {
  const t = useTranslations('record.chat.input.addAttachment')
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-1 pt-1">
      {attachments.map((attachment) => {
        const Icon = attachment.kind === 'folder' ? FolderOpen : FileIcon
        return (
          <div key={attachment.id} className="flex max-w-56 items-center gap-1.5 rounded-lg border bg-muted/50 py-1 pl-2 pr-1 text-xs">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{attachment.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {attachment.kind === 'folder'
                ? `${t('entryCount', { count: attachment.entryCount ?? 0 })}${attachment.previewTruncated ? '+' : ''}`
                : attachment.readable ? formatSize(attachment.size) : t('metadataOnly')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 shrink-0"
              onClick={() => onRemove(attachment.id)}
              aria-label={t('remove', { name: attachment.name })}
            >
              <X />
            </Button>
          </div>
        )
      })}
    </div>
  )
}

export function ChatAttachmentSummary({ attachments }: { attachments: PersistedChatAttachment[] }) {
  const t = useTranslations('record.chat.input.addAttachment')
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const Icon = attachment.kind === 'folder' ? FolderOpen : FileIcon
        return (
          <Badge key={attachment.id} variant="secondary" className={cn('max-w-64 gap-1.5 font-normal')}>
            <Icon />
            <span className="truncate">{attachment.name}</span>
            {!attachment.readable && <span className="text-muted-foreground">{t('metadataOnly')}</span>}
          </Badge>
        )
      })}
    </div>
  )
}

"use client"

import { Chat } from "@/db/chats"
import { FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/responsive-popover"
import { useTranslations } from 'next-intl'

interface CondensedIndicatorProps {
  chat: Chat
}

export function CondensedIndicator({ chat }: CondensedIndicatorProps) {
  const t = useTranslations('record.chat.messageControl')

  // 仅在有 condensedContent 时显示
  if (!chat.condensedContent) {
    return null
  }

  return (
    <ResponsivePopover mobileTitle={t('summary')}>
      <ResponsivePopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          <FileText className="size-4" />
          <span>{t('summary')}</span>
        </Button>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent side="top" className="max-w-xs">
        <p className="px-4 pb-4 text-xs whitespace-pre-wrap">{chat.condensedContent}</p>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  )
}

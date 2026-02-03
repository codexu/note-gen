import { Chat } from "@/db/chats"
import { FileText } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-help transition-colors">
            <FileText className="size-3" />
            <span>{t('summary')}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs whitespace-pre-wrap">{chat.condensedContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

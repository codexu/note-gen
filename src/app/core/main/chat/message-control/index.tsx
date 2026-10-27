import { Chat } from "@/db/chats"
import useChatStore from "@/stores/chat"
import { XIcon } from "lucide-react"
import { clear, hasText, readText } from "tauri-plugin-clipboard-api"
import { useState } from "react"
import { MessageInfo } from "./message-info"
import { CondensedIndicator } from "./condensed-indicator"
import { TranslateControl } from "./translate-control"
import { CopyControl } from "./copy-control"
import { ReadAloudControl } from "./read-aloud-control"
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl';
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

export default function MessageControl({chat, children}: {chat: Chat, children: React.ReactNode}) {
  const { deleteChat, chats } = useChatStore()
  const isMobile = useIsMobile()
  const alwaysVisible = chat.role !== 'system' || chats.at(-1)?.id === chat.id
  const [translatedContent, setTranslatedContent] = useState<string>('')
  const t = useTranslations('common')
  
  async function deleteHandler() {
    if (chat.type === "clipboard" && !chat.image) {
      const hasTextRes = await hasText()
      if (hasTextRes) {
        try {
          const text = await readText()
          if (text === chat.content) {
            await clear()
          }
        } catch {}
      }
    }
    deleteChat(chat.id)
  }

  return (
    <>
      <div className={cn('mt-2 flex min-h-6 flex-wrap items-center justify-between gap-1 transition-opacity motion-reduce:transition-none',
        !alwaysVisible && 'pointer-events-none opacity-0 group-data-[actions-visible=true]/assistant-message:pointer-events-auto group-data-[actions-visible=true]/assistant-message:opacity-100',
        !alwaysVisible && !isMobile && 'group-hover/assistant-message:pointer-events-auto group-hover/assistant-message:opacity-100 group-focus-within/assistant-message:pointer-events-auto group-focus-within/assistant-message:opacity-100')}>

        <div className="flex min-w-0 items-center gap-1">
          <MessageInfo chat={chat} />
          <CondensedIndicator chat={chat} />
        </div>

        <div className='ml-auto flex items-center gap-0.5 text-muted-foreground'>
          {children || null}

          <CopyControl
            chat={chat}
            translatedContent={translatedContent}
            variant="ghost"
          />

          <TranslateControl
            chat={chat}
            onTranslatedContent={setTranslatedContent}
          />

          <ReadAloudControl
            chat={chat}
            translatedContent={translatedContent}
          />

          <TooltipButton icon={<XIcon />} tooltipText={t('delete')} variant="ghost" size="icon-xs" buttonClassName="[&_svg:not([class*='size-'])]:size-3.5" onClick={deleteHandler}/>
        </div>
      </div>

      {/* 显示翻译结果 */}
      {translatedContent && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="whitespace-pre-wrap">{translatedContent}</div>
        </div>
      )}
    </>
  )
}

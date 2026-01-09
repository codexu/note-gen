"use client"

import React from "react"
import { AlignVerticalJustifyCenter } from "lucide-react"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { useTranslations } from "next-intl"

export function MobileClearContext() {
  const { insert } = useChatStore()
  const { currentTagId } = useTagStore()
  const t = useTranslations('mobile.chat.drawer.tools')

  const handleClearContext = async () => {
    // 插入一条系统消息，表示清除上下文
    await insert({
      tagId: currentTagId,
      role: 'system',
      content: '上下文已清除，之后的对话将只携带此消息之后的内容。',
      type: 'clear',
      inserted: true,
      image: undefined,
    })
  }

  return (
    <div className="h-16 flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <AlignVerticalJustifyCenter className="size-5 text-muted-foreground" />
        <div className="font-medium">{t('clearContext')}</div>
      </div>
      <button
        onClick={handleClearContext}
        className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        {t('clear')}
      </button>
    </div>
  )
}

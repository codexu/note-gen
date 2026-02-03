"use client"

import React from "react"
import { SquareCode } from "lucide-react"
import useChatStore from "@/stores/chat"
import { useTranslations } from "next-intl"

export function MobileNewChat() {
  const { startNewConversation } = useChatStore()
  const t = useTranslations('mobile.chat.drawer.tools')

  function newChatHandler() {
    startNewConversation()
  }

  return (
    <div className="h-16 flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <SquareCode className="size-5 text-muted-foreground" />
        <div className="font-medium">{t('newChat')}</div>
      </div>
      <button
        onClick={newChatHandler}
        className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        {t('start')}
      </button>
    </div>
  )
}

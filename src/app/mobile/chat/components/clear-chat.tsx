"use client"

import React from "react"
import { Eraser } from "lucide-react"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { useTranslations } from "next-intl"

export function MobileClearChat() {
  const { clearChats } = useChatStore()
  const { currentTagId } = useTagStore()
  const t = useTranslations('mobile.chat.drawer.tools')

  function clearHandler() {
    clearChats(currentTagId)
  }

  return (
    <div className="h-16 flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <Eraser className="size-5 text-muted-foreground" />
        <div className="font-medium">{t('clearChat')}</div>
      </div>
      <button
        onClick={clearHandler}
        className="px-3 py-1 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
      >
        {t('clear')}
      </button>
    </div>
  )
}

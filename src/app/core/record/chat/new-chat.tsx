"use client"
import * as React from "react"
import { SquareCode } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useChatStore from "@/stores/chat"
import { useTranslations } from 'next-intl'

export function NewChat() {
  const { startNewConversation } = useChatStore()
  const t = useTranslations()

  function newChatHandler() {
    startNewConversation()
  }

  return (
    <div>
      <TooltipButton icon={<SquareCode />} tooltipText={t('record.chat.input.newChat')} side="bottom" onClick={newChatHandler}/>
    </div>
  )
}

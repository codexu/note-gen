"use client"
import * as React from "react"
import { Eraser } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { useTranslations } from 'next-intl'

export function ClearChat() {
  const { clearChats } = useChatStore()
  const { currentTagId } = useTagStore()
  const t = useTranslations()

  function clearHandler() {
    clearChats(currentTagId)
  }

  return (
    <TooltipButton icon={<Eraser />} tooltipText={t('record.chat.input.clearChat')} onClick={clearHandler}/>
  )
}

"use client"

import React from "react"
import { AlignVerticalJustifyCenter } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { useTranslations } from 'next-intl'

export function ClearContext() {
  const { insert } = useChatStore()
  const { currentTagId } = useTagStore()
  const t = useTranslations('record.chat.input.clearContext')

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
    <TooltipButton
      variant="ghost"
      size="icon"
      icon={<AlignVerticalJustifyCenter className="size-4" />}
      tooltipText={t('tooltip')}
      onClick={handleClearContext}
    />
  )
}

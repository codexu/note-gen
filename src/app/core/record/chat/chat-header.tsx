"use client"

import { BotMessageSquare, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import useSettingStore from "@/stores/setting"
import { NewChat } from "./new-chat"
import { RemoveChat } from "./remove-chat"

export function ChatHeader() {
  const { currentPrompt } = usePromptStore()
  const { aiTitle, model } = useSettingStore()

  return (
    <header className="h-12 w-full grid grid-cols-[auto_1fr_auto] items-center border-b px-4 text-sm">

      <div className="flex items-center gap-1">
        <Drama className="size-4" />
        {currentPrompt?.title}
      </div>
      <div className="flex items-center justify-center gap-1">
        <BotMessageSquare className="size-4" />
        <span>{model}</span>
        <span className="hidden lg:inline">({aiTitle})</span>
      </div>
      <div className="flex items-center gap-1">
        <NewChat />
        <RemoveChat />
      </div>
    </header>
  )
}

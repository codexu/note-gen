"use client"

import { BotMessageSquare, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import useSettingStore from "@/stores/setting"
import { NewChat } from "./new-chat"
import { RemoveChat } from "./remove-chat"

export function ChatHeader() {
  const { currentPrompt } = usePromptStore()
  const { primaryModel, aiModelList } = useSettingStore()

  return (
    <header className="h-12 w-full grid grid-cols-[auto_1fr_auto] items-center border-b px-4 text-sm gap-4">
      <div className="flex items-center gap-1">
        <Drama className="size-4" />
        {currentPrompt?.title}
      </div>
      <div className="flex items-center justify-center gap-1">
        {
          primaryModel &&
          <>
            <BotMessageSquare className="!size-4" />
            <span className="line-clamp-1 flex-1 md:flex-none">
              {aiModelList?.find(model => model.key === primaryModel)?.model}
              ({aiModelList?.find(model => model.key === primaryModel)?.title})
            </span>
          </>
        }
      </div>
      <div className="flex items-center gap-1">
        <NewChat />
        <RemoveChat />
      </div>
    </header>
  )
}

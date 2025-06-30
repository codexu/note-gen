"use client"

import { BotMessageSquare, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import useSettingStore from "@/stores/setting"
import { NewChat } from "./new-chat"
import { RemoveChat } from "./remove-chat"
import { Store } from "@tauri-apps/plugin-store"
import { AiConfig } from "@/app/core/setting/config"
import { useEffect, useState } from "react"

export function ChatHeader() {
  const { currentPrompt } = usePromptStore()
  const { primaryModel } = useSettingStore()

  const [models, setModels] = useState<AiConfig[]>([])

  async function getModels() {
    const store = await Store.load('store.json');
    const aiModelList = await store.get<AiConfig[]>('aiModelList');
    if (!aiModelList) return [];
    setModels(aiModelList)
    return aiModelList;
  }

  useEffect(() => {
    getModels()
  }, [])

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
            <span className="line-clamp-1 flex-1 lg:flex-none">
              {models.find(model => model.key === primaryModel)?.model}
              ({models.find(model => model.key === primaryModel)?.title})
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

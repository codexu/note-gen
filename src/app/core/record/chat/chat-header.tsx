"use client"

import { BotMessageSquare, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import useSettingStore from "@/stores/setting"
import { NewChat } from "./new-chat"
import { RemoveChat } from "./remove-chat"
// import { Store } from "@tauri-apps/plugin-store";
// import { AiConfig } from "../../setting/config"
// import { useEffect } from "react"
export function ChatHeader() {
  const { currentPrompt } = usePromptStore()
  const { aiTitle, model } = useSettingStore()
  // async function init(){
  //       const store = await Store.load('store.json');
  //       const aiModelList = await store.get<AiConfig[]>('aiModelList')
  //       if (!aiModelList) return
  //       const model = aiModelList.find(item => item.key === aiType)
  //       console.log(model)
  // }
  // useEffect(() => {
  //   init()
  // }, [])
  return (
    <header className="h-12 w-full grid grid-cols-[auto_1fr_auto] items-center border-b px-4 text-sm">

      <div className="flex items-center gap-1">
        <Drama className="size-4" />
        {currentPrompt?.title}
      </div>
      <div className="flex items-center justify-center gap-1">
        <BotMessageSquare className="size-4" />
        {`${model}(${aiTitle})`}
      </div>
      <div className="flex items-center gap-1">
        <NewChat />
        <RemoveChat />
      </div>
    </header>
  )
}

"use client"

import { BotMessageSquare, BotOff, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import useSettingStore from "@/stores/setting"
import { NewChat } from "./new-chat"
import { RemoveChat } from "./remove-chat"
import { useTranslations } from "next-intl"

export function ChatHeader() {
  const t = useTranslations('record.chat.header')
  const { currentPrompt } = usePromptStore()
  const { primaryModel, aiModelList } = useSettingStore()

  // 查找当前选中的模型
  const findSelectedModel = () => {
    if (!primaryModel || !aiModelList) return null
    
    for (const config of aiModelList) {
      // 检查新的 models 数组结构
      if (config.models && config.models.length > 0) {
        const targetModel = config.models.find(model => model.id === primaryModel)
        if (targetModel) {
          return {
            model: targetModel.model,
            configTitle: config.title
          }
        }
      } else {
        // 向后兼容：处理旧的单模型结构
        if (config.key === primaryModel) {
          return {
            model: config.model,
            configTitle: config.title
          }
        }
      }
    }
    return null
  }

  const selectedModel = findSelectedModel()

  return (
    <header className="h-12 w-full grid grid-cols-[auto_1fr_auto] items-center border-b px-4 text-sm gap-4">
      <div className="flex items-center gap-1">
        <Drama className="size-4" />
        {currentPrompt?.title}
      </div>
      <div className="flex items-center justify-center gap-1">
        {
          selectedModel ?
          <>
            <BotMessageSquare className="!size-4" />
            <span className="line-clamp-1 flex-1 md:flex-none">
              {selectedModel.model}
              ({selectedModel.configTitle})
            </span>
          </> :
          <>
            <BotOff className="!size-4" />
            <span>{t('noModel')}</span>
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

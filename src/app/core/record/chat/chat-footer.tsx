"use client"

import { BotMessageSquare, BotOff, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import useSettingStore from "@/stores/setting"
import { useTranslations } from "next-intl"

export function ChatFooter() {
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
    <footer className="h-6 w-full flex items-center justify-between border-t px-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Drama className="size-3.5" />
        <span className="line-clamp-1">{currentPrompt?.title}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {
          selectedModel ?
          <>
            <BotMessageSquare className="size-3.5" />
            <span className="line-clamp-1">
              {selectedModel.model}
              <span className="ml-1">({selectedModel.configTitle})</span>
            </span>
          </> :
          <>
            <BotOff className="size-3.5" />
            <span>{t('noModel')}</span>
          </>
        }
      </div>
    </footer>
  )
}

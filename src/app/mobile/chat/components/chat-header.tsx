"use client"

import { BotMessageSquare, BotOff, Check, Drama } from "lucide-react"
import * as React from "react"
import { useEffect, useState } from "react"
import { AiConfig, ModelConfig } from "../../../core/setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import usePromptStore from "@/stores/prompt"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

interface GroupedModel {
  configKey: string
  configTitle: string
  model: ModelConfig
}

export function ChatHeader() {
  const { promptList, currentPrompt, setCurrentPrompt } = usePromptStore()
  const { primaryModel, setPrimaryModel } = useSettingStore()

  const [groupedModels, setGroupedModels] = useState<GroupedModel[]>([])
  const [promptOpen, setPromptOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)

  async function getModels() {
    const store = await Store.load('store.json')
    const aiConfigs = await store.get<AiConfig[]>('aiModelList')
    if (!aiConfigs) return []
    
    const models: GroupedModel[] = []
    
    aiConfigs.forEach(config => {
      // 检查配置是否有效
      if (!config.baseURL) return
      
      // 处理新的 models 数组结构
      if (config.models && config.models.length > 0) {
        config.models.forEach(model => {
          // 只显示 chat 类型的模型
          if (model.modelType === 'chat' && model.model) {
            models.push({
              configKey: config.key,
              configTitle: config.title,
              model: model
            })
          }
        })
      } else {
        // 向后兼容：处理旧的单模型结构
        if ((config.modelType === 'chat' || !config.modelType) && config.model) {
          models.push({
            configKey: config.key,
            configTitle: config.title,
            model: {
              id: config.key,
              model: config.model,
              modelType: config.modelType || 'chat',
              temperature: config.temperature,
              topP: config.topP,
              voice: config.voice,
              enableStream: config.enableStream
            }
          })
        }
      }
    })
    
    setGroupedModels(models)
    return models;
  }

  async function modelSelectChangeHandler(modelId: string) {
    setPrimaryModel(modelId)
    const store = await Store.load('store.json');
    store.set('primaryModel', modelId)
    await store.save()
    setModelOpen(false)
  }

  async function promptSelectChangeHandler(id: string) {
    const selectedPrompt = promptList.find(item => item.id === id)
    if (!selectedPrompt) return
    await setCurrentPrompt(selectedPrompt)
    setPromptOpen(false)
  }

  useEffect(() => {
    getModels()
  }, [])

  return (
    <header className="h-12 w-full flex justify-between items-center border-b px-4 text-sm gap-4">
      <Popover open={promptOpen} onOpenChange={setPromptOpen}>
        <PopoverTrigger asChild>
          <div className="flex items-center gap-1 cursor-pointer hover:opacity-80">
            <Drama className="size-4" />
            <span className="line-clamp-1">
              {currentPrompt?.title}
            </span>
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-[180px] p-0">
          <Command>
            <CommandInput placeholder="Search prompt..." className="h-9" />
            <CommandList>
              <CommandGroup>
                {promptList?.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={(currentValue) => {
                      promptSelectChangeHandler(currentValue)
                    }}
                  >
                    {item.title}
                    <Check
                      className={cn(
                        "ml-auto",
                        currentPrompt?.id === item.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover open={modelOpen} onOpenChange={setModelOpen}>
        <PopoverTrigger asChild>
          <div className="flex items-center justify-center gap-1 cursor-pointer hover:opacity-80">
            {groupedModels.length > 0 ? <BotMessageSquare className="!size-4" /> : <BotOff className="size-4" />}
            <span className="line-clamp-1 flex-1 md:flex-none">
              {groupedModels.find(item => item.model.id === primaryModel)?.model.model}
            </span>
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <Command>
            <CommandInput placeholder="Search model..." className="h-9" />
            <CommandList>
              <CommandEmpty>No model found.</CommandEmpty>
              {/* 按配置分组显示模型 */}
              {Object.entries(
                groupedModels.reduce((acc, item) => {
                  if (!acc[item.configTitle]) {
                    acc[item.configTitle] = []
                  }
                  acc[item.configTitle].push(item)
                  return acc
                }, {} as Record<string, GroupedModel[]>)
              ).map(([configTitle, models]) => (
                <CommandGroup key={configTitle} heading={configTitle}>
                  {models.map((item) => (
                    <CommandItem
                      key={item.model.id}
                      value={item.model.id}
                      onSelect={(currentValue) => {
                        modelSelectChangeHandler(currentValue)
                      }}
                    >
                      {item.model.model}
                      <Check
                        className={cn(
                          "ml-auto",
                          primaryModel === item.model.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </header>
  )
}

"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { ModelConfig } from "@/app/core/setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import { BotMessageSquare, BotOff } from "lucide-react"
import { useTranslations } from "next-intl"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface GroupedModel {
  configKey: string
  configTitle: string
  model: ModelConfig
}

export function ModelSelector() {
  const [groupedModels, setGroupedModels] = useState<GroupedModel[]>([])
  const { primaryModel, setPrimaryModel, aiModelList, initSettingData } = useSettingStore()
  const t = useTranslations('record.chat.input.modelSelect')

  async function modelSelectChangeHandler(modelId: string) {
    setPrimaryModel(modelId)
    const store = await Store.load('store.json')
    store.set('primaryModel', modelId)
    await store.save()
  }

  useEffect(() => {
    initSettingData()
  }, [])

  useEffect(() => {
    if (aiModelList && aiModelList.length > 0) {
      const models: GroupedModel[] = []
      
      aiModelList.forEach(config => {
        if (!config.baseURL) return
        
        if (config.models && config.models.length > 0) {
          config.models.forEach(model => {
            if (model.modelType === 'chat' && model.model) {
              models.push({
                configKey: config.key,
                configTitle: config.title,
                model: model
              })
            }
          })
        } else {
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
    }
  }, [aiModelList])

  const groupedByConfig = groupedModels.reduce((acc, item) => {
    if (!acc[item.configTitle]) {
      acc[item.configTitle] = []
    }
    acc[item.configTitle].push(item)
    return acc
  }, {} as Record<string, GroupedModel[]>)

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        {groupedModels.length > 0 ? (
          <BotMessageSquare className="size-4" />
        ) : (
          <BotOff className="size-4" />
        )}
        <Label className="text-sm font-medium">{t('tooltip')}</Label>
      </div>
      <Select value={primaryModel} onValueChange={modelSelectChangeHandler}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t('placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(groupedByConfig).map(([configTitle, models]) => (
            <SelectGroup key={configTitle}>
              <SelectLabel>{configTitle}</SelectLabel>
              {models.map((item) => (
                <SelectItem key={item.model.id} value={item.model.id}>
                  {item.model.model}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

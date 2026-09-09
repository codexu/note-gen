"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import { Check, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { Label } from "@/components/ui/label"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/hooks/use-toast"
import {
  changePrimaryChatModel,
  collectGroupedChatModels,
  type GroupedChatModel,
} from "@/app/core/main/chat/model-selection"

function ModelListContent({
  groupedByConfig,
  primaryModel,
  onSelect,
}: {
  groupedByConfig: Record<string, GroupedChatModel[]>
  primaryModel?: string
  onSelect: (modelId: string) => void
}) {
  return (
    <div className="space-y-4">
      {Object.entries(groupedByConfig).map(([configTitle, models]) => (
        <div key={configTitle} className="space-y-1">
          <div className="px-2 text-xs font-medium text-muted-foreground">
            {configTitle}
          </div>
          {models.map((item) => {
            const isSelected = primaryModel === item.model.id

            return (
              <button
                key={item.model.id}
                onClick={() => onSelect(item.model.id)}
                className={cn(
                  "w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg text-left transition-colors",
                  isSelected ? "bg-accent" : "hover:bg-muted/50"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{item.model.model}</div>
                </div>
                <div
                  className={cn(
                    "flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0",
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/30"
                  )}
                >
                  {isSelected && <Check className="size-3.5" />}
                </div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function ModelSelector() {
  const [groupedModels, setGroupedModels] = useState<GroupedChatModel[]>([])
  const [open, setOpen] = useState(false)
  const { primaryModel, aiModelList, initSettingData } = useSettingStore()
  const { loading, agentState } = useChatStore()
  const t = useTranslations('record.chat.input.modelSelect')

  async function modelSelectChangeHandler(modelId: string) {
    const nextModel = groupedModels.find(item => item.model.id === modelId)
    const previousModel = groupedModels.find(item => item.model.id === primaryModel)
    const result = await changePrimaryChatModel({
      modelId,
      modelName: nextModel?.model.model || modelId,
      previousModelName: previousModel?.model.model || primaryModel,
    })
    if (result.changed && result.hasConversationHistory) {
      toast({
        title: result.appliesNextTurn
          ? t('nextTurn', { model: nextModel?.model.model || modelId })
          : t('changed', {
              from: previousModel?.model.model || primaryModel,
              to: nextModel?.model.model || modelId,
            }),
        description: result.appliesNextTurn
          ? t('changeWarning')
          : t('continuityWarning'),
      })
    }
  }

  useEffect(() => {
    initSettingData()
  }, [])

  useEffect(() => {
    setGroupedModels(collectGroupedChatModels(aiModelList))
  }, [aiModelList])

  const groupedByConfig = groupedModels.reduce((acc, item) => {
    if (!acc[item.configTitle]) {
      acc[item.configTitle] = []
    }
    acc[item.configTitle].push(item)
    return acc
  }, {} as Record<string, GroupedChatModel[]>)

  const selectedModel = groupedModels.find((item) => item.model.id === primaryModel)
  const appliesNextTurn = Boolean(
    (loading || agentState.isRunning)
    && agentState.activeModelId
    && agentState.activeModelId !== primaryModel
  )
  const selectedModelLabel = selectedModel?.model.model || t('placeholder')
  const displayedModelLabel = appliesNextTurn
    ? `${agentState.activeModelName || agentState.activeModelId} → ${selectedModelLabel}`
    : selectedModelLabel

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-16 flex items-center justify-between w-full px-0"
      >
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{t('tooltip')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground truncate max-w-40">
            {displayedModelLabel}
          </span>
          {appliesNextTurn && <Badge variant="secondary">{t('nextTurnBadge')}</Badge>}
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </div>
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[70vh]">
          <DrawerHeader>
            <DrawerTitle>{t('tooltip')}</DrawerTitle>
          </DrawerHeader>
          <div className="p-4">
            <ModelListContent
              groupedByConfig={groupedByConfig}
              primaryModel={primaryModel}
              onSelect={async (modelId) => {
                await modelSelectChangeHandler(modelId)
                setOpen(false)
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

import * as React from "react"
import { useEffect, useState } from "react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import { BotMessageSquare, BotOff } from "lucide-react"
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
import { useTranslations } from "next-intl"
import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { ChatToolItem } from "./chat-tool-item"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/hooks/use-toast"
import { useNoteGenLimitedUsage } from '@/hooks/use-notegen-limited-usage'
import { noteGenModelDisplayName } from '@/components/notegen-model-label'
import {
  changePrimaryChatModel,
  collectGroupedChatModels,
  type GroupedChatModel,
} from "./model-selection"

interface ModelSelectProps {
  display?: 'icon' | 'status' | 'panel'
  disabled?: boolean
}

export function ModelSelect({ display = 'icon', disabled = false }: ModelSelectProps) {
  const [groupedModels, setGroupedModels] = useState<GroupedChatModel[]>([])
  const { primaryModel, aiModelList } = useSettingStore()
  const { loading, agentState } = useChatStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.modelSelect')
  const tTools = useTranslations('record.chat.input.toolsMenu')
  const limitedUsage = useNoteGenLimitedUsage()

  async function modelSelectChangeHandler(modelId: string) {
    const nextModel = groupedModels.find(item => item.model.id === modelId)
    const previousModel = groupedModels.find(item => item.model.id === primaryModel)
    const nextName = noteGenModelDisplayName(nextModel?.model.model || modelId, nextModel?.configKey === 'note-gen-free', limitedUsage.activeModelName)
    const previousName = noteGenModelDisplayName(previousModel?.model.model || primaryModel, previousModel?.configKey === 'note-gen-free', limitedUsage.activeModelName)
    const result = await changePrimaryChatModel({
      modelId,
      modelName: nextName,
      previousModelName: previousName,
    })
    if (result.changed && result.hasConversationHistory) {
      toast({
        title: result.appliesNextTurn
          ? t('nextTurn', { model: nextName })
          : t('changed', {
              from: previousName,
              to: nextName,
            }),
        description: result.appliesNextTurn
          ? t('changeWarning')
          : t('continuityWarning'),
      })
    }
  }

  function handleSetOpen(isOpen: boolean) {
    setOpen(isOpen)
  }

  // 监听 aiModelList 变化，处理新的模型配置结构
  useEffect(() => {
    setGroupedModels(collectGroupedChatModels(aiModelList))
  }, [aiModelList])

  // 按配置分组模型
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
  const selectedModelLabel = selectedModel?.model.model || t('noModel')
  const selectedDisplayName = noteGenModelDisplayName(selectedModelLabel, selectedModel?.configKey === 'note-gen-free', limitedUsage.activeModelName)
  const displayedModelLabel = appliesNextTurn
    ? `${agentState.activeModelName || agentState.activeModelId} → ${selectedDisplayName}`
    : selectedDisplayName

  return (
    <Popover open={open} onOpenChange={handleSetOpen}>
      <PopoverTrigger asChild>
        {display === 'status' ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled}
            className="h-5 min-w-0 max-w-80 gap-1 px-1 text-xs font-normal text-muted-foreground"
            aria-label={t('tooltip')}
            title={displayedModelLabel}
          >
            {selectedModel ? <BotMessageSquare data-icon="inline-start" /> : <BotOff data-icon="inline-start" />}
            <span className="truncate">
              {appliesNextTurn && `${agentState.activeModelName || agentState.activeModelId} → `}
              {selectedDisplayName}
            </span>
            {appliesNextTurn && <Badge variant="secondary">{t('nextTurnBadge')}</Badge>}
          </Button>
        ) : display === 'panel' ? (
          <ChatToolItem
            icon={selectedModel ? BotMessageSquare : BotOff}
            title={tTools('model.title')}
            description={appliesNextTurn ? t('nextTurn', { model: selectedDisplayName }) : tTools('model.description')}
            disabled={disabled}
            value={
              <span title={displayedModelLabel}>
                {appliesNextTurn && `${agentState.activeModelName || agentState.activeModelId} → `}
                {selectedDisplayName}
              </span>
            }
          />
        ) : (
          <div className="hidden md:block">
            <TooltipButton
              icon={groupedModels.length > 0 ? <BotMessageSquare className="size-4" /> : <BotOff className="size-4" />}
              tooltipText={t('tooltip')}
              size="icon"
            />
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={display === 'icon' ? 'center' : 'start'}
        side={display === 'panel' ? 'right' : undefined}
        className="w-[400px] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command>
          <CommandInput placeholder={t('placeholder')} className="h-9" />
          <CommandList className="min-w-0 overflow-x-hidden">
            <CommandEmpty>{t('noModel')}</CommandEmpty>
            {Object.entries(groupedByConfig).map(([configTitle, models]) => (
              <CommandGroup key={configTitle} heading={configTitle}>
                {models.map((item) => (
                  <CommandItem
                    className="min-w-0"
                    key={item.model.id}
                    value={item.model.id}
                    data-checked={primaryModel === item.model.id}
                    onSelect={(currentValue) => {
                      modelSelectChangeHandler(currentValue)
                      setOpen(false)
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{noteGenModelDisplayName(item.model.model, item.configKey === 'note-gen-free', limitedUsage.activeModelName)}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

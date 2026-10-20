import * as React from "react"
import { useEffect, useState } from "react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import { BotMessageSquare, BotOff, ChevronRight } from "lucide-react"
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
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/hooks/use-toast"
import { useNoteGenLimitedUsage } from '@/hooks/use-notegen-limited-usage'
import { NoteGenModelLabel, noteGenModelDisplayName } from '@/components/notegen-model-label'
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
              <NoteGenModelLabel model={selectedModelLabel} builtin={selectedModel?.configKey === 'note-gen-free'} limitedName={limitedUsage.activeModelName} limitedDetail={limitedUsage.detail} />
            </span>
            {appliesNextTurn && <Badge variant="secondary">{t('nextTurnBadge')}</Badge>}
          </Button>
        ) : display === 'panel' ? (
          <Item asChild size="sm" className="min-h-10 flex-nowrap py-2 cursor-pointer hover:bg-muted">
            <button type="button" disabled={disabled}>
              <ItemContent className="min-w-0">
                <ItemTitle className="min-w-0 truncate">{t('tooltip')}</ItemTitle>
              </ItemContent>
              <ItemActions className="shrink-0">
                <span className="max-w-64 truncate text-xs text-muted-foreground" title={displayedModelLabel}>
                  {appliesNextTurn && `${agentState.activeModelName || agentState.activeModelId} → `}
                  <NoteGenModelLabel model={selectedModelLabel} builtin={selectedModel?.configKey === 'note-gen-free'} limitedName={limitedUsage.activeModelName} limitedDetail={limitedUsage.detail} />
                </span>
                {appliesNextTurn && <Badge variant="secondary">{t('nextTurnBadge')}</Badge>}
                <ChevronRight />
              </ItemActions>
            </button>
          </Item>
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
          <CommandList>
            <CommandEmpty>{t('noModel')}</CommandEmpty>
            {Object.entries(groupedByConfig).map(([configTitle, models]) => (
              <CommandGroup key={configTitle} heading={configTitle}>
                {models.map((item) => (
                  <CommandItem
                    key={item.model.id}
                    value={item.model.id}
                    data-checked={primaryModel === item.model.id}
                    onSelect={(currentValue) => {
                      modelSelectChangeHandler(currentValue)
                      setOpen(false)
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium"><NoteGenModelLabel model={item.model.model} builtin={item.configKey === 'note-gen-free'} limitedName={limitedUsage.activeModelName} limitedDetail={limitedUsage.detail} /></span>
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

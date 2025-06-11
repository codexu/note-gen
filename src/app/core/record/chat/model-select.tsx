import * as React from "react"
import { useEffect, useState } from "react"
import { AiConfig } from "../../setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
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
import {
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { TooltipButton } from "@/components/tooltip-button"

export function ModelSelect() {
  const [list, setList] = useState<AiConfig[]>([])
  const { aiType, setAiType, setAiTitle, setModel, setApiKey, setBaseURL } = useSettingStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.modelSelect')

  async function initModelList() {
    const store = await Store.load('store.json');
    const models = await store.get<AiConfig[]>('aiModelList')
    if (!models) return
    const filteredModels = models.filter(item => {
      return item.apiKey && item.model && item.baseURL
    })
    setList(filteredModels)
  }

  async function modelSelectChangeHandler(e: string) {
    setAiType(e)
    const store = await Store.load('store.json');
    store.set('aiType', e)
    const model = list.find(item => item.key === e)
    if (!model) return
    store.set('model', model.model)
    setModel(model.model || '')
    store.set('apiKey', model.apiKey)
    setApiKey(model.apiKey || '')
    store.set('baseURL', model.baseURL)
    setBaseURL(model.baseURL || '')
    store.set('aiTitle', model.title || '')
    setAiTitle(model.title || '')
  }

  useEffect(() => {
    initModelList()
  }, [])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="hidden lg:block">
          <TooltipButton
            icon={list.length > 0 ? <BotMessageSquare className="size-4" /> : <BotOff className="size-4" />}
            tooltipText={t('tooltip')}
            size="icon"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0">
        <Command>
          <CommandInput placeholder={t('placeholder')} className="h-9" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {list.filter(item => item.modelType === 'chat' || !item.modelType).map((item) => (
                <CommandItem
                  key={item.key}
                  value={item.key}
                  onSelect={(currentValue) => {
                    modelSelectChangeHandler(currentValue)
                    setOpen(false)
                  }}
                >
                  {`${item.model}(${item.title})`}
                  <Check
                    className={cn(
                      "ml-auto",
                      aiType === item.key ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

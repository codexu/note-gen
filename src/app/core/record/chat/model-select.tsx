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
  const { primaryModel, setPrimaryModel, aiModelList } = useSettingStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.modelSelect')

  async function modelSelectChangeHandler(key: string) {
    setPrimaryModel(key)
    const store = await Store.load('store.json');
    store.set('primaryModel', key)
  }

  // 监听 aiModelList 变化，实时更新本地列表
  useEffect(() => {
    if (aiModelList && aiModelList.length > 0) {
      const filteredModels = aiModelList.filter(item => {
        return item.model && item.baseURL
      })
      setList(filteredModels)
    }
  }, [aiModelList])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="hidden md:block">
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
                      primaryModel === item.key ? "opacity-100" : "opacity-0"
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

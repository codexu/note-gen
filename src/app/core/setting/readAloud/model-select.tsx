import * as React from "react"
import { useEffect, useState } from "react"
import { AiConfig } from "../../setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import { ChevronsUpDown, Headphones, Volume2, X } from "lucide-react"
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { TooltipButton } from "@/components/tooltip-button"
import { SettingPanel } from "../components/setting-base"

export function ModelSelect() {
  const [list, setList] = useState<AiConfig[]>([])
  const { setAudioModel } = useSettingStore()
  const [model, setModel] = useState<string>('')
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('settings.defaultModel')
  const tReadAloud = useTranslations('settings.readAloud')

  function setPrimaryModelHandler(primaryModel: string) {
    setAudioModel(primaryModel)
  }

  async function initModelList() {
    const store = await Store.load('store.json');
    const models = await store.get<AiConfig[]>('aiModelList')
    if (!models) return
    const filteredModels = models.filter(item => {
      return item.model && item.baseURL
    })
    setList(filteredModels)
    const primaryModel = await store.get<string>('audioPrimaryModel')
    if (!primaryModel) return
    setModel(primaryModel)
    setPrimaryModelHandler(primaryModel)
  }

  async function modelSelectChangeHandler(e: string) {
    setPrimaryModelHandler(e)
    const store = await Store.load('store.json');
    store.set('audioPrimaryModel', e)
    setModel(e)
  }

  async function resetDefaultModel() {
    const store = await Store.load('store.json');
    store.set('audioModel', '')
    setPrimaryModelHandler('')
    setModel('')
  }

  useEffect(() => {
    initModelList()
  }, [])
  return (
    <>
      {
        !model && <Alert variant="destructive" className="mb-4">
          <Headphones />
          <AlertTitle>{tReadAloud('alert.title')}</AlertTitle>
          <AlertDescription>
            {tReadAloud('alert.description')}
          </AlertDescription>
        </Alert>
      }
      <SettingPanel title={tReadAloud('options.audioModel.title')} desc={tReadAloud('options.audioModel.desc')} icon={<Volume2 className="size-4" />}>
        <Popover open={open} onOpenChange={setOpen}>
          <div className="flex gap-2">
            <PopoverTrigger asChild>
              <div className="flex-1 overflow-hidden">
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="w-full lg:w-[280px] justify-between"
                >
                  {model
                    ? `${list.find((item) => item.key === model)?.model}(${list.find((item) => item.key === model)?.title})`
                    : tReadAloud('noModel')}
                  <ChevronsUpDown className="opacity-50" />
                </Button>
              </div>
            </PopoverTrigger>
            <TooltipButton
              disabled={!model}
              icon={<X className="h-4 w-4" />}
              onClick={resetDefaultModel}
              variant="default"
              tooltipText={t('tooltip')}
            />
          </div>
          <PopoverContent align="end" className="p-0">
            <Command>
              <CommandInput placeholder={t('placeholder')} className="h-9" />
              <CommandList>
                <CommandEmpty>No model found.</CommandEmpty>
                <CommandGroup>
                  {list.filter(item => item.modelType === 'audio').map((item) => (
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
                          model === item.key ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </SettingPanel>
    </>
  )
}

import * as React from "react"
import { useEffect, useState } from "react"
import { AiConfig } from "../../setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import { ChevronsUpDown, X } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { TooltipButton } from "@/components/tooltip-button"

export function ModelSelect({modelKey}: {modelKey: string}) {
  const [list, setList] = useState<AiConfig[]>([])
  const { setEmbeddingModel, setRerankingModel } = useSettingStore()
  const [model, setModel] = useState<string>('')
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('settings.defaultModel')

  function setPrimaryModelHandler(primaryModel: string) {
    setModel(primaryModel)
    switch (modelKey) {
      case 'embedding':
        setEmbeddingModel(primaryModel)
        break;
      case 'reranking':
        setRerankingModel(primaryModel)
        break;
      default:
        break;
    }
  }

  async function initModelList() {
    const store = await Store.load('store.json');
    const models = await store.get<AiConfig[]>('aiModelList')
    if (!models) return
    const filteredModels = models.filter(item => {
      return item.model && item.baseURL
    })
    setList(filteredModels)
    const storeKey = modelKey === 'embedding' ? 'embeddingModel' : 
                     modelKey === 'reranking' ? 'rerankingModel' : 
                     `${modelKey}Model`
    const primaryModel = await store.get<string>(storeKey)
    if (!primaryModel) return
    setPrimaryModelHandler(primaryModel)
  }

  async function modelSelectChangeHandler(e: string) {
    setPrimaryModelHandler(e)
    const store = await Store.load('store.json');
    const storeKey = modelKey === 'embedding' ? 'embeddingModel' : 
                     modelKey === 'reranking' ? 'rerankingModel' : 
                     modelKey === 'primaryModel' ? 'primaryModel' :
                     `${modelKey}Model`
    store.set(storeKey, e)
  }

  async function resetDefaultModel() {
    const store = await Store.load('store.json');
    const storeKey = modelKey === 'embedding' ? 'embeddingModel' : 
                     modelKey === 'reranking' ? 'rerankingModel' : 
                     modelKey === 'primaryModel' ? 'primaryModel' :
                     `${modelKey}Model`
    store.set(storeKey, '')
    setPrimaryModelHandler('')
  }

  useEffect(() => {
    initModelList()
  }, [])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex gap-2">
        <PopoverTrigger asChild>
          <div className="flex-1">
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full md:w-[280px] justify-between"
            >
              {model
                ? list.find((item) => item.key === model)?.model
                : t('tooltip')}
              <ChevronsUpDown className="opacity-50" />
            </Button>
          </div>
        </PopoverTrigger>
        <TooltipButton
          disabled={!model}
          icon={<X className="h-4 w-4" />}
          onClick={resetDefaultModel}
          variant="default"
          tooltipText={t('noModel')}
        />
      </div>
      <PopoverContent align="end" className="w-full md:w-[320px] p-0">
        <Command>
          <CommandInput placeholder={t('placeholder')} className="h-9" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {modelKey === 'embedding' && list.filter(item => item.modelType === 'embedding').map((item) => (
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
              {modelKey === 'reranking' && list.filter(item => item.modelType === 'rerank').map((item) => (
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
  )
}

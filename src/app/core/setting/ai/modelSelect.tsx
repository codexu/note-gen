import { useEffect, useState, useRef } from "react";
import useSettingStore from "@/stores/setting";
import { createOpenAIClient } from "@/lib/ai/utils";
import type OpenAI from "openai";
import { ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/responsive-popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AiConfig } from "../config";
import { Store } from "@tauri-apps/plugin-store";
import emitter from "@/lib/emitter";
import { useTranslations } from "next-intl";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

export default function ModelSelect(
  { model, setModel, aiConfig }:
  { model: string, setModel?: (model: string) => void, aiConfig?: AiConfig }
) {
  const [loading, setLoading] = useState(false)
  const { currentAi } = useSettingStore()
  const [list, setList] = useState<OpenAI.Models.Model[]>([])
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState<string>("") 
  const currentRequestIdRef = useRef<number>(0)
  const t = useTranslations('settings.ai')
  
  // 检查输入的模型是否存在于列表中
  const modelExists = (value: string) => {
    return list.some(item => item.id.toLowerCase() === value.toLowerCase());
  }

  async function initModelList() {
    const store = await Store.load('store.json')
    let model: AiConfig | undefined
    
    if (aiConfig) {
      // 如果传入了aiConfig，直接使用
      model = aiConfig
    } else {
      // 否则从store中获取当前AI配置
      const aiModelList = await store.get<AiConfig[]>('aiModelList')
      model = aiModelList?.find(item => item.key === currentAi)
    }
    
    if (!model) return
    
    const requestId = ++currentRequestIdRef.current
    const models = await getModels(model, requestId)
    
    if (requestId !== currentRequestIdRef.current) return
    
    if (!models) return
    setList(models)
    
    // 如果没有传入aiConfig，则从store中设置model值
    if (!aiConfig && setModel) {
      const store = await Store.load('store.json')
      const aiModelList = await store.get<AiConfig[]>('aiModelList')
      const modelConfig = aiModelList?.find((item: AiConfig) => item.key === currentAi)
      if (modelConfig) {
        setModel(modelConfig.model || '')
      }
    }
  }

  // 获取模型列表
  async function getModels(model: AiConfig, requestId: number) {
    try {
      setLoading(true)
      if (requestId !== currentRequestIdRef.current) return null;
      
      const openai = await createOpenAIClient(model)
      
      if (requestId !== currentRequestIdRef.current) return null;
      
      const models = await openai.models.list()
      
      if (requestId !== currentRequestIdRef.current) return null;
      
      const uniqueModels = models.data.filter((model: OpenAI.Models.Model, index: number) => models.data.findIndex((m: OpenAI.Models.Model) => m.id === model.id) === index)
      return uniqueModels
    } catch {
      return []
    } finally {
      if (requestId === currentRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  async function syncModelList(value: string) {
    // 使用传递的setModel回调来更新模型
    if (setModel) {
      setModel(value)
    }
  }

  const handleSelectOrCreate = (value: string) => {
    setOpen(false)
    syncModelList(value)
  }

  const handleInputChange = (value: string) => {
    // 只更新输入值，不做其他处理
    setInputValue(value)
  }

  const handleCustomValue = () => {
    if (inputValue.trim()) {
      setOpen(false)
      syncModelList(inputValue)
    }
  }

  useEffect(() => {
    emitter.on('getSettingModelList', () => {
      setTimeout(() => {
        initModelList()
      }, 500)
    })
    return () => {
      emitter.off('getSettingModelList')
    }
  }, [])

  // 只在初始化和模型变化时设置输入值
  useEffect(() => {
    if (model) {
      setInputValue(model)
    }
  }, [model])

  useEffect(() => {
    setList([])
    setInputValue('')
    // Increment the request ID to cancel any in-progress requests
    currentRequestIdRef.current++;
    initModelList()
  }, [currentAi])
  
  return (<>
    {list.length ? (
        <ResponsivePopover open={open} onOpenChange={setOpen} mobileTitle={t('selectModel')}>
          <ResponsivePopoverTrigger className="w-full" asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="mt-2 w-full justify-between"
            >
              {model
                ? list.find((item) => item.id === model)?.id || model
                : t('selectModel')}
              <ChevronsUpDown />
            </Button>
          </ResponsivePopoverTrigger>
          <ResponsivePopoverContent className="w-[300px] p-0" align="start">
            <Command className="w-full">
              <CommandInput
                placeholder={t('searchModels')}
                value={inputValue}
                onValueChange={handleInputChange}
              />
              <CommandList>
                <CommandEmpty>
                  {inputValue.trim() !== "" && !modelExists(inputValue) ? (
                    <div className="py-6 text-center text-sm">
                      <Button 
                        variant="ghost" 
                        className="text-sm w-full" 
                        onClick={handleCustomValue}
                      >
                        Use &quot;{inputValue}&quot;
                      </Button>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-sm">{t('noModelResults')}</div>
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {list.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      data-checked={model === item.id}
                      onSelect={() => handleSelectOrCreate(item.id)}
                      className="text-sm py-2 cursor-pointer"
                    >
                      {item.id}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </ResponsivePopoverContent>
        </ResponsivePopover>
      ) :
        <div className="flex flex-col gap-2">
          <InputGroup>
            <InputGroupInput
              value={model}
              onChange={(event) => syncModelList(event.target.value)}
              placeholder={t('modelNamePlaceholder')}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={t('refreshModelList')}
                disabled={loading}
                onClick={() => void initModelList()}
              >
                <RefreshCw className={loading ? 'animate-spin' : undefined} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {loading && 
            <div className="flex gap-2 items-center text-xs text-muted-foreground">
              <Loader2 className="animate-spin" />
              <p className="line-clamp-1 flex-1">{t('loadingModels')}</p>
            </div>
          }
        </div>
      }
    </>
  )
}

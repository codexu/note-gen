import { useEffect, useState } from "react";
import useSettingStore from "@/stores/setting";
import { Input } from "@/components/ui/input";
import { createOpenAIClient } from "@/lib/ai";
import OpenAI from "openai";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

export default function ModelSelect(
  { model, setModel }:
  { model: string, setModel: (model: string) => void }
) {
  const [loading, setLoading] = useState(false)
  const { currentAi } = useSettingStore()
  const [list, setList] = useState<OpenAI.Models.Model[]>([])
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState<string>("") 
  
  // 检查输入的模型是否存在于列表中
  const modelExists = (value: string) => {
    return list.some(item => item.id.toLowerCase() === value.toLowerCase());
  }

  async function initModelList() {
    const store = await Store.load('store.json')
    const aiModelList = await store.get<AiConfig[]>('aiModelList')
    const model = aiModelList?.find(item => item.key === currentAi)
    if (!model) return
    const models = await getModels(model)
    if (!models) return
    setList(models)
    
    const modelConfig = aiModelList?.find(item => item.key === currentAi)
    if (!modelConfig) return
    setModel(modelConfig.model || '')
  }

  // 获取模型列表
  async function getModels(model: AiConfig) {
    try {
      setLoading(true)
      const openai = await createOpenAIClient(model)
      const models = await openai.models.list()
      const uniqueModels = models.data.filter((model, index) => models.data.findIndex(m => m.id === model.id) === index)
      return uniqueModels
    } catch {
      return []
    } finally {
      setLoading(false)
    }
  }

  async function syncModelList(value: string) {
    setModel(value)
    const store = await Store.load('store.json')
    const aiModelList = await store.get<AiConfig[]>('aiModelList')
    if (!aiModelList) return
    const modelConfig = aiModelList.find(item => item.key === currentAi)
    if (!modelConfig) return
    modelConfig.model = value
    aiModelList[aiModelList.findIndex(item => item.key === currentAi)] = modelConfig
    await store.set('aiModelList', aiModelList)
  }

  const handleSelectOrCreate = (value: string) => {
    // 只用于列表中的已有模型选择
    // 关闭弹窗并更新模型
    setOpen(false)
    setTimeout(() => {
      syncModelList(value)
    }, 0)
  }

  const handleInputChange = (value: string) => {
    // 只更新输入值，不做其他处理
    setInputValue(value)
  }

  const handleCustomValue = () => {
    if (inputValue.trim()) {
      // 先关闭弹窗，再同步更新model，避免渲染冲突
      setOpen(false)
      // 等待下一个事件循环再更新model值
      setTimeout(() => {
        syncModelList(inputValue)
      }, 0)
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
    initModelList()
  }, [currentAi])
  
  return (<>
    {list.length ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className="w-full" asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="mt-2 w-full justify-between"
            >
              {model
                ? list.find((item) => item.id === model)?.id || model
                : "Select model"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command className="w-full">
              <CommandInput
                placeholder="Search model..."
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
                    <div className="py-6 text-center text-sm">No model found.</div>
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {list.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => handleSelectOrCreate(item.id)}
                      className="text-sm py-2 cursor-pointer"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          model === item.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {item.id}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) :
        <div className="flex gap-2 flex-col">
          <Input 
            value={model} 
            onChange={(e) => syncModelList(e.target.value)} 
            className="w-full mt-2" 
            placeholder="Input model name" 
          />
          {loading && 
            <div className="flex gap-2 items-center text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <p className="line-clamp-1 flex-1">Loading models...</p>
            </div>
          }
        </div>
      }
    </>
  )
}

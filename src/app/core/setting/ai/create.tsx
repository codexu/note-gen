import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { baseAiConfig } from "../config";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BotMessageSquare, ChevronRight, Plus } from "lucide-react";
import { Store } from "@tauri-apps/plugin-store";
import { AiConfig } from "../config";
import * as React from "react"
import { v4 } from 'uuid';
import { AvatarImage } from "@/components/ui/avatar";
import { Avatar } from "@radix-ui/react-avatar";
import useSettingStore from "@/stores/setting";
import { noteGenDefaultModels } from "@/app/model-config";

export default function CreateConfig() {
  const t = useTranslations('settings.ai');
  const { setCurrentAi, setAiModelList } = useSettingStore()

  const [open, setOpen] = useState(false)

  const customModel: AiConfig = {
    key: '',
    baseURL: '',
    title: t('custom'),
    temperature: 0.7,
    topP: 1.0,
  }

  // 添加自定义模型
  async function addCustomModelHandler(model: AiConfig) {
    const store = await Store.load('store.json');
    let aiModelList = await store.get<AiConfig[]>('aiModelList')
    if (!aiModelList) {
      await store.set('aiModelList', [])
      aiModelList = []
    }
    const id = v4()
    const newModel: AiConfig = {
      ...model,
      key: id,
      modelType: 'chat'
    }
    const updatedList = [...aiModelList, newModel]
    setAiModelList(updatedList)
    setCurrentAi(id)
    await store.set('aiModelList', updatedList)
    await store.save()
    setOpen(false)
  }

  // 添加NoteGen默认模型
  async function addNoteGenModelsHandler() {
    const store = await Store.load('store.json');
    let aiModelList = await store.get<AiConfig[]>('aiModelList')
    if (!aiModelList) {
      await store.set('aiModelList', [])
      aiModelList = []
    }

    // 检查现有模型，只添加不存在的模型
    const existingKeys = aiModelList.map(model => model.key)
    const modelsToAdd = noteGenDefaultModels.filter(model => !existingKeys.includes(model.key))
    
    if (modelsToAdd.length === 0) {
      alert('NoteGen 模型已存在，无需重复创建')
      setOpen(false)
      return
    }

    const updatedList = [...aiModelList, ...modelsToAdd]
    setAiModelList(updatedList)
    
    // 设置第一个新添加的模型为当前模型
    if (modelsToAdd.length > 0) {
      setCurrentAi(modelsToAdd[0].key)
    }
    
    await store.set('aiModelList', updatedList)
    await store.save()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <form>
        <DialogTrigger asChild>
          <Button className="mb-8">
            <Plus />{t('create')}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-[650px]">
          <DialogHeader>
            <DialogTitle>{t('create')}</DialogTitle>
            <DialogDescription>
              {t('createDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2">
            <ProviderItem item={customModel} onClick={() => addCustomModelHandler(customModel)}/>
            <ProviderItem 
              item={{
                key: 'notegen-api',
                title: 'NoteGen API',
                icon: 'https://s2.loli.net/2025/06/25/cVMf586WTBYAju4.png'
              }} 
              onClick={() => addNoteGenModelsHandler()}
            />
            {
              baseAiConfig.map((item, index) => (
                <ProviderItem key={index} item={item} onClick={() => addCustomModelHandler(item)}/>
              ))
            }
          </div>
        </DialogContent>
      </form>
    </Dialog>
  )
}

function ProviderItem({item, onClick}: {item: AiConfig, onClick: (model: AiConfig) => void}) {
  return (
    <div onClick={() => onClick(item)} className="h-12 flex items-center rounded-md gap-2 justify-between p-2 border hover:text-third hover:bg-third-foreground cursor-pointer">
        <div className="flex items-center gap-2">
          <div className="size-6 bg-white rounded flex items-center justify-center">
            {item.icon ? 
              <Avatar>
                <AvatarImage className="size-4" src={item.icon || ''} />
              </Avatar>
            : <BotMessageSquare className="size-4 text-primary" />}
          </div>
          <p className="text-sm font-bold">{item.title}</p>
        </div>
        <ChevronRight className="size-4" />
      </div>
    )
}

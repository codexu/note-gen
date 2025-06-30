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
          <div className="overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-2">
            <ProviderItem item={customModel} onClick={() => addCustomModelHandler(customModel)}/>
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

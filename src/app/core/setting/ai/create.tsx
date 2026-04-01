import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { builtinProviderTemplates } from "../config";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BotMessageSquare, ChevronRight, LoaderCircle, Plus, Settings } from "lucide-react";
import { Store } from "@tauri-apps/plugin-store";
import { AiConfig } from "../config";
import * as React from "react"
import { v4 } from 'uuid';
import { AvatarImage } from "@/components/ui/avatar";
import { Avatar } from "@radix-ui/react-avatar";
import useSettingStore from "@/stores/setting";
import { useLocalStorage } from "react-use";
import { useIsMobile } from "@/hooks/use-mobile";
import { isMobileDevice as checkIsMobileDevice } from "@/lib/check";
import { getCachedProviderTemplates, loadProviderTemplates } from "@/lib/ai/provider-templates-runtime";

interface CreateConfigProps {
  hasCustomModels?: boolean;
  onConfigCreated?: (configId: string) => void;
}

// 独立的创建配置对话框组件
function CreateConfigDialog({ open, setOpen, onConfigCreated }: { open: boolean; setOpen: (open: boolean) => void; onConfigCreated?: (configId: string) => void }) {
  const t = useTranslations('settings.ai');
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const { setAiModelList } = useSettingStore()
  const [, setSelectedAiConfig] = useLocalStorage<string>('ai-config-selected', '')
  const [providerTemplates, setProviderTemplates] = useState<AiConfig[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)

  React.useEffect(() => {
    let cancelled = false

    async function initProviderTemplates() {
      try {
        const cachedTemplates = await getCachedProviderTemplates()
        if (!cancelled && cachedTemplates.length > 0) {
          setProviderTemplates(cachedTemplates)
          setLoadingTemplates(false)
        }

        const templates = await loadProviderTemplates(builtinProviderTemplates)
        if (!cancelled) {
          setProviderTemplates(templates)
        }
      } finally {
        if (!cancelled) {
          setLoadingTemplates(false)
        }
      }
    }

    initProviderTemplates()

    return () => {
      cancelled = true
    }
  }, [])

  const customModel: AiConfig = {
    key: '',
    baseURL: '',
    title: t('custom'),
    templateSource: 'custom',
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
      templateKey: model.templateKey || model.key || undefined,
      templateSource: model.templateSource || 'custom',
      modelType: 'chat'
    }
    const updatedList = [newModel, ...aiModelList]
    setAiModelList(updatedList)
    
    // 设置新建的配置为当前选中的配置
    setSelectedAiConfig(id)
    
    await store.set('aiModelList', updatedList)
    await store.save()
    
    // 通知父组件配置已创建
    if (onConfigCreated) {
      onConfigCreated(id)
    }
    
    setOpen(false)
  }

  const content = (
    <>
      <ProviderItem item={customModel} onClick={() => addCustomModelHandler(customModel)}/>
      {loadingTemplates && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <LoaderCircle className="size-4 animate-spin" />
          <span>正在获取供应商模板...</span>
        </div>
      )}
      {!loadingTemplates && providerTemplates.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">供应商模板</p>
          <div className="overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2">
            {providerTemplates.map((item, index) => (
              <ProviderItem key={index} item={item} onClick={() => addCustomModelHandler(item)}/>
            ))}
          </div>
        </>
      )}
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>{t('create')}</DrawerTitle>
            <DrawerDescription>
              {t('createDesc')}
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4 pb-6 overflow-y-auto">
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[650px]">
        <DialogHeader>
          <DialogTitle>{t('create')}</DialogTitle>
          <DialogDescription>
            {t('createDesc')}
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

export default function CreateConfig({ hasCustomModels = false, onConfigCreated }: CreateConfigProps) {
  const t = useTranslations('settings.ai');
  const [open, setOpen] = useState(false)


  if (hasCustomModels) {
    // 有自定义模型时，只显示按钮
    return (
      <div className="mb-6">
        <Button onClick={() => setOpen(true)}>
          <Plus />{t('create')}
        </Button>
        <CreateConfigDialog open={open} setOpen={setOpen} onConfigCreated={onConfigCreated} />
      </div>
    )
  }

  // 没有自定义模型时，显示完整的Card
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {t('createSection.title')}
        </CardTitle>
        <CardDescription>
          {t('createSection.descWithoutModels')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => setOpen(true)}>
          <Plus />{t('create')}
        </Button>
        <CreateConfigDialog open={open} setOpen={setOpen} onConfigCreated={onConfigCreated} />
      </CardContent>
    </Card>
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

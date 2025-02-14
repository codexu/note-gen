import { SquareMIcon, SquareSplitHorizontal, ViewIcon } from "lucide-react";
import { ExposeParam } from "md-editor-rt";
import { RefObject, useEffect, useState } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Store } from "@tauri-apps/plugin-store";
import { _t } from '@/locales/index';

export default function Preview({mdRef}: {mdRef: RefObject<ExposeParam>}) {

  const [defaultType, setDefaultType] = useState('code')

  const previewTypes = [
    {type: 'code', name: _t('edit_mode'), icon: <SquareMIcon className="size-4" />},
    {type: 'preview', name: _t('split_mode'), icon: <SquareSplitHorizontal className="size-4" />},
    {type: 'preview-only', name: _t('preview_mode'), icon: <ViewIcon className="size-4" />},
  ]

  async function initType() {
    const store = await Store.load('store.json')
    const type = await store.get<string>('previewType') || 'code'
    setDefaultType(type)
    handler(type)
  }

  async function handler(tab: string) {
    setDefaultType(tab)
    const store = await Store.load('store.json')
    await store.set('previewType', tab)
    switch (tab) {
      case 'code':
        mdRef.current?.togglePreview(false)
        break;
      case 'preview':
        mdRef.current?.togglePreview(true)
        break;
      case 'preview-only':
        mdRef.current?.togglePreviewOnly(true)
        break;
      default:
        break;
    }
    mdRef.current?.focus()
  }

  useEffect(() => {
    initType()
  }, [])

  return (
    <Tabs value={defaultType} className="mx-2" onValueChange={handler}>
      <TabsList className="grid w-full grid-cols-3 gap-0.5">
        {
          previewTypes.map((item, index) => (
            <TabsTrigger className="p-1.5" key={index} value={item.type}>
              {item.icon}
            </TabsTrigger>
          ))
        }
      </TabsList>
    </Tabs>
  )
}

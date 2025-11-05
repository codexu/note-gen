'use client';
import { ImageIcon } from "lucide-react"
import { useTranslations } from 'next-intl';
import { SettingType } from '../components/setting-base';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SquareCheckBig } from "lucide-react"
import { useState } from "react";
import { useEffect } from "react";
import { OcrSetting } from "./ocr";
import { VlmSetting } from "./vlm";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { Switch } from "@/components/ui/switch";
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { Eye } from 'lucide-react';

export default function ImageMethod() {
  const t = useTranslations('settings.imageMethod');
  const tabs = ['ocr', 'vlm']
  const [tab, setTab] = useState<'ocr' | 'vlm'>('ocr')
  const { primaryImageMethod, setPrimaryImageMethod, enableImageRecognition, setEnableImageRecognition } = useSettingStore()

  async function init () {
    const store = await Store.load('store.json')
    const primaryImageMethod = await store.get<'ocr' | 'vlm'>('primaryImageMethod') || 'ocr'
    setTab(primaryImageMethod)
    setPrimaryImageMethod(primaryImageMethod)
  }

  useEffect(() => {
    init()
  }, [])
  
  return (
    <SettingType id="sync" icon={<ImageIcon />} title={t('title')} desc={t('desc')}>
      <Item variant="outline" className="mb-6">
        <ItemMedia variant="icon"><Eye className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('enable.title')}</ItemTitle>
          <ItemDescription>{t('enable.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            checked={enableImageRecognition}
            onCheckedChange={setEnableImageRecognition}
          />
        </ItemActions>
      </Item>

      <Tabs value={tab} onValueChange={(value) => setTab(value as 'ocr' | 'vlm')}>
        <TabsList className="grid grid-cols-2 w-full mb-8">
          {
            tabs.map((item) => (
              <TabsTrigger value={item} key={item} className="flex items-center gap-2">
                {item.toUpperCase()}
                {primaryImageMethod === item && <SquareCheckBig className="size-4" />}
              </TabsTrigger>
            ))
          }
        </TabsList>
        <TabsContent value="ocr">
          <OcrSetting />
        </TabsContent>
        <TabsContent value="vlm">
          <VlmSetting />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}

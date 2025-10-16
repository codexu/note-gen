'use client'
import { Item, ItemGroup, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"


export default function Outline() {
  const t = useTranslations('settings.editor');
  const [enableOutline, setEnableOutline] = useState(false)
  const [outlinePosition, setOutlinePosition] = useState<'left' | 'right'>('left')

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const outlinePosition = await store.get<'left' | 'right'>('outlinePosition') || 'left'
      const enableOutline = await store.get<boolean>('enableOutline') || false
      setEnableOutline(enableOutline)
      setOutlinePosition(outlinePosition)
    }
    init()
  }, [])

  async function setPositionHandler(state: 'left' | 'right') {
    const store = await Store.load('store.json');
    await store.set('outlinePosition', state)
    setOutlinePosition(state)
  }

  async function setEnableOutlineHandler(state: boolean) {
    const store = await Store.load('store.json');
    await store.set('enableOutline', state)
    setEnableOutline(state)
  }

  return <ItemGroup className="gap-4">
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('outlineEnable')}</ItemTitle>
        <ItemDescription>{t('outlineEnableDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          checked={enableOutline}
          onCheckedChange={setEnableOutlineHandler}
        />
      </ItemActions>
    </Item>
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('outlinePosition')}</ItemTitle>
        <ItemDescription>{t('outlinePositionDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Tabs defaultValue="left" value={outlinePosition} onValueChange={(value) => setPositionHandler(value as 'left' | 'right')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="left">{t('outlinePositionOptions.left')}</TabsTrigger>
            <TabsTrigger value="right">{t('outlinePositionOptions.right')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </ItemActions>
    </Item>
  </ItemGroup>
}
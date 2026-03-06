'use client';
import { Switch } from "@/components/ui/switch";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";

export default function CenteredContent() {
  const t = useTranslations('settings.editor');
  const [state, setState] = useState(false)

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const centeredContent = await store.get<boolean>('centeredContent') || false
      setState(centeredContent)
    }
    init()
  }, [])

  async function setStateHandler(state: boolean) {
    const store = await Store.load('store.json');
    await store.set('centeredContent', state)
    setState(state)
  }

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('centeredContent')}</ItemTitle>
      <ItemDescription>{t('centeredContentDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Switch checked={state} onCheckedChange={setStateHandler}/>
    </ItemActions>
  </Item>
}

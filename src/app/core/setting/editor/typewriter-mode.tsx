import { Switch } from "@/components/ui/switch";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";

export default function TypewriterMode() {
  const t = useTranslations('settings.editor');
  const [state, setState] = useState(false)

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const typewriterMode = await store.get<boolean>('typewriterMode') || false
      setState(typewriterMode)
    }
    init()
  }, [])

  async function setStateHandler(state: boolean) {
    const store = await Store.load('store.json');
    await store.set('typewriterMode', state)
    setState(state)
  }

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('typewriterMode')}</ItemTitle>
      <ItemDescription>{t('typewriterModeDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Switch checked={state} onCheckedChange={setStateHandler}/>
    </ItemActions>
  </Item>
}
import { Switch } from "@/components/ui/switch";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";

export default function LineNumber() {
  const t = useTranslations('settings.editor');
  const [state, setState] = useState(false)

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const enableLineNumber = await store.get<boolean>('enableLineNumber') || false
      setState(enableLineNumber)
    }
    init()
  }, [])

  async function setStateHandler(state: boolean) {
    const store = await Store.load('store.json');
    await store.set('enableLineNumber', state)
    setState(state)
  }

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('enableLineNumber')}</ItemTitle>
      <ItemDescription>{t('enableLineNumberDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Switch checked={state} onCheckedChange={setStateHandler}/>
    </ItemActions>
  </Item>
}
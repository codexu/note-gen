'use client'

import { Switch } from "@/components/ui/switch"
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from "react"
import { Store } from "@tauri-apps/plugin-store"

export default function ShowUndoRedo() {
  const t = useTranslations('settings.editor')
  const [state, setState] = useState(true)

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json')
      const showEditorUndoRedo = await store.get<boolean>('showEditorUndoRedo')
      // 默认开启
      setState(showEditorUndoRedo !== false)
    }
    init()
  }, [])

  async function setStateHandler(state: boolean) {
    const store = await Store.load('store.json')
    await store.set('showEditorUndoRedo', state)
    setState(state)
  }

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('showUndoRedo')}</ItemTitle>
      <ItemDescription>{t('showUndoRedoDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Switch checked={state} onCheckedChange={setStateHandler} />
    </ItemActions>
  </Item>
}

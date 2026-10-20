import { useState } from "react"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { Store } from "@tauri-apps/plugin-store"
import { v4 } from "uuid"

import { Button } from "@/components/ui/button"
import useSettingStore from "@/stores/setting"
import type { AiConfig } from "../config"

interface CreateConfigProps {
  onConfigCreated?: (configId: string) => void
}

export default function CreateConfig({ onConfigCreated }: CreateConfigProps) {
  const t = useTranslations('settings.ai')
  const { setAiModelList } = useSettingStore()
  const [creating, setCreating] = useState(false)

  const addCustomProvider = async () => {
    if (creating) return

    setCreating(true)
    try {
      const store = await Store.load('store.json')
      const aiModelList = await store.get<AiConfig[]>('aiModelList') || []
      const id = v4()
      const newProvider: AiConfig = {
        key: id,
        title: t('custom'),
        baseURL: '',
        templateSource: 'custom',
        modelType: 'chat',
        temperature: 0.7,
        topP: 1.0,
      }
      const updatedList = [newProvider, ...aiModelList]

      await store.set('aiModelList', updatedList)
      await store.save()
      setAiModelList(updatedList)
      onConfigCreated?.(id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Button disabled={creating} onClick={addCustomProvider}>
      <Plus data-icon="inline-start" />{t('create')}
    </Button>
  )
}

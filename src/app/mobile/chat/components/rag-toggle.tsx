"use client"

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Database } from 'lucide-react'
import useVectorStore from '@/stores/vector'
import { checkEmbeddingModelAvailable } from '@/lib/rag'
import { toast } from '@/hooks/use-toast'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function RagToggle() {
  const { isRagEnabled, setRagEnabled } = useVectorStore()
  const t = useTranslations('record.chat.input')
  const [loading, setLoading] = useState(false)

  const handleToggle = async (checked: boolean) => {
    if (!checked) {
      await setRagEnabled(false)
    } else {
      setLoading(true)
      const embeddingModelAvailable = await checkEmbeddingModelAvailable()
      setLoading(false)
      if (!embeddingModelAvailable) {
        toast({
          variant: "destructive",
          description: t('rag.notSupported')
        })
        return
      }
      await setRagEnabled(true)
    }
  }

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <Database className="size-4" />
        <Label className="text-sm font-medium">{t('rag.enabled')}</Label>
      </div>
      <Switch
        checked={isRagEnabled}
        onCheckedChange={handleToggle}
        disabled={loading}
      />
    </div>
  )
}

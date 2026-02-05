"use client"

import { useState } from 'react'
import { Database, DatabaseZap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { TooltipButton } from '@/components/tooltip-button'
import useVectorStore from '@/stores/vector'
import { checkEmbeddingModelAvailable } from '@/lib/rag'
import { toast } from '@/hooks/use-toast'

export function RagSwitch() {
  const { isRagEnabled, setRagEnabled } = useVectorStore()
  const t = useTranslations('record.chat.input')
  const [loading, setLoading] = useState(false)

  const handleToggle = async () => {
    if (isRagEnabled) {
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
    <div>
      <TooltipButton
        icon={isRagEnabled ? <DatabaseZap className="size-4" /> : <Database className="size-4" />}
        tooltipText={isRagEnabled ? t('rag.enabled') : t('rag.disabled')}
        size="icon"
        side="bottom"
        onClick={handleToggle}
        disabled={loading}
        variant="ghost"
      />
    </div>
  )
}

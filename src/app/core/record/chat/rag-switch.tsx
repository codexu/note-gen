'use client'

import { Book, BookOpen, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { TooltipButton } from "@/components/tooltip-button"
import useVectorStore from "@/stores/vector"
import { checkEmbeddingModelAvailable } from "@/lib/rag"
import { toast } from "@/hooks/use-toast"
import { useState } from "react"

export function RagSwitch() {
  const { isRagEnabled, setRagEnabled, isVectorDbEnabled, setVectorDbEnabled } = useVectorStore()
  const t = useTranslations('record.chat.input')
  const [loading, setLoading] = useState(false)

  // 处理开关点击
  const handleClick = async () => {
    if (isRagEnabled) {
      // 如果已启用，则禁用
      await setRagEnabled(false)
    } else {
      // 向量模型
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
      // 如果未启用且向量数据库已启用，则启用RAG
      if (isVectorDbEnabled) {
        await setRagEnabled(true)
      } else {
        // 如果向量数据库未启用，则先启用向量数据库
        await setVectorDbEnabled(true)
        // 然后启用RAG
        await setRagEnabled(true)
      }
    }
  }

  return (
    <div>
      <TooltipButton
        variant="ghost"
        size="icon"
        icon={
          loading ? (
            <Loader2 className="animate-spin" />
          ) : (
            isRagEnabled ? (
              <BookOpen />
            ) : (
              <Book />
            )
          )
        }
        tooltipText={isRagEnabled ? t('rag.enabled') : t('rag.disabled')}
        onClick={handleClick}
      />
    </div>
  )
}

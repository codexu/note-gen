import { TooltipButton } from "@/components/tooltip-button";
import { fetchAiStreamToken } from "@/lib/ai/chat";
import emitter from "@/lib/emitter";
import useSettingStore from "@/stores/setting";
import { MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import Vditor from "vditor";
import useArticleStore from "@/stores/article";
import { useRef, useEffect } from "react";

export default function Question({editor, value}: {editor?: Vditor, value?: string}) {
  const { primaryModel } = useSettingStore()
  const t = useTranslations('article.editor.toolbar.question')
  const { currentArticle } = useArticleStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  
  async function handleBlock() {
    if (!value) return

    // 如果有正在进行的请求，先终止它
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // 创建新的 AbortController
    const currentController = new AbortController()
    abortControllerRef.current = currentController

    emitter.emit('toolbar-reset-selected-text')
    editor?.disabled()
    editor?.insertEmptyBlock('afterend')
    
    try {
      const req = t('promptTemplate', {content: currentArticle, question: value})
      await fetchAiStreamToken(req, (text) => {
        // 检查当前请求是否已被终止
        if (currentController.signal.aborted) {
          return
        }
        // 检查编辑器是否仍然存在且可用
        if (editor?.vditor.element) {
          editor?.insertValue(text, true)
        }
      }, currentController.signal)
    } catch (error) {
      // 如果是因为 abort 导致的错误，不需要处理
      if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Request canceled')) {
        // 静默处理取消请求，不显示任何消息
        return
      } else {
        console.error('Question request failed:', error)
      }
    } finally {
      // 清理 AbortController 引用
      abortControllerRef.current = null
      // 恢复编辑器状态
      editor?.enable()
    }
  }

  useEffect(() => {
    return () => {
      // 组件卸载时终止正在进行的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [])

  return (
    <TooltipButton disabled={!primaryModel} icon={<MessageCircleQuestion />} tooltipText={t('tooltip')} onClick={handleBlock}>
    </TooltipButton>
  )
}

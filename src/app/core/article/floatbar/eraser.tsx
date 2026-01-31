import { TooltipButton } from "@/components/tooltip-button";
import { fetchAiStreamToken } from "@/lib/ai/chat";
import { EraserIcon } from "lucide-react";
import Vditor from "vditor";
import { useTranslations } from "next-intl";
import { useRef, useEffect } from "react";

export default function Eraser({editor, value}: {editor?: Vditor, value?: string}) {
  const t = useTranslations('article.editor.toolbar.eraser')
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

    editor?.deleteValue()
    editor?.disabled()
    
    try {
      const req = t('promptTemplate', {content: value})
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
        console.error('Eraser request failed:', error)
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
    <TooltipButton icon={<EraserIcon />} tooltipText={t('tooltip')} onClick={handleBlock}>
    </TooltipButton>
  )
}
import { fetchAiStreamToken } from "@/lib/ai/chat";
import emitter from "@/lib/emitter";
import { useEffect, useRef } from "react";
import Vditor from "vditor";
import { useTranslations } from "next-intl";

export default function Continue({editor}: {editor?: Vditor}) {
  const t = useTranslations('article.editor.toolbar.continue')
  const abortControllerRef = useRef<AbortController | null>(null)

  async function handler() {
    // 如果有正在进行的请求，先终止它
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // 创建新的 AbortController
    const currentController = new AbortController()
    abortControllerRef.current = currentController

    const button = editor?.vditor.toolbar?.elements?.continue?.childNodes[0] as HTMLButtonElement
    if (button) {
      button.classList.add('vditor-menu--disabled')
    }
    
    const content = editor?.getValue()
    editor?.focus()
    if (!content) {
      if (button) {
        button.classList.remove('vditor-menu--disabled')
      }
      return
    }
    
    const selection = document.getSelection();
    const anchorOffset = selection?.anchorOffset
    const startContent = content.slice(0, anchorOffset);
    const endContent = content.slice(anchorOffset, content.length);
    const req = t('promptTemplate', {
      content: startContent,
      endContent: endContent
    })

    try {
      await fetchAiStreamToken(req, (text) => {
        // 检查当前请求是否已被终止
        if (currentController.signal.aborted) {
          return
        }
        // 检查编辑器是否仍然存在且可用
        if (editor?.vditor.element) {
          editor?.insertValue(text)
        }
      }, currentController.signal)
    } catch (error) {
      // 如果是因为 abort 导致的错误，不需要处理
      if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Request canceled')) {
        // 静默处理取消请求，不显示任何消息
        return
      } else {
        console.error('Continue request failed:', error)
      }
    } finally {
      // 清理 AbortController 引用
      abortControllerRef.current = null
      // 恢复按钮状态
      if (button) {
        button.classList.remove('vditor-menu--disabled')
      }
    }
  }

  useEffect(() => {
    emitter.on('toolbar-continue', handler)
    return () => {
      emitter.off('toolbar-continue', handler)
      // 组件卸载时终止正在进行的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [editor])

  return (
    <></>
  )
}
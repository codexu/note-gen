import { useState, useCallback, useRef } from 'react'
import { fetchCompletion } from '@/lib/ai/completion'

interface UseAiCompletionOptions {
  onAccept?: (completion: string) => void
  onCancel?: () => void
}

export function useAiCompletion(options: UseAiCompletionOptions = {}) {
  const [completion, setCompletion] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const completionRef = useRef<string>('') // 用 ref 存储最新的 completion 值

  // 生成补全内容
  const generateCompletion = useCallback(async (fullContent: string, cursorPosition: number) => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // 提取光标附近的上下文（前 300 字符）
    const contextStart = Math.max(0, cursorPosition - 300)
    const context = fullContent.substring(contextStart, cursorPosition)
    
    // 如果上下文太短，不生成补全
    if (context.trim().length < 10) {
      return
    }

    setIsLoading(true)
    abortControllerRef.current = new AbortController()

    try {
      const result = await fetchCompletion(context, abortControllerRef.current.signal)
      
      if (result) {
        completionRef.current = result
        setCompletion(result)
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[useAiCompletion] Error:', error)
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [])

  // 接受补全
  const acceptCompletion = useCallback(() => {
    const currentCompletion = completionRef.current
    if (currentCompletion) {
      // 先清除预览元素
      const previews = document.querySelectorAll('.ai-completion-preview')
      previews.forEach(preview => preview.remove())
      
      // 调用回调
      options.onAccept?.(currentCompletion)
      
      // 清除状态
      completionRef.current = ''
      setCompletion('')
    }
  }, [options])

  // 取消补全
  const cancelCompletion = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    // 清除预览元素
    const previews = document.querySelectorAll('.ai-completion-preview')
    previews.forEach(preview => preview.remove())
    
    completionRef.current = ''
    setCompletion('')
    setIsLoading(false)
    options.onCancel?.()
  }, [options])

  return {
    completion,
    isLoading,
    generateCompletion,
    acceptCompletion,
    cancelCompletion,
  }
}

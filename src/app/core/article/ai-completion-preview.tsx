import { useEffect } from 'react'

interface AiCompletionPreviewProps {
  completion: string
  isLoading: boolean
  editorElement: HTMLElement | null
}

export function AiCompletionPreview({ completion, isLoading, editorElement }: AiCompletionPreviewProps) {
  useEffect(() => {
    if (!editorElement) return

    // 清除所有之前的补全预览
    const existingPreviews = editorElement.querySelectorAll('.ai-completion-preview')
    existingPreviews.forEach(preview => preview.remove())

    // 只在有补全内容时才显示，不显示加载状态
    if (!completion) return

    // 查找 Vditor 的编辑区域
    const editableArea = editorElement.querySelector('.vditor-ir__marker, .vditor-wysiwyg, .vditor-sv__marker') as HTMLElement
    if (!editableArea) {
      return
    }

    // 获取当前光标位置
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return
    }

    const range = selection.getRangeAt(0)

    // 创建补全预览元素
    const previewSpan = document.createElement('span')
    previewSpan.className = 'ai-completion-preview'
    previewSpan.setAttribute('data-ai-preview', 'true')
    previewSpan.setAttribute('contenteditable', 'false')
    previewSpan.setAttribute('data-type', 'ai-suggestion')
    previewSpan.style.cssText = `
      color: #888;
      opacity: 0.5;
      pointer-events: none;
      user-select: none;
      font-style: italic;
      display: inline;
    `
    
    previewSpan.textContent = completion
    
    // 添加 kbd 样式的提示
    const kbdSpan = document.createElement('kbd')
    kbdSpan.style.cssText = `
      pointer-events: none;
      display: inline-flex;
      height: 1.25rem;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      border-radius: 0.25rem;
      border: 1px solid hsl(var(--border));
      background-color: hsl(var(--muted));
      padding: 0 0.375rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: hsl(var(--muted-foreground));
      opacity: 0.8;
      margin-left: 0.5rem;
      margin-right: 0.5rem;
      vertical-align: middle;
      line-height: 1;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    `
    kbdSpan.textContent = 'Tab'
    previewSpan.appendChild(kbdSpan)

    // 在光标位置插入预览
    try {
      const newRange = range.cloneRange()
      newRange.collapse(false) // 到范围末尾
      newRange.insertNode(previewSpan)

      // 不移动光标，保持在原位置
      selection.removeAllRanges()
      selection.addRange(range)
    } catch (error) {
      console.error('[AiCompletionPreview] Error inserting preview:', error)
    }

    // 清理函数
    return () => {
      const previews = editorElement.querySelectorAll('.ai-completion-preview')
      previews.forEach(preview => preview.remove())
    }
  }, [completion, isLoading, editorElement])

  return null
}

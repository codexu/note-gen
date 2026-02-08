'use client'

import { Editor } from '@tiptap/react'
import { Sparkles, Database } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ExportMenu } from './export-menu'
import { SyncStatus } from './sync-status'
import useVectorStore from '@/stores/vector'
import { cn } from '@/lib/utils'

interface FooterBarProps {
  editor: Editor
  aiCompletionEnabled: boolean
  onToggleAICompletion: (enabled: boolean) => void
}

export function FooterBar({
  editor,
  aiCompletionEnabled,
  onToggleAICompletion
}: FooterBarProps) {
  const [characterCount, setCharacterCount] = useState({ characters: 0, words: 0 })
  const { isProcessing, lastProcessTime, processAllDocuments } = useVectorStore()
  const [isHoveringVector, setIsHoveringVector] = useState(false)

  // Update character count
  useEffect(() => {
    if (!editor) return

    const updateCount = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storage = editor.storage as any
      const chars = storage.characterCount?.characterCount?.() || 0
      const words = storage.characterCount?.words?.() || 0
      setCharacterCount({ characters: chars, words })
    }

    updateCount()
    editor.on('update', updateCount)
    editor.on('selectionUpdate', updateCount)

    return () => {
      editor.off('update', updateCount)
      editor.off('selectionUpdate', updateCount)
    }
  }, [editor])

  // Format last process time
  const formatLastProcessTime = (timestamp: number | null) => {
    if (!timestamp) return '未处理'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return '刚刚'
    if (diffMins < 60) return `${diffMins} 分钟前`
    if (diffHours < 24) return `${diffHours} 小时前`
    return `${diffDays} 天前`
  }

  const handleVectorProcess = useCallback(async () => {
    if (!isProcessing) {
      await processAllDocuments()
    }
  }, [isProcessing, processAllDocuments])

  return (
    <div className="h-6 flex items-center justify-between px-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[10px] text-[hsl(var(--muted-foreground))]">
      {/* Left side: Character/Word count */}
      <div className="flex items-center gap-2">
        <span>{characterCount.words} 字</span>
        <span className="text-[hsl(var(--border))]">/</span>
        <span>{characterCount.characters} 字符</span>
      </div>

      {/* Center: Sync Status & AI Completion Toggle */}
      <div className="flex items-center gap-2">
        {/* Sync Status */}
        <SyncStatus editor={editor} />

        {/* AI Completion Toggle */}
        <button
          onClick={() => onToggleAICompletion(!aiCompletionEnabled)}
          className={cn(
            'flex items-center gap-0.5 px-1.5 rounded transition-colors',
            aiCompletionEnabled
              ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
              : 'hover:bg-[hsl(var(--muted))]'
          )}
          title={aiCompletionEnabled ? 'AI 补全已启用' : 'AI 补全已禁用'}
        >
          <Sparkles size={10} />
          <span>AI</span>
        </button>

        {/* Vector Database Status */}
        <div
          className="relative"
          onMouseEnter={() => setIsHoveringVector(true)}
          onMouseLeave={() => setIsHoveringVector(false)}
        >
          <button
            onClick={handleVectorProcess}
            disabled={isProcessing}
            className={cn(
              'flex items-center gap-0.5 px-1.5 rounded transition-colors',
              isProcessing
                ? 'opacity-50 cursor-wait'
                : 'hover:bg-[hsl(var(--muted))]'
            )}
            title="点击重新计算向量"
          >
            <Database size={10} className={cn(isProcessing && 'animate-spin')} />
            <span>知识库</span>
          </button>

          {/* Hover tooltip */}
          {isHoveringVector && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-[hsl(var(--foreground))] text-[hsl(var(--background))] rounded text-[10px] whitespace-nowrap">
              {isProcessing
                ? '正在计算向量...'
                : `最后更新: ${formatLastProcessTime(lastProcessTime)}`}
            </div>
          )}
        </div>
      </div>

      {/* Right side: Export Menu */}
      <ExportMenu editor={editor} />
    </div>
  )
}

export default FooterBar

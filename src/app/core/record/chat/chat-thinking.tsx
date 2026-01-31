import { Chat } from "@/db/chats";
import { useState, useEffect, useRef } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ChatThinking({chat}: { chat: Chat }) {
  const t = useTranslations()
  const thinkingContent = chat.thinking || ''
  const isThinking = !chat.content && !!chat.thinking // 还在思考中（有 thinking 但没有 content）
  
  const [isExpanded, setIsExpanded] = useState(isThinking)
  const contentRef = useRef<HTMLDivElement>(null)
  
  // 当思考状态改变时，自动展开或折叠
  useEffect(() => {
    if (isThinking) {
      setIsExpanded(true)
    } else {
      setIsExpanded(false)
    }
  }, [isThinking])
  
  // 思考内容更新时，自动滚动到底部
  useEffect(() => {
    if (isThinking && isExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [thinkingContent, isThinking, isExpanded])
  
  if (!chat.thinking) {
    return null
  }

  // 提取标题（第一行或前50个字符）
  const extractTitle = (text: string): string => {
    const firstLine = text.split('\n')[0]
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...'
    }
    return firstLine || text.substring(0, 50) + '...'
  }
  
  const title = extractTitle(thinkingContent)
  
  return (
    <div className="w-full space-y-1 mb-2 bg-muted/30 border border-border/50 rounded-lg overflow-hidden">
      {/* 思考卡片 - 单行 */}
      <div
        className={`flex items-center gap-2 py-1.5 px-3 cursor-pointer min-w-0 transition-colors ${isThinking ? 'bg-muted/50' : 'hover:bg-muted/40'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isThinking ? (
          <Loader2 className="size-4 animate-spin text-blue-500 flex-shrink-0" />
        ) : (
          <Brain className="size-4 text-blue-500 flex-shrink-0" />
        )}
        <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">
          {isThinking ? t('ai.thinking') : title}
        </span>
        <ChevronRight className={`size-4 text-muted-foreground flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </div>

      {/* 展开的详细内容 */}
      {isExpanded && (
        <div
          ref={contentRef}
          className="pl-6 pr-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-[250px] overflow-y-auto break-words bg-muted/20"
        >
          {thinkingContent}
        </div>
      )}
    </div>
  )
}
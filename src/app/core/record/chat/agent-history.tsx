import * as React from "react"
import { ChevronRight, Brain } from "lucide-react"

interface AgentHistoryData {
  thought: string
  toolCalls: Array<{
    id: string
    toolName: string
    params: Record<string, any>
    status: 'pending' | 'running' | 'success' | 'error'
    result?: {
      success: boolean
      message?: string
      data?: any
      error?: string
    }
  }>
  iterations: number
}

interface AgentHistoryProps {
  historyJson: string
}

export function AgentHistory({ historyJson }: AgentHistoryProps) {
  const [expandedItems, setExpandedItems] = React.useState<Set<number>>(new Set())

  let history: AgentHistoryData | null = null
  try {
    history = JSON.parse(historyJson)
  } catch {
    return null
  }

  if (!history || !history.thought) {
    return null
  }

  // 将思考内容按 \n\n 分割成多个思考步骤
  const thoughts = history.thought.split('\n\n').filter(t => t.trim())

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedItems)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedItems(newExpanded)
  }

  // 提取思考内容的标题（第一行或前50个字符）
  const extractTitle = (thought: string): string => {
    const firstLine = thought.split('\n')[0]
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...'
    }
    return firstLine || thought.substring(0, 50) + '...'
  }

  return (
    <div className="w-full space-y-1 mb-3">
      {thoughts.map((thought, index) => {
        const isExpanded = expandedItems.has(index)
        const title = extractTitle(thought)
        
        return (
          <div key={index} className="space-y-1">
            {/* 思考卡片 - 单行 */}
            <div 
              className="flex items-center gap-2 py-1.5 px-3 rounded hover:bg-muted/50 cursor-pointer group"
              onClick={() => toggleExpand(index)}
            >
              <Brain className="size-3.5 text-blue-500 flex-shrink-0" />
              <span className="text-xs text-muted-foreground flex-1 break-words">
                {title}
              </span>
              <ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>
            
            {/* 展开的详细内容 */}
            {isExpanded && (
              <div className="pl-6 pr-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap">
                {thought}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

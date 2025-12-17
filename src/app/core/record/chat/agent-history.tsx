import * as React from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useTranslations } from "next-intl"

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
  const t = useTranslations('record.chat.input.agent')
  const [isExpanded, setIsExpanded] = React.useState(false)

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

  return (
    <div className="mb-3 text-sm">
      {/* 思考过程 - 默认折叠 */}
      <div className="mb-2">
        <div 
          className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-950/30 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="text-xs font-medium text-blue-700 dark:text-blue-400 flex-1">
            {t('thinking')} ({thoughts.length})
          </span>
          {isExpanded ? <ChevronUp className="size-3.5 text-blue-700 dark:text-blue-400" /> : <ChevronDown className="size-3.5 text-blue-700 dark:text-blue-400" />}
        </div>
        {isExpanded && (
          <div className="mt-2 space-y-2">
            {thoughts.map((thought, index) => (
              <div key={index} className="py-2 px-3 text-xs text-blue-900/80 dark:text-blue-100/80 whitespace-pre-wrap bg-blue-50/50 dark:bg-blue-950/10 rounded-md border-l-2 border-blue-300 dark:border-blue-800">
                {thought}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

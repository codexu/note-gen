import * as React from "react"
import { Loader2, ChevronDown, ChevronUp } from "lucide-react"
import useChatStore from "@/stores/chat"
import { useTranslations } from "next-intl"

export function AgentExecutionStatus() {
  const t = useTranslations('record.chat.input.agent')
  const { agentState } = useChatStore()
  const [expandedItems, setExpandedItems] = React.useState<Set<number>>(new Set())

  // 只在 Agent 运行时显示
  if (!agentState.isRunning) {
    return null
  }

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedItems)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedItems(newExpanded)
  }

  return (
    <div className="w-full max-w-3xl mb-4">
      {/* 历史思考过程 */}
      {agentState.thoughtHistory.map((thought, index) => {
        const isExpanded = expandedItems.has(index)
        return (
          <div key={index} className="mb-2">
            <div 
              className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-950/30 transition-colors"
              onClick={() => toggleExpand(index)}
            >
              <span className="text-xs font-medium text-blue-700 dark:text-blue-400 flex-1">
                {t('thinking')} {index + 1}
              </span>
              {isExpanded ? <ChevronUp className="size-3.5 text-blue-700 dark:text-blue-400" /> : <ChevronDown className="size-3.5 text-blue-700 dark:text-blue-400" />}
            </div>
            {isExpanded && (
              <div className="mt-1 py-2 px-3 text-xs text-blue-900/80 dark:text-blue-100/80 whitespace-pre-wrap bg-blue-50/50 dark:bg-blue-950/10 rounded-md">
                {thought}
              </div>
            )}
          </div>
        )
      })}
      
      {/* 当前思考过程 - 默认展开 */}
      {agentState.currentThought && (
        <div className="mb-3 py-2 px-3 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 className="size-3.5 animate-spin text-blue-500" />
            <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
              {t('thinking')}
            </span>
          </div>
          <div className="text-xs text-blue-900/80 dark:text-blue-100/80 whitespace-pre-wrap">
            {agentState.currentThought}
          </div>
        </div>
      )}
    </div>
  )
}

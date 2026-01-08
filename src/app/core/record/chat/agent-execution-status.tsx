import * as React from "react"
import { Loader2, ChevronRight, Brain, CheckCircle, XCircle, Clock, Zap, Eye } from "lucide-react"
import useChatStore from "@/stores/chat"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"

export function AgentExecutionStatus() {
  const t = useTranslations('record.chat.input.agent')
  const { agentState, setAgentState } = useChatStore()
  const [expandedItems, setExpandedItems] = React.useState<Set<number>>(new Set())
  const contentRef = React.useRef<HTMLDivElement>(null)
  const prevThoughtCountRef = React.useRef(0)

  // 当思考历史增加时，确保新增的历史项是折叠的
  React.useEffect(() => {
    const currentCount = agentState.thoughtHistory.length
    if (currentCount > prevThoughtCountRef.current) {
      // 有新的思考历史添加，确保它们不在 expandedItems 中
      // 不需要做任何操作，因为新项默认就不在 Set 中
    }
    prevThoughtCountRef.current = currentCount
  }, [agentState.thoughtHistory.length])

  // 当前思考内容更新时，自动滚动到底部
  React.useEffect(() => {
    if (agentState.currentThought && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [agentState.currentThought])

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

  const handleConfirm = () => {
    if (!agentState.pendingConfirmation) return
    
    const confirmationRecord = {
      toolName: agentState.pendingConfirmation.toolName,
      params: agentState.pendingConfirmation.params,
      status: 'confirmed' as const,
      timestamp: Date.now()
    }
    
    // 确认时保持 isRunning: true，只清除 pendingConfirmation
    setAgentState({ 
      pendingConfirmation: undefined,
      confirmationHistory: [...agentState.confirmationHistory, confirmationRecord],
      isRunning: true  // 明确保持运行状态
    })
  }

  const handleCancel = () => {
    if (!agentState.pendingConfirmation) return
    
    const confirmationRecord = {
      toolName: agentState.pendingConfirmation.toolName,
      params: agentState.pendingConfirmation.params,
      status: 'cancelled' as const,
      timestamp: Date.now()
    }
    
    // 取消时停止 Agent 运行
    setAgentState({ 
      pendingConfirmation: undefined,
      confirmationHistory: [...agentState.confirmationHistory, confirmationRecord],
      isRunning: false
    })
  }

  // 提取思考内容的标题（第一行或前50个字符）
  const extractTitle = (thought: string): string => {
    const firstLine = thought.split('\n')[0]
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...'
    }
    return firstLine || thought.substring(0, 50) + '...'
  }

  // 如果 Agent 运行中但没有任何内容，显示加载状态
  const hasContent = agentState.thoughtHistory.length > 0 || agentState.currentThought

  return (
    <div className="w-full space-y-2">
      {/* 如果没有任何内容，显示加载提示 */}
      {!hasContent && (
        <div className="w-full space-y-1 mb-2 bg-accent border rounded overflow-hidden">
          <div className="flex items-center gap-2 py-1.5 px-3 rounded bg-muted min-w-0">
            <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" />
            <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">{t('running')}</span>
          </div>
        </div>
      )}
      
      {/* 历史思考过程 - 默认折叠 */}
      {agentState.thoughtHistory.map((thought, index) => {
        const isExpanded = expandedItems.has(index)
        const confirmationRecord = agentState.confirmationHistory[index]
        const title = extractTitle(thought)
        
        return (
          <div key={index} className="w-full space-y-1 mb-2 bg-accent border rounded overflow-hidden">
            {/* 思考卡片 - 单行 */}
            <div 
              className="flex items-center gap-2 py-1.5 px-3 rounded cursor-pointer hover:bg-muted/50 min-w-0"
              onClick={() => toggleExpand(index)}
            >
              <Brain className="size-4 text-blue-500 shrink-0" />
              <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">
                {title}
              </span>
              <ChevronRight className={`size-4 text-muted-foreground shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>
            
            {/* 展开的详细内容 */}
            {isExpanded && (
              <div className="pl-6 pr-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-[250px] overflow-y-auto wrap-break-word">
                {thought}
              </div>
            )}
            
            {/* 确认记录 - 单行 */}
            {confirmationRecord && (
              <div className="flex items-center gap-2 py-1.5 px-3 border-t">
                {confirmationRecord.status === 'confirmed' ? (
                  <CheckCircle className="size-4 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="size-4 text-red-500 shrink-0" />
                )}
                <code className="text-sm text-muted-foreground flex-1 wrap-break-word font-mono">
                  {confirmationRecord.toolName}
                </code>
              </div>
            )}
          </div>
        )
      })}
      
      {/* 正在思考的加载状态 */}
      {agentState.isThinking && !agentState.currentThought && (
        <div className="w-full space-y-1 mb-2 bg-accent border rounded overflow-hidden">
          <div className="flex items-center gap-2 py-1.5 px-3 rounded bg-muted min-w-0">
            <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" />
            <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">{t('thinking')}</span>
          </div>
        </div>
      )}
      
      {/* 当前 ReAct 循环 - 展示 Thought、Action、Observation */}
      {(agentState.currentThought || agentState.currentAction || agentState.currentObservation) && (
        <div className="w-full space-y-1 mb-2 bg-accent border rounded overflow-hidden">
          {/* Thought - 思考 */}
          {agentState.currentThought && (
            <>
              <div className="flex items-center gap-2 py-1.5 px-3 rounded bg-muted min-w-0">
                <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" />
                <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">{t('thinking')}</span>
              </div>
              <div 
                ref={contentRef}
                className="pl-6 pr-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-[250px] overflow-y-auto wrap-break-word"
              >
                {agentState.currentThought}
              </div>
            </>
          )}
          
          {/* Action - 行动 */}
          {agentState.currentAction && !agentState.pendingConfirmation && (
            <div className="flex items-center gap-2 py-1.5 px-3 border-t">
              <Zap className="size-4 text-yellow-500 shrink-0" />
              <code className="text-sm text-muted-foreground flex-1 truncate min-w-0 font-mono">{agentState.currentAction}</code>
            </div>
          )}
          
          {/* 确认请求 - 只显示工具名和按钮 */}
          {agentState.pendingConfirmation && (
            <div className="flex items-center gap-2 py-1.5 px-3 border-t">
              <Clock className="size-4 text-orange-500 shrink-0 animate-pulse" />
              <code className="text-sm text-muted-foreground flex-1 truncate min-w-0 font-mono">
                {agentState.pendingConfirmation.toolName}
              </code>
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={handleCancel}
                >
                  <XCircle className="size-4 text-red-500" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={handleConfirm}
                >
                  <CheckCircle className="size-4 text-green-500" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Observation - 观察 */}
          {agentState.currentObservation && (
            <>
              <div className="flex items-center gap-2 py-1.5 px-3 border-t">
                <Eye className="size-4 text-green-500 shrink-0" />
                <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">{t('observation')}</span>
              </div>
              <div className="pl-6 pr-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-[250px] overflow-y-auto wrap-break-word">
                {agentState.currentObservation}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

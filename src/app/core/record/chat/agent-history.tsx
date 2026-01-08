import * as React from "react"
import { ChevronRight, Zap, Eye, CheckCircle, XCircle } from "lucide-react"
import { useTranslations } from "next-intl"

interface ReActStep {
  thought: string
  action?: {
    tool: string
    params: Record<string, any>
  }
  observation?: string
}

interface AgentHistoryData {
  steps?: ReActStep[]  // 新格式：完整的 ReAct 步骤
  thought?: string     // 旧格式：兼容性
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
  const [expandedItems, setExpandedItems] = React.useState<Set<number>>(new Set())

  let history: AgentHistoryData | null = null
  try {
    history = JSON.parse(historyJson)
  } catch {
    return null
  }

  if (!history) {
    return null
  }

  // 优先使用新格式的 steps，如果没有则使用旧格式的 thought
  const steps = history.steps || []
  
  // 兼容旧格式：如果没有 steps 但有 thought，转换为 steps 格式
  if (steps.length === 0 && history.thought) {
    const thoughts = history.thought.split('\n\n').filter(t => t.trim())
    thoughts.forEach(thought => {
      steps.push({ thought })
    })
  }
  
  if (steps.length === 0) {
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

  // 提取思考内容的标题（第一行或前50个字符）
  const extractTitle = (thought: string): string => {
    const firstLine = thought.split('\n')[0]
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...'
    }
    return firstLine || thought.substring(0, 50) + '...'
  }

  return (
    <div className="w-full space-y-2 mb-3">
      {steps.map((step, index) => {
        const isExpanded = expandedItems.has(index)
        const toolCall = history.toolCalls?.[index]
        
        // 使用观察结果作为标题，如果没有则使用思考内容
        const title = step.observation 
          ? (step.observation.length > 50 ? step.observation.substring(0, 50) + '...' : step.observation)
          : extractTitle(step.thought)
        
        // 根据观察结果判断成功或失败
        const isSuccess = step.observation && !step.observation.includes('失败') && !step.observation.includes('错误')
        const StatusIcon = isSuccess ? CheckCircle : XCircle
        const iconColor = isSuccess ? 'text-green-500' : 'text-red-500'
        
        return (
          <div key={index} className="w-full space-y-1 mb-2 bg-accent border rounded overflow-hidden">
            {/* 标题显示观察结果 */}
            <div 
              className="flex items-center gap-2 py-1.5 px-3 rounded cursor-pointer hover:bg-muted/50 min-w-0"
              onClick={() => toggleExpand(index)}
            >
              <StatusIcon className={`size-4 ${iconColor} shrink-0`} />
              <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">
                {title}
              </span>
              <ChevronRight className={`size-4 text-muted-foreground shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>
            
            {/* 展开的详细内容 */}
            {isExpanded && (
              <>
                <div className="pl-6 pr-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-[250px] overflow-y-auto wrap-break-word">
                  {step.thought}
                </div>
                
                {/* Action - 行动 */}
                {step.action && (
                  <div className="flex items-center gap-2 py-1.5 px-3 border-t">
                    <Zap className="size-4 text-yellow-500 shrink-0" />
                    <code className="text-sm text-muted-foreground flex-1 truncate min-w-0 font-mono">
                      {step.action.tool}({JSON.stringify(step.action.params)})
                    </code>
                  </div>
                )}
                
                {/* Observation - 观察 */}
                {step.observation && (
                  <>
                    <div className="flex items-center gap-2 py-1.5 px-3 border-t">
                      <Eye className="size-4 text-green-500 shrink-0" />
                      <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">{t('observation')}</span>
                    </div>
                    <div className="pl-6 pr-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-[250px] overflow-y-auto wrap-break-word">
                      {step.observation}
                    </div>
                  </>
                )}
                
                {/* Tool Call 状态 */}
                {toolCall && (
                  <div className="flex items-center gap-2 py-1.5 px-3 border-t">
                    {toolCall.status === 'success' ? (
                      <CheckCircle className="size-4 text-green-500 shrink-0" />
                    ) : toolCall.status === 'error' ? (
                      <XCircle className="size-4 text-red-500 shrink-0" />
                    ) : null}
                    <code className="text-sm text-muted-foreground flex-1 wrap-break-word font-mono">
                      {toolCall.toolName}
                    </code>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

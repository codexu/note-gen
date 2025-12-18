import * as React from "react"
import { Brain, Zap, CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import useChatStore from "@/stores/chat"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

export function AgentStatus() {
  const t = useTranslations('record.chat.input.agent')
  const { agentState } = useChatStore()
  const [isExpanded, setIsExpanded] = React.useState(false)

  if (!agentState.isRunning && agentState.toolCalls.length === 0) {
    return null
  }

  return (
    <Card className="mb-4 border-primary/20">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* 标题栏 - 可点击折叠/展开 */}
          <div 
            className="flex items-center justify-between cursor-pointer hover:opacity-80"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-2">
              <Loader2 className={`size-4 ${agentState.isRunning ? 'animate-spin' : ''} text-primary`} />
              <span className="text-sm font-medium">
                {agentState.isRunning 
                  ? `${t('running')} (${agentState.currentIteration}/${agentState.maxIterations})` 
                  : `${t('toolCalls')} (${agentState.toolCalls.length})`
                }
              </span>
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </div>

          {/* 展开的详细内容 */}
          {isExpanded && (
            <div className="space-y-3 pt-2 border-t">
              {agentState.currentThought && (
                <div className="flex gap-2">
                  <Brain className="size-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">{t('thinking')}</div>
                    <div className="text-sm">{agentState.currentThought}</div>
                  </div>
                </div>
              )}

              {agentState.currentAction && (
                <div className="flex gap-2">
                  <Zap className="size-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">{t('acting')}</div>
                    <div className="text-sm font-mono">{agentState.currentAction}</div>
                  </div>
                </div>
              )}

              {agentState.currentObservation && (
                <div className="flex gap-2">
                  <CheckCircle className="size-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">{t('observation')}</div>
                    <div className="text-sm">{agentState.currentObservation}</div>
                  </div>
                </div>
              )}

              {agentState.toolCalls.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-muted-foreground mb-2">{t('toolCalls')}</div>
                  <ScrollArea className="h-32">
                    <div className="space-y-2">
                      {agentState.toolCalls.map((call) => (
                        <div key={call.id} className="flex items-center gap-2 text-xs">
                          {call.status === 'pending' && (
                            <Loader2 className="size-3 animate-spin text-gray-400" />
                          )}
                          {call.status === 'running' && (
                            <Loader2 className="size-3 animate-spin text-blue-500" />
                          )}
                          {call.status === 'success' && (
                            <CheckCircle className="size-3 text-green-500" />
                          )}
                          {call.status === 'error' && (
                            <XCircle className="size-3 text-red-500" />
                          )}
                          <Badge variant="outline" className="text-xs">
                            {call.toolName}
                          </Badge>
                          {call.result?.message && (
                            <span className="text-muted-foreground truncate">
                              {call.result.message}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

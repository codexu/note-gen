'use client'

import { McpToolCall } from '@/stores/chat'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

interface McpToolCallCardProps {
  toolCall: McpToolCall
}

export function McpToolCallCard({ toolCall }: McpToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslations('record.mark.mark.chat.mcp')

  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'calling':
        return <Loader2 className="size-4 animate-spin text-yellow-500" />
      case 'success':
        return <CheckCircle2 className="size-4 text-green-500" />
      case 'error':
        return <XCircle className="size-4 text-red-500" />
    }
  }

  return (
    <Card className="p-3 bg-muted/30">
      <div className="space-y-2">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="font-medium text-sm">{t('toolCall')}</span>
            <Badge variant="outline" className="text-xs">
              {toolCall.serverName}
            </Badge>
            <span className="font-medium text-xs text-muted-foreground">{toolCall.toolName}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-6 w-6 p-0"
          >
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>

        {/* 展开内容 */}
        {expanded && (
          <div className="space-y-3 pt-2">
            {/* 参数 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{t('params')}:</span>
              </div>
              <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
                <code className="text-green-600 dark:text-green-400">
                  {JSON.stringify(toolCall.params, null, 2)}
                </code>
              </pre>
            </div>

            {/* 结果 */}
            {toolCall.result && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{t('result')}:</span>
                </div>
                <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
                  <code className={toolCall.status === 'error' ? 'text-red-600 dark:text-red-400' : ''}>
                    {toolCall.result}
                  </code>
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

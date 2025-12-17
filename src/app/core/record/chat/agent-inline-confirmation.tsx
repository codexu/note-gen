import * as React from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle, XCircle, Clock } from "lucide-react"
import { useTranslations } from "next-intl"

interface AgentInlineConfirmationProps {
  toolName: string
  params: Record<string, any>
  status: 'pending' | 'confirmed' | 'cancelled'
  onConfirm: () => void
  onCancel: () => void
}

export function AgentInlineConfirmation({
  toolName,
  params,
  status,
  onConfirm,
  onCancel,
}: AgentInlineConfirmationProps) {
  const t = useTranslations('record.chat.input.agent.confirmation')

  const getStatusIcon = () => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="size-3 text-green-600 dark:text-green-400" />
      case 'cancelled':
        return <XCircle className="size-3 text-red-600 dark:text-red-400" />
      default:
        return <Clock className="size-3 text-muted-foreground" />
    }
  }

  const getStatusText = () => {
    switch (status) {
      case 'confirmed':
        return t('confirmed')
      case 'cancelled':
        return t('cancelled')
      default:
        return t('title')
    }
  }

  return (
    <div className="text-xs text-muted-foreground space-y-1.5 py-1">
      <div className="flex items-center gap-1.5">
        {getStatusIcon()}
        <span>{getStatusText()}</span>
      </div>
      
      <div className="pl-4 space-y-1">
        <div>
          <span className="opacity-60">{t('tool')}:</span>{' '}
          <code className="font-mono opacity-80">{toolName}</code>
        </div>
        
        {Object.keys(params).length > 0 && (
          <div>
            <span className="opacity-60">{t('parameters')}:</span>
            <div className="pl-2 mt-0.5 space-y-0.5">
              {Object.entries(params).map(([key, value]) => (
                <div key={key} className="font-mono opacity-70">
                  {key}: {typeof value === 'string' && value.length > 80 ? value.substring(0, 80) + '...' : JSON.stringify(value)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 只在 pending 状态显示按钮 */}
      {status === 'pending' && (
        <div className="flex gap-2 pl-4 pt-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs px-2"
            onClick={onCancel}
          >
            <XCircle className="size-3 mr-1" />
            {t('cancel')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs px-2"
            onClick={onConfirm}
          >
            <CheckCircle className="size-3 mr-1" />
            {t('confirm')}
          </Button>
        </div>
      )}
    </div>
  )
}

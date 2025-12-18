import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { useTranslations } from "next-intl"

interface AgentConfirmationDialogProps {
  open: boolean
  toolName: string
  params: Record<string, any>
  onConfirm: () => void
  onCancel: () => void
}

export function AgentConfirmationDialog({
  open,
  toolName,
  params,
  onConfirm,
  onCancel,
}: AgentConfirmationDialogProps) {
  const t = useTranslations('record.chat.input.agent.confirmation')

  return (
    <AlertDialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <div className="space-y-3 py-4">
          <div>
            <div className="text-sm font-medium mb-1">{t('tool')}</div>
            <Badge variant="secondary">{toolName}</Badge>
          </div>
          
          {Object.keys(params).length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">{t('parameters')}</div>
              <div className="bg-muted rounded-md p-3 space-y-1">
                {Object.entries(params).map(([key, value]) => (
                  <div key={key} className="text-xs font-mono">
                    <span className="text-muted-foreground">{key}:</span>{' '}
                    <span>{JSON.stringify(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

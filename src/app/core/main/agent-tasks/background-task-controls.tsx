'use client'

// Fork（#30）：對話輸入框旁的兩個按鈕——把目前的指令「丟到背景」，以及打開背景任務清單。
// chat-input.tsx 只掛一行。
import { useTranslations } from 'next-intl'
import { ListTodo, SendToBack } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/hooks/use-toast'
import { agentTaskCenter, useAgentTaskStore } from '@/lib/agent-tasks'

export function BackgroundTaskControls({ text, onSent }: { text: string; onSent: () => void }) {
  const t = useTranslations('agentTasks')
  const openSheet = useAgentTaskStore(state => state.openSheet)
  const waiting = useAgentTaskStore(state => state.tasks.filter(task => task.kind !== 'organize' && task.status === 'awaiting_review').length)
  const running = useAgentTaskStore(state => state.tasks.filter(task => task.status === 'running' || task.status === 'queued').length)
  const prompt = text.trim()

  async function sendToBackground() {
    if (!prompt) return
    try {
      await agentTaskCenter.enqueue({ prompt, kind: 'chat' })
      onSent()
      toast({ title: t('sent.title'), description: t('sent.description') })
    } catch (error) {
      toast({ title: t('sent.failed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" disabled={!prompt} onClick={() => void sendToBackground()} aria-label={t('sendToBackground')}>
            <SendToBack className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('sendToBackground')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="relative size-8" onClick={() => openSheet()} aria-label={t('open')}>
            <ListTodo className="size-4" />
            {(waiting > 0 || running > 0) && (
              <span className={`absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4 ${waiting > 0 ? 'bg-invert text-invert-ink' : 'bg-secondary text-secondary-foreground'}`}>
                {waiting > 0 ? waiting : running}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('open')}</TooltipContent>
      </Tooltip>
    </>
  )
}

'use client'

// Fork（#32）：首頁頂部的快速記錄。Enter 存成 Inbox 裡的一則新筆記；⌘Enter 交給背景任務。
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { agentTaskCenter } from '@/lib/agent-tasks'
import { noteExists, writeNote } from '@/lib/daily/note-io'
import { captureContent, captureFileName, capturePath } from '@/lib/home/capture'
import useDailySettingsStore from '@/stores/daily-settings'

async function saveCapture(text: string, folder: string): Promise<string> {
  const name = captureFileName(text, new Date())
  for (let attempt = 0; attempt < 50; attempt++) {
    const path = capturePath(folder, name, attempt)
    if (await noteExists(path)) continue
    await writeNote(path, captureContent(text))
    return path
  }
  throw new Error('too many captures with the same name')
}

export function CaptureBar() {
  const t = useTranslations('home.capture')
  const inboxFolder = useDailySettingsStore(state => state.inboxFolder)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(toAgent: boolean) {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      if (toAgent) {
        await agentTaskCenter.enqueue({ prompt: value, kind: 'chat' })
        toast({ title: t('sentToAgent') })
      } else {
        const path = await saveCapture(value, inboxFolder)
        toast({ title: t('saved'), description: path })
      }
      setText('')
    } catch (error) {
      toast({ title: t('failed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2.5 focus-within:ring-1 focus-within:ring-ink/50">
      <ChevronRight className="size-4 shrink-0 text-ink" aria-hidden />
      <input
        value={text}
        // 用 readOnly 而不是 disabled：disabled 會讓輸入框失焦，存完無法接著打下一筆
        readOnly={busy}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          void submit(event.metaKey || event.ctrlKey)
        }}
        placeholder={t('placeholder', { folder: inboxFolder })}
        aria-label={t('label')}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{t('hint')}</span>
    </div>
  )
}

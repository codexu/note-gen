'use client'

// Fork（almanac ALMNC-16.2）：v5 底部「記／問」輸入列。Tab 切換模式。
//   記 → 走收集拆分（stores/collect → lib/collect/split），提案出現在右欄「等你定」，收進來的東西出現在「今天收進來」
//   問 → 走隨處對話（打開 AnywhereChatPanel，送出沿用 'quick-prompt-send'，由右側欄的 ChatInput 帶上下文送出）
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'
import { useAnywhereStore } from '@/lib/anywhere/store'
import { extractSchedule } from '@/lib/collect/split'
import { classifyUnifiedRecordInput } from '@/lib/unified-record-input'
import { cn } from '@/lib/utils'
import useCollectStore from '@/stores/collect'
import useSettingStore from '@/stores/setting'

type Mode = 'note' | 'ask'

/** 記模式輸入的辨識：連結、帶日期或時間的短句（任務）、其餘當筆記。 */
export function detectNote(text: string, now: Date): 'task' | 'link' | 'text' | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const kind = classifyUnifiedRecordInput(trimmed)
  if (kind === 'link') return 'link'
  if (kind !== 'text' || trimmed.includes('\n') || Array.from(trimmed).length > 40) return 'text'
  const schedule = extractSchedule(trimmed, now)
  return schedule && (schedule.due || schedule.time) ? 'task' : 'text'
}

export function TodayComposer() {
  const t = useTranslations('todayV3.composer')
  const [mode, setMode] = useState<Mode>('note')
  const [value, setValue] = useState('')
  const chatOpen = useAnywhereStore(state => state.chatOpen)
  const hasModel = useSettingStore(state => Boolean(state.primaryModel))
  const detected = mode === 'note' ? detectNote(value, new Date()) : null

  function submit() {
    const text = value.trim()
    if (!text) return
    if (mode === 'note') {
      void useCollectStore.getState().submit({ kind: classifyUnifiedRecordInput(text) === 'link' ? 'link' : 'text', text })
      toast(t('captured'))
      setValue('')
      return
    }
    const anywhere = useAnywhereStore.getState()
    anywhere.setChatOpen(true)
    if (!hasModel) {
      toast.error(t('noModel'))
      return
    }
    // 等面板掛上、對話串就位後再送（和命令面板「問」的做法一致：事件由右側欄的 ChatInput 處理）
    window.setTimeout(() => emitter.emit('quick-prompt-send', text), 50)
    setValue('')
  }

  return (
    <div
      className={cn(
        'absolute bottom-4 z-10 flex items-center gap-2.5 rounded-md border border-line bg-menu px-2.5 py-1.5 shadow-menu',
        // 隨處對話面板（右下 400px）開著時，輸入列讓到它左邊，免得送出鈕被蓋住
        chatOpen ? 'left-6 w-[min(640px,calc(100%-456px))]' : 'left-1/2 w-[min(640px,calc(100%-48px))] -translate-x-1/2',
      )}
      data-testid="today-v3-composer"
    >
      <div role="group" aria-label={t('modeLabel')} className="flex shrink-0 gap-0.5 rounded-md bg-sunken p-0.5">
        {(['note', 'ask'] as const).map(key => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            onClick={() => setMode(key)}
            className={cn(
              'h-6 cursor-pointer rounded px-2.5 text-[12.5px] transition-colors duration-100 outline-none focus-visible:ring-1 focus-visible:ring-ring/65',
              mode === key ? 'bg-bg font-medium text-ink shadow-sm' : 'text-muted-ink hover:text-ink',
            )}
          >{t(key)}</button>
        ))}
      </div>
      <input
        value={value}
        aria-label={t(mode === 'note' ? 'notePlaceholder' : 'askPlaceholder')}
        placeholder={t(mode === 'note' ? 'notePlaceholder' : 'askPlaceholder')}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault()
            setMode(current => (current === 'note' ? 'ask' : 'note'))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink caret-brand outline-none placeholder:text-faint"
      />
      <span className={cn('shrink-0 rounded-md bg-hover px-[7px] py-px text-[11px] font-semibold text-muted-ink transition-opacity duration-100', detected ? 'opacity-100' : 'opacity-0')} aria-hidden={!detected}>
        {detected ? t(`detect.${detected}`) : ''}
      </span>
      <kbd className="inline-flex shrink-0 rounded-[4px] bg-sunken px-[5px] font-mono text-[10.5px] leading-[18px] text-muted-ink">Tab</kbd>
      <Button size="sm" onClick={submit} aria-disabled={!value.trim()}>{t(mode === 'note' ? 'submitNote' : 'submitAsk')}</Button>
    </div>
  )
}

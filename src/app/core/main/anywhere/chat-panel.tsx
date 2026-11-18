'use client'

// Fork（almanac ALMNC-9）：隨處對話面板（v3 的「問」）。浮在任何頁面上，不必切到對話側欄。
// 不重寫對話：顯示用現有的 ChatContent，送出走既有的 'quick-prompt-send'（右側欄的 ChatInput 一直掛著，
// 由它帶上目前筆記、編輯器選取等上下文並送出）。所以這裡不再掛第二個 ChatInput——它的 emitter 事件
// 和 clipboard 監聽都假設全域只有一份。要附圖、@ 檔案等完整功能時用「移到對話頁」（ALMNC-14：原本是移到右側欄）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { ArrowUp, MessageCircleQuestion, MessagesSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ShortcutKbd } from '@/components/fork/shortcut-kbd'
import emitter from '@/lib/emitter'
import { describeAnywhereContext } from '@/lib/anywhere/context'
import { useAnywhereStore } from '@/lib/anywhere/store'
import useArticleStore from '@/stores/article'
import useChatStore from '@/stores/chat'
import useThreadsStore from '@/stores/threads'
import useSettingStore from '@/stores/setting'
import ChatContent from '../chat/chat-content'

function PanelBody() {
  const t = useTranslations('anywhere.chat')
  const threadsT = useTranslations('threads')
  const reduce = useReducedMotion()
  const close = () => useAnywhereStore.getState().setChatOpen(false)
  const activePath = useArticleStore(state => state.activeFilePath)
  const selectedText = useChatStore(state => state.editorSelectionQuote?.quote ?? '')
  const loading = useChatStore(state => state.loading)
  const hasModel = useSettingStore(state => Boolean(state.primaryModel))
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const context = useMemo(() => describeAnywhereContext({ activePath, selectedText }), [activePath, selectedText])
  const contextLabel = context.kind === 'selection'
    ? t('contextSelection', { title: context.title || t('contextUntitled'), count: context.chars })
    : context.kind === 'note'
      ? t('contextNote', { title: context.title })
      : t('contextNone')

  useEffect(() => {
    const opener = document.activeElement
    const panel = textareaRef.current?.closest('[data-slot="anywhere-chat"]')
    const frame = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      const active = document.activeElement
      if (opener instanceof HTMLElement && opener.isConnected && (active === document.body || panel?.contains(active))) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [])

  const canSend = draft.trim().length > 0 && !loading && hasModel
  const send = () => {
    if (!canSend) return
    emitter.emit('quick-prompt-send', draft.trim())
    setDraft('')
  }

  // 對話頁用的就是同一份對話（useChatStore），所以「移過去」只要打開對話頁，目前這串對話會直接在那裡接著談。
  const moveToThreads = () => {
    useThreadsStore.getState().show()
    close()
  }

  return (
    <motion.div
      role="dialog"
      aria-label={t('title')}
      data-slot="anywhere-chat"
      initial={reduce ? false : { opacity: 0, scale: 0.96, y: 6 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      style={{ transformOrigin: 'bottom right' }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing
          && event.target instanceof Node && event.currentTarget.contains(event.target)) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
      className="fixed right-4 bottom-10 z-40 flex h-[min(520px,calc(100vh-128px))] w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-md border border-line bg-menu text-ink shadow-dialog"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-muted-ink" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-ink" title={contextLabel}>{contextLabel}</span>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-ink" onClick={moveToThreads}>
          <MessagesSquare aria-hidden data-icon="inline-start" />{threadsT('moveFromAnywhere')}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t('close')} onClick={close}><X aria-hidden /></Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><ChatContent /></div>
      <div className="shrink-0 border-t border-line-soft p-2">
        <div className="flex items-end gap-2 rounded-md border border-line-soft bg-bg p-1.5 focus-within:border-line">
          <Textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            placeholder={hasModel ? t('placeholder') : t('noModel')}
            aria-label={t('placeholder')}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            className="max-h-32 min-h-8 flex-1 resize-none border-0 bg-transparent p-1 text-[13px] shadow-none placeholder:text-faint focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button size="icon-sm" aria-label={t('send')} disabled={!canSend} onClick={send}><ArrowUp aria-hidden /></Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-faint">
          <span>{t('hint')}</span>
          <ShortcutKbd shortcut="⌘⇧A" />
        </div>
      </div>
    </motion.div>
  )
}

export function AnywhereChatPanel() {
  const open = useAnywhereStore(state => state.chatOpen)
  return <AnimatePresence>{open ? <PanelBody key="anywhere-chat" /> : null}</AnimatePresence>
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Store } from '@tauri-apps/plugin-store'
import { hasText, readText } from 'tauri-plugin-clipboard-api'
import { useTranslations } from 'next-intl'
import { ThemeProvider } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { applyAppFontFamily } from '@/lib/font-settings'
import { applyThemeColors } from '@/lib/theme-utils'
import { hideQuickRecordWindow, requestQuickRecord, type QuickRecordContext, type QuickRecordRequest } from '@/lib/quick-record-window'

const DRAFT_KEY = 'quick-record-draft'

export default function QuickRecordPage() {
  const t = useTranslations()
  const [context, setContext] = useState<QuickRecordContext | null>(null)
  const [text, setText] = useState('')
  const [tagId, setTagId] = useState(0)
  const [autoRead, setAutoRead] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const textRef = useRef('')
  const tagRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const savingRef = useRef(false)
  const preparingRef = useRef(false)
  const pendingRef = useRef<QuickRecordRequest | null>(null)

  const persistDraft = useCallback(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      text: textRef.current,
      tagId: tagRef.current,
      pending: pendingRef.current,
    }))
  }, [])

  const changeText = useCallback((value: string) => {
    textRef.current = value
    setText(value)
    persistDraft()
  }, [persistDraft])

  const readClipboard = useCallback(async () => {
    // Clipboard access is optional and must never overwrite an existing draft.
    if (textRef.current || pendingRef.current) return
    try {
      if (await hasText()) {
        const value = await readText()
        if (!textRef.current && !pendingRef.current && value) changeText(value)
      }
    } catch (error) {
      console.debug('Quick record clipboard unavailable:', error)
    }
  }, [changeText])

  const prepare = useCallback(async () => {
    if (savingRef.current || preparingRef.current) return
    preparingRef.current = true
    setLoading(true)
    setError('')
    try {
      const response = await requestQuickRecord({ id: crypto.randomUUID(), action: 'prepare' })
      if (!response.context) throw new Error('prepare')
      const next = response.context
      setContext(next)
      setAutoRead(next.autoReadClipboard)
      if (!pendingRef.current) {
        tagRef.current = next.selectedTagId
      }
      setTagId(tagRef.current)
      persistDraft()
      document.documentElement.style.fontSize = `${next.uiScale || 100}%`
      applyAppFontFamily(next.appFontFamily)
      applyThemeColors(next.customThemeColors)
      if (next.autoReadClipboard) await readClipboard()
    } catch {
      setError(t('quickRecordWindow.loadError'))
    } finally {
      preparingRef.current = false
      setLoading(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [persistDraft, readClipboard, t])

  useEffect(() => {
    let disposed = false
    const cleanup: (() => void)[] = []
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
      if (draft && typeof draft.text === 'string' && typeof draft.tagId === 'number') {
        textRef.current = draft.text
        tagRef.current = draft.tagId
        setText(draft.text)
        setTagId(draft.tagId)
        if (draft.pending?.action === 'save' && typeof draft.pending.id === 'string'
          && draft.pending.text === draft.text && draft.pending.tagId === draft.tagId) {
          pendingRef.current = draft.pending
          setUncertain(true)
        }
      }
    } catch {
      // Ignore malformed drafts from older versions.
    }
    const setup = async () => {
      const window = getCurrentWindow()
      await window.setTitle(t('record.mark.text.title'))
      for (const registration of [
        () => window.onCloseRequested(event => {
          event.preventDefault()
          void hideQuickRecordWindow()
        }),
        () => window.listen('quick-record-open', () => { void prepare() }),
      ]) {
        const unlisten = await registration()
        if (disposed) unlisten()
        else cleanup.push(unlisten)
      }
      if (!disposed) await prepare()
    }
    void setup().catch(() => {
      setLoading(false)
      setError(t('quickRecordWindow.loadError'))
    })
    return () => {
      disposed = true
      cleanup.forEach(unlisten => unlisten())
    }
  }, [prepare, t])

  const save = async () => {
    if (savingRef.current || loading || !textRef.current.trim() || !tagRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    const request = pendingRef.current ?? {
      id: crypto.randomUUID(), action: 'save' as const, text: textRef.current, tagId: tagRef.current,
    }
    pendingRef.current = request
    persistDraft()
    let refreshContext = false
    try {
      const response = await requestQuickRecord(request)
      if (!response.saved) {
        if (response.error === 'invalid') {
          pendingRef.current = null
          setUncertain(false)
          persistDraft()
          refreshContext = true
        }
        throw new Error('save')
      }
      pendingRef.current = null
      setUncertain(false)
      changeText('')
      await hideQuickRecordWindow()
    } catch {
      setUncertain(Boolean(pendingRef.current))
      setError(t('quickRecordWindow.saveError'))
    } finally {
      savingRef.current = false
      setSaving(false)
      if (refreshContext) void prepare()
    }
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <main className="flex h-dvh flex-col gap-3 overflow-y-auto bg-background p-4 text-foreground">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <form className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={event => {
          event.preventDefault()
          void save()
        }} onKeyDown={event => {
          if (event.defaultPrevented || event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            void hideQuickRecordWindow()
          } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void save()
          }
        }}>
          <Field className="min-h-24 flex-1">
            <FieldLabel htmlFor="quick-record-text" className="sr-only">{t('record.mark.text.title')}</FieldLabel>
            <Textarea ref={inputRef} id="quick-record-text" className="h-full min-h-24 flex-1 resize-none [field-sizing:fixed]"
              value={text} disabled={saving || uncertain} onChange={event => changeText(event.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
            <Field orientation="horizontal" className="w-auto">
              <Checkbox id="quick-record-clipboard" checked={autoRead} disabled={loading || saving || uncertain}
                onCheckedChange={async checked => {
                  const value = checked === true
                  setAutoRead(value)
                  try {
                    const store = await Store.load('store.json')
                    await store.set('autoReadClipboard', value)
                    await store.save()
                    if (value) await readClipboard()
                  } catch { setError(t('common.error')) }
                }} />
              <FieldLabel htmlFor="quick-record-clipboard">{t('record.mark.text.autoReadClipboard')}</FieldLabel>
            </Field>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{t('record.mark.text.characterCount', { count: text.length })}</span>
              {!context && !loading
                ? <Button type="button" onClick={() => void prepare()}>{t('quickRecordWindow.retry')}</Button>
                : <Button type="submit" disabled={loading || saving || !text.trim() || !tagId}>
                  {(loading || saving) && <Spinner data-icon="inline-start" />}
                  {uncertain ? t('quickRecordWindow.retry') : t('record.mark.text.save')}
                </Button>}
            </div>
          </div>
        </form>
      </main>
    </ThemeProvider>
  )
}

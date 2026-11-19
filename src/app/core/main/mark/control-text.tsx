'use client'

import { usePathname } from 'next/navigation'
import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Textarea } from "@/components/ui/textarea"
import { insertMark } from "@/db/marks"
import useTagStore from "@/stores/tag"
import { CopySlash } from "lucide-react"
import { useEffect, useState, useCallback, useRef, type ChangeEvent } from "react"
import emitter from "@/lib/emitter"
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { hasText, readText } from 'tauri-plugin-clipboard-api'
import { Store } from '@tauri-apps/plugin-store'
import { toast } from '@/hooks/use-toast'
import { RecordSaveTarget } from './record-save-target'
import { useRecordCompletion } from './use-record-completion'
import useSettingStore from '@/stores/setting'
import { getRecordSaveTagIdFromTags } from '@/lib/record-save-target'
import { useInitialSetupStore } from '@/stores/initial-setup'
import { getDesktopOnboardingWorkspaceIdentity, useDesktopOnboardingStore, type CreateRecordOnboardingAttempt } from '@/stores/desktop-onboarding'

interface ControlTextProps {
  setupCapturePath?: '/core/main' | '/mobile/record'
  showTrigger?: boolean
}

export function ControlText({ setupCapturePath, showTrigger = true }: ControlTextProps = {}) {
  const t = useTranslations();
  const pathname = usePathname()
  const captureRequested = useInitialSetupStore(
    state => setupCapturePath === pathname && !state.visible && state.captureRequested,
  )
  const desktopCapture = setupCapturePath === '/core/main' && pathname === setupCapturePath
  const practiceAttemptId = useDesktopOnboardingStore(state => desktopCapture ? state.attempt?.id : undefined)
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('')
  const [creatingTag, setCreatingTag] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autoReadClipboard, setAutoReadClipboard] = useState(true)
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const practiceCaptureRef = useRef<{ attempt: CreateRecordOnboardingAttempt; previousDraft: string } | null>(null)
  const saveInProgress = useRef(false)
  const clipboardReadId = useRef(0)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const completeRecord = useRecordCompletion()

  const { currentTagId, tags, fetchTags, initTags } = useTagStore()
  const [selectedTagId, setSelectedTagId] = useState<number>(currentTagId)

  const closeCapture = useCallback((saved = false) => {
    ++clipboardReadId.current
    const practiceCapture = practiceCaptureRef.current
    practiceCaptureRef.current = null
    if (practiceCapture) {
      setText(practiceCapture.previousDraft)
      const onboarding = useDesktopOnboardingStore.getState()
      if (!saved && onboarding.attempt?.id === practiceCapture.attempt.id) onboarding.cancelAttempt()
    } else if (saved) setText('')
    setOpen(false)
  }, [])

  function handlePracticeTrigger() {
    if (open || saveInProgress.current) return
    const onboarding = useDesktopOnboardingStore.getState()
    const practiceRequest = onboarding.recordRequest
    if (!practiceRequest || onboarding.attempt?.id !== practiceRequest.attempt.id) return
    ++clipboardReadId.current
    practiceCaptureRef.current = { attempt: practiceRequest.attempt, previousDraft: text }
    setText(practiceRequest.sampleText)
    setOpen(true)
    onboarding.consumeRecordRequest(practiceRequest.attempt.id)
  }

  useEffect(() => {
    const practiceCapture = practiceCaptureRef.current
    if (practiceCapture && practiceCapture.attempt.id !== practiceAttemptId && !saveInProgress.current) closeCapture()
  }, [closeCapture, practiceAttemptId])

  useEffect(() => {
    if (captureRequested) {
      setOpen(true)
      useInitialSetupStore.getState().consumeCapture()
    }
  }, [captureRequested])

  // 初始化时从 store 读取设置
  useEffect(() => {
    async function loadSetting() {
      try {
        const store = await Store.load('store.json')
        const savedValue = await store.get<boolean>('autoReadClipboard')
        if (savedValue !== null && savedValue !== undefined) {
          setAutoReadClipboard(savedValue)
        }
      } catch {
        // 忽略加载错误
      }
    }
    loadSetting()
  }, [])

  const readClipboardIntoDraft = useCallback(async () => {
    if (practiceCaptureRef.current) return
    const readId = ++clipboardReadId.current
    try {
      if (await hasText()) {
        const clipboardText = await readText()
        if (clipboardText && readId === clipboardReadId.current) setText(clipboardText)
      }
    } catch {
      // Ignore unreadable clipboard contents.
    }
  }, [])

  // 保存设置到 store
  const handleAutoReadChange = useCallback(async (checked: boolean) => {
    setAutoReadClipboard(checked)
    const shouldReadClipboard = checked && !practiceCaptureRef.current
    const readId = ++clipboardReadId.current
    try {
      const store = await Store.load('store.json')
      await store.set('autoReadClipboard', checked)
    } catch {
      return
    }
    if (shouldReadClipboard && clipboardReadId.current === readId) await readClipboardIntoDraft()
  }, [readClipboardIntoDraft])

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    ++clipboardReadId.current
    setText(event.target.value)
  }

  async function handleSuccess() {
    if (creatingTag || saveInProgress.current) return
    const resetText = text.replace(/'/g, '').trim()

    if (!resetText) {
      toast({
        title: t('common.warning'),
        description: t('record.mark.text.description'),
        variant: 'destructive',
      })
      return
    }

    saveInProgress.current = true
    setSaving(true)
    const practiceAttempt = practiceCaptureRef.current?.attempt
    const isCurrentPractice = async () => practiceAttempt !== undefined
      && await getDesktopOnboardingWorkspaceIdentity() === practiceAttempt.workspaceId
      && useDesktopOnboardingStore.getState().attempt?.id === practiceAttempt.id
    try {
      const store = await Store.load('store.json')
      await store.set('currentTagId', selectedTagId)
      await store.save()

      const result = await insertMark({ tagId: selectedTagId, type: 'text', desc: resetText, content: resetText }, practiceAttempt ? async () => {
        if (!await isCurrentPractice()) throw new Error(t('common.error'))
      } : undefined)
      const markId = Number(result.lastInsertId || 0) || null
      const completedPractice = practiceAttempt && markId && await isCurrentPractice()

      closeCapture(true)
      if (completedPractice && practiceAttempt && markId) {
        useDesktopOnboardingStore.getState().completeRecord(practiceAttempt.id, markId)
      }

      await completeRecord({
        markId,
        tagId: selectedTagId,
        typeLabel: t('record.mark.type.text'),
        revealInRecordSidebar: Boolean(completedPractice),
      })
    } catch (error) {
      console.error('Failed to save text record:', error)
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
    } finally {
      if (practiceAttempt && useDesktopOnboardingStore.getState().attempt?.id !== practiceAttempt.id && practiceCaptureRef.current) {
        closeCapture()
      }
      saveInProgress.current = false
      setSaving(false)
    }
  }

  const handleOpen = useCallback(async (payload?: { prefillText?: string }) => {
    if (practiceCaptureRef.current || saveInProgress.current) return
    setOpen(true)
    if (payload?.prefillText) {
      ++clipboardReadId.current
      setText(payload.prefillText)
    } else if (autoReadClipboard) {
      await readClipboardIntoDraft()
    }
  }, [autoReadClipboard, readClipboardIntoDraft])

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) void handleOpen()
    else if (!saveInProgress.current) closeCapture()
  }, [closeCapture, handleOpen])

  useEffect(() => {
    if (!open) {
      setCreatingTag(false)
      return
    }

    let cancelled = false
    const prepareTags = async () => {
      await initTags()
      await fetchTags()
      if (!cancelled) {
        const tagState = useTagStore.getState()
        const settingState = useSettingStore.getState()
        setSelectedTagId(getRecordSaveTagIdFromTags({
          mode: settingState.recordSaveTargetMode,
          currentTagId: tagState.currentTagId,
          lastTagId: settingState.lastRecordTagId,
          fixedTagId: settingState.fixedRecordTagId,
          tagIds: tagState.tags.map((tag) => tag.id),
        }))
      }
    }

    void prepareTags()
    return () => {
      cancelled = true
    }
  }, [fetchTags, initTags, open])

  useEffect(() => {
    if (!open || isMobile) return

    const focusTimer = window.setTimeout(() => {
      textAreaRef.current?.focus()
    }, 50)

    return () => window.clearTimeout(focusTimer)
  }, [isMobile, open])

  useEffect(() => {
    const handleShortcutOpen = () => {
      void handleOpen()
    }

    emitter.on('quickRecordTextHandler', handleOpen)
    emitter.on('toolbar-shortcut-text', handleShortcutOpen)
    return () => {
      emitter.off('quickRecordTextHandler', handleOpen)
      emitter.off('toolbar-shortcut-text', handleShortcutOpen)
    }
  }, [handleOpen])

  const trigger = showTrigger && (
    <TooltipButton
      buttonId={desktopCapture ? 'onboarding-target-record-text' : undefined}
      icon={<CopySlash />}
      tooltipText={t('record.mark.type.text')}
      onClick={desktopCapture ? handlePracticeTrigger : undefined}
    />
  )

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          {trigger && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}
          <DrawerContent
            onOpenAutoFocus={event => {
              event.preventDefault()
              textAreaRef.current?.focus({ preventScroll: true })
            }}
            onEscapeKeyDown={event => { if (creatingTag) event.preventDefault() }}
          >
            <DrawerHeader>
              <DrawerTitle>{t('record.mark.text.title')}</DrawerTitle>
              <DrawerDescription>
                {t('record.mark.text.description')}
              </DrawerDescription>
            </DrawerHeader>
            <div className="space-y-4 px-4">
              <RecordSaveTarget
                mobile
                selectedTagId={selectedTagId}
                tags={tags}
                onTagChange={setSelectedTagId}
                onCreatingChange={setCreatingTag}
              />
              <Textarea
                ref={textAreaRef}
                id="username"
                rows={10}
                maxRows={24}
                value={text}
                onChange={handleTextChange}
              />
            </div>
            <DrawerFooter className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-read-clipboard-mobile"
                  checked={autoReadClipboard}
                  onCheckedChange={(checked) => handleAutoReadChange(checked === true)}
                />
                <Label
                  htmlFor="auto-read-clipboard-mobile"
                  className="text-sm cursor-pointer"
                >
                  {t('record.mark.text.autoReadClipboard')}
                </Label>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-sm text-zinc-500">{t('record.mark.text.characterCount', { count: text.length })}</p>
                <Button type="submit" disabled={creatingTag || saving} onClick={handleSuccess}>{t('record.mark.text.save')}</Button>
              </div>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
          <DialogContent onEscapeKeyDown={event => { if (creatingTag) event.preventDefault() }} className="min-w-full md:min-w-[650px]">
            <DialogHeader>
              <DialogTitle>{t('record.mark.text.title')}</DialogTitle>
              <DialogDescription>
                {t('record.mark.text.description')}
              </DialogDescription>
            </DialogHeader>
            <RecordSaveTarget
              selectedTagId={selectedTagId}
              tags={tags}
              onTagChange={setSelectedTagId}
              onCreatingChange={setCreatingTag}
            />
            <Textarea
              ref={textAreaRef}
              id="username"
              rows={10}
              maxRows={30}
              value={text}
              onChange={handleTextChange}
              autoFocus
            />
            <DialogFooter className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-read-clipboard"
                  checked={autoReadClipboard}
                  onCheckedChange={(checked) => handleAutoReadChange(checked === true)}
                />
                <Label
                  htmlFor="auto-read-clipboard"
                  className="text-sm cursor-pointer"
                >
                  {t('record.mark.text.autoReadClipboard')}
                </Label>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-sm text-zinc-500">{t('record.mark.text.characterCount', { count: text.length })}</p>
                <Button type="submit" disabled={creatingTag || saving} onClick={handleSuccess}>{t('record.mark.text.save')}</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

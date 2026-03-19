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
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CopySlash } from "lucide-react"
import { useEffect, useState, useCallback, useRef } from "react"
import emitter from "@/lib/emitter"
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { hasText, readText } from 'tauri-plugin-clipboard-api'
import { Store } from '@tauri-apps/plugin-store'
import { toast } from '@/hooks/use-toast'

export function ControlText() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('')
  const [autoReadClipboard, setAutoReadClipboard] = useState(true)
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const onboardingPrefillRef = useRef<string | null>(null)

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks } = useMarkStore()

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

  // 保存设置到 store
  const handleAutoReadChange = useCallback(async (checked: boolean) => {
    setAutoReadClipboard(checked)
    try {
      const store = await Store.load('store.json')
      await store.set('autoReadClipboard', checked)
      // 如果勾选了 checkbox，立即读取剪贴板
      if (checked) {
        try {
          const hasTextRes = await hasText()
          if (hasTextRes) {
            const clipboardText = await readText()
            if (clipboardText) {
              setText(clipboardText)
            }
          }
        } catch {
          // 忽略剪贴板读取错误
        }
      }
    } catch {
      // 忽略保存错误
    }
  }, [])

  // 检查剪贴板中的文本
  const checkClipboard = useCallback(async () => {
    if (onboardingPrefillRef.current) {
      setText(onboardingPrefillRef.current)
      return
    }

    // 只有启用自动读取时才检查剪贴板
    if (!autoReadClipboard) {
      return
    }

    try {
      const hasTextRes = await hasText()
      if (hasTextRes) {
        const clipboardText = await readText()
        if (clipboardText) {
          setText(clipboardText)
        }
      }
    } catch {
      // 忽略剪贴板读取错误
    }
  }, [autoReadClipboard])

  async function handleSuccess() {
    const resetText = text.replace(/'/g, '').trim()

    if (!resetText) {
      toast({
        title: t('common.warning'),
        description: t('record.mark.text.description'),
        variant: 'destructive',
      })
      return
    }

    try {
      const store = await Store.load('store.json')
      await store.set('currentTagId', currentTagId)
      await store.save()

      await insertMark({ tagId: currentTagId, type: 'text', desc: resetText, content: resetText })
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
      emitter.emit('onboarding-step-complete', { step: 'create-record' })
      emitter.emit('onboarding-record-prefill-changed', {})

      // 记录完成后的导航处理（桌面端切换tab，移动端跳转页面）
      handleRecordComplete(router)

      setText('')
      setOpen(false)
    } catch (error) {
      console.error('Failed to save text record:', error)
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
    }
  }

  const handleOpen = useCallback(async (payload?: { prefillText?: string }) => {
    if (payload?.prefillText) {
      onboardingPrefillRef.current = payload.prefillText
    }
    setOpen(true)
    await checkClipboard()
  }, [checkClipboard])

  const handleOpenChange = useCallback(async (open: boolean) => {
    setOpen(open)
    if (open) {
      await checkClipboard()
    }
  }, [checkClipboard])

  useEffect(() => {
    const handleOnboardingPrefillChange = (payload?: { prefillText?: string }) => {
      onboardingPrefillRef.current = payload?.prefillText || null
    }
    const handleShortcutOpen = () => {
      void handleOpen()
    }

    emitter.on('quickRecordTextHandler', handleOpen)
    emitter.on('toolbar-shortcut-text', handleShortcutOpen)
    emitter.on('onboarding-record-prefill-changed', handleOnboardingPrefillChange)
    return () => {
      emitter.off('quickRecordTextHandler', handleOpen)
      emitter.off('toolbar-shortcut-text', handleShortcutOpen)
      emitter.off('onboarding-record-prefill-changed', handleOnboardingPrefillChange)
    }
  }, [handleOpen])

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerTrigger asChild>
            <TooltipButton buttonId="onboarding-target-record-text" icon={<CopySlash />} tooltipText={t('record.mark.type.text')} />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('record.mark.text.title')}</DrawerTitle>
              <DrawerDescription>
                {t('record.mark.text.description')}
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-4">
              <Textarea
                id="username"
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
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
                <Button type="submit" onClick={handleSuccess}>{t('record.mark.text.save')}</Button>
              </div>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <TooltipButton buttonId="onboarding-target-record-text" icon={<CopySlash />} tooltipText={t('record.mark.type.text')} />
          </DialogTrigger>
          <DialogContent className="min-w-full md:min-w-[650px]">
            <DialogHeader>
              <DialogTitle>{t('record.mark.text.title')}</DialogTitle>
              <DialogDescription>
                {t('record.mark.text.description')}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              id="username"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
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
                <Button type="submit" onClick={handleSuccess}>{t('record.mark.text.save')}</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

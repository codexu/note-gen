import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
import { Input } from "@/components/ui/input"
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { Link, CircleX } from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import { v4 as uuidv4 } from 'uuid'
import emitter from '@/lib/emitter'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { hasText, readText } from 'tauri-plugin-clipboard-api'
import { Store } from '@tauri-apps/plugin-store'
import { invoke } from '@tauri-apps/api/core'
import { toast } from '@/hooks/use-toast'
import { RecordSaveTarget } from './record-save-target'
import useSettingStore from '@/stores/setting'
import { getRecordSaveTagIdFromTags } from '@/lib/record-save-target'
import { useRecordCompletion } from './use-record-completion'
import { captureLink } from '@/lib/link-capture'
import {
  localizeCapturedImages,
  removeLinkAssetGroup,
} from '@/lib/web-capture/images'

type BrowserPageContent = { title: string; url: string; text: string; truncated: boolean }

export function ControlLink({ pageUrl, browserTabId, browserToolbar = false }: { pageUrl?: string; browserTabId?: string; browserToolbar?: boolean } = {}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoReadClipboard, setAutoReadClipboard] = useState(true)
  const mobileViewport = useIsMobile()
  const isMobile = !browserToolbar && (mobileViewport || checkIsMobileDevice())
  const completeRecord = useRecordCompletion()

  const { currentTagId, tags, fetchTags, initTags } = useTagStore()
  const { addQueue, setQueue, removeQueue } = useMarkStore()
  const [selectedTagId, setSelectedTagId] = useState<number>(currentTagId)

  // 初始化时从 store 读取设置
  useEffect(() => {
    if (browserToolbar) return
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
  }, [browserToolbar])

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
            if (clipboardText && isValidUrl(clipboardText)) {
              setUrl(clipboardText)
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

  // 检查剪贴板中的链接
  const checkClipboard = useCallback(async () => {
    // 只有启用自动读取时才检查剪贴板
    if (!autoReadClipboard) {
      return
    }

    try {
      const hasTextRes = await hasText()
      if (hasTextRes) {
        const clipboardText = await readText()
        if (clipboardText && isValidUrl(clipboardText)) {
          setUrl(clipboardText)
        }
      }
    } catch {
      // 如果读取失败（比如在 Web 环境），静默忽略
    }
  }, [autoReadClipboard])

  const prepareUrl = useCallback(async () => {
    if (browserToolbar) {
      setUrl(pageUrl || '')
      return
    }
    await checkClipboard()
  }, [browserToolbar, checkClipboard, pageUrl])

  const handleOpen = useCallback(async () => {
    setOpen(true)
    await prepareUrl()
  }, [prepareUrl])

  const handleOpenChange = useCallback(async (open: boolean) => {
    setOpen(open)
    if (open) {
      await prepareUrl()
    }
  }, [prepareUrl])

  useEffect(() => {
    if (browserToolbar) return
    emitter.on('toolbar-shortcut-link', handleOpen)
    return () => {
      emitter.off('toolbar-shortcut-link', handleOpen)
    }
  }, [browserToolbar, handleOpen])

  useEffect(() => {
    if (!open) {
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

  // 检查是否是有效的 URL
  function isValidUrl(text: string): boolean {
    if (!text || text.trim().length === 0) return false
    const trimmed = text.trim()
    // 支持带或不带协议的 URL
    const urlPattern = /^https?:\/\/.+/i
    const domainPattern = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}/i
    return urlPattern.test(trimmed) || domainPattern.test(trimmed)
  }

  // 清空输入框
  function handleClear() {
    setUrl('')
  }

  async function handleSuccess() {
    if (!url) return
    let targetUrl = url.trim()
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`
      setUrl(targetUrl)
    }
    
    setLoading(true)
    const queueId = uuidv4()
    
    // 添加到队列中显示加载状态
    addQueue({
      queueId,
      tagId: selectedTagId,
      type: 'link',
      progress: '0%',
      startTime: Date.now()
    })
    let shouldCleanupAssets = false

    try {
      const browserPagePromise = browserTabId
        ? invoke<BrowserPageContent>('browser_get_content', { tabId: browserTabId }).catch(() => null)
        : Promise.resolve(null)
      setQueue(queueId, { progress: '30%' });
      const page = await captureLink(targetUrl)
      const currentPage = await browserPagePromise
      let browserPage: BrowserPageContent | null = null
      if (currentPage?.text) {
        try {
          if (new URL(currentPage.url).href === new URL(targetUrl).href) browserPage = currentPage
        } catch {
          // Keep the original link capture result for an invalid edited URL.
        }
      }
      setQueue(queueId, { progress: '65%' })
      const localizedImages = await localizeCapturedImages(page, queueId)
      shouldCleanupAssets = localizedImages.savedPaths.length > 0
      setQueue(queueId, { progress: '90%' })

      const fallbackContent = page.excerpt
        ? page.method === 'search'
          ? `> ${t('record.mark.link.searchExcerpt')}\n>\n> ${page.excerpt}`
          : page.excerpt
        : ''
      const useBrowserContent = !!browserPage && !localizedImages.contentMarkdown
      const savedUrl = useBrowserContent ? (browserPage?.url || targetUrl) : (page.canonicalUrl || page.finalUrl || targetUrl)
      const content = localizedImages.contentMarkdown || (useBrowserContent ? (browserPage?.text || '') : fallbackContent)
      
      // 保存到数据库
      const result = await insertMark({
        tagId: selectedTagId,
        type: 'link', 
        desc: useBrowserContent ? (browserPage?.title || page.title) : page.title,
        content: content,
        url: savedUrl,
      });
      shouldCleanupAssets = false
      const markId = Number(result.lastInsertId || 0) || null
      await completeRecord({
        markId,
        tagId: selectedTagId,
        typeLabel: t('record.mark.type.link'),
      })

      if (page.status !== 'success' && !useBrowserContent) {
        toast({
          title: t('record.mark.link.savedPartialTitle'),
          description: page.method === 'search'
            ? t('record.mark.link.savedFromSearch')
            : t(`record.mark.link.captureStatus.${page.status}`),
        })
      }
      
      setUrl('');
      setOpen(false);
      
    } catch (error) {
      if (shouldCleanupAssets) {
        await removeLinkAssetGroup(queueId)
      }
      console.error('Error crawling page:', error);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('record.capture.linkFetchFailed'),
        variant: 'destructive',
      })
    } finally {
      removeQueue(queueId);
      setLoading(false);
    }
  }

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerTrigger asChild>
            <TooltipButton icon={<Link />} tooltipText={t('record.mark.type.link') || '链接'} />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('record.mark.link.title') || '链接记录'}</DrawerTitle>
              <DrawerDescription>
                {t('record.mark.link.description') || '输入网页链接，系统将自动爬取页面内容并保存'}
              </DrawerDescription>
            </DrawerHeader>
            <div className="space-y-4 px-4">
              <RecordSaveTarget
                selectedTagId={selectedTagId}
                tags={tags}
                onTagChange={setSelectedTagId}
              />
              <div className="relative">
                <Input
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                  className="pr-10"
                />
                {url && !loading && (
                  <button
                    onClick={handleClear}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                  >
                    <CircleX className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <DrawerFooter className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-read-clipboard-mobile"
                  checked={autoReadClipboard}
                  onCheckedChange={(checked) => handleAutoReadChange(checked === true)}
                  disabled={loading}
                />
                <Label
                  htmlFor="auto-read-clipboard-mobile"
                  className="text-sm cursor-pointer"
                >
                  {t('record.mark.link.autoReadClipboard') || '自动读取剪贴板链接'}
                </Label>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-sm text-zinc-500">
                  {loading ? '正在爬取页面内容...' : ''}
                </p>
                <Button
                  type="submit"
                  onClick={handleSuccess}
                  disabled={!url || loading}
                >
                  {loading ? '处理中...' : (t('record.mark.link.save') || '保存')}
                </Button>
              </div>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          {browserToolbar ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('tabContext.browserSaveRecord')}
                    disabled={!pageUrl}
                    onClick={() => void handleOpen()}
                  >
                    <Link data-icon="inline-start" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{t('tabContext.browserSaveRecord')}</TooltipContent>
            </Tooltip>
          ) : (
            <DialogTrigger asChild>
              <TooltipButton icon={<Link />} tooltipText={t('record.mark.type.link') || '链接'} />
            </DialogTrigger>
          )}
          <DialogContent className="min-w-full md:min-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t('record.mark.link.title') || '链接记录'}</DialogTitle>
              <DialogDescription>
                {t('record.mark.link.description') || '输入网页链接，系统将自动爬取页面内容并保存'}
              </DialogDescription>
            </DialogHeader>
            <RecordSaveTarget
              selectedTagId={selectedTagId}
              tags={tags}
              onTagChange={setSelectedTagId}
            />
            <div className="relative">
              <Input
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
                className="pr-10"
              />
              {url && !loading && (
                <button
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  <CircleX className="w-4 h-4" />
                </button>
              )}
            </div>
            <DialogFooter className="flex items-center gap-4">
              {!browserToolbar && <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-read-clipboard"
                  checked={autoReadClipboard}
                  onCheckedChange={(checked) => handleAutoReadChange(checked === true)}
                  disabled={loading}
                />
                <Label
                  htmlFor="auto-read-clipboard"
                  className="text-sm cursor-pointer"
                >
                  {t('record.mark.link.autoReadClipboard') || '自动读取剪贴板链接'}
                </Label>
              </div>}
              <div className="ml-auto flex items-center gap-4">
                <p className="text-sm text-zinc-500">
                  {loading ? '正在爬取页面内容...' : ''}
                </p>
                <Button
                  type="submit"
                  onClick={handleSuccess}
                  disabled={!url || loading}
                >
                  {loading ? '处理中...' : (t('record.mark.link.save') || '保存')}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

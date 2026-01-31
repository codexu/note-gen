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
import { Input } from "@/components/ui/input"
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { Link, CircleX } from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import { fetch } from '@tauri-apps/plugin-http'
import { v4 as uuidv4 } from 'uuid'
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { hasText, readText } from 'tauri-plugin-clipboard-api'
import { Store } from '@tauri-apps/plugin-store'

export function ControlLink() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoReadClipboard, setAutoReadClipboard] = useState(true)
  const isMobile = useIsMobile() || checkIsMobileDevice()

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()

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

  const handleOpen = useCallback(async () => {
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
    emitter.on('toolbar-shortcut-link', handleOpen)
    return () => {
      emitter.off('toolbar-shortcut-link', handleOpen)
    }
  }, [handleOpen])

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
    let targetUrl = url
    if (!targetUrl.startsWith('http')) {
      targetUrl = `https://${targetUrl}`
      setUrl(targetUrl)
    }
    
    setLoading(true)
    const queueId = uuidv4()
    
    // 添加到队列中显示加载状态
    addQueue({
      queueId,
      tagId: currentTagId!,
      type: 'link',
      progress: '0%',
      startTime: Date.now()
    })
    
    // 记录完成后的导航处理（桌面端切换tab，移动端跳转页面）
    handleRecordComplete(router)
    
    try {
      setQueue(queueId, { progress: '30%' });
      
      // 使用 Tauri 的 HTTP 插件获取页面内容
      const response = await fetch(targetUrl, {
        method: 'GET',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP 错误: ${response.status}`);
      }
      
      setQueue(queueId, { progress: '60%' });
      
      // 获取 HTML 内容
      const html = await response.text();

      // 创建一个 DOMParser 来解析 HTML
      const pageContent = await parseHtmlContent(html, targetUrl);
      
      setQueue(queueId, { progress: '90%' });
      
      if (pageContent.error) {
        throw new Error(pageContent.error);
      }
      
      // 提取有用的内容
      const { title, metaDesc, mainContent, bodyText } = pageContent;
      
      // 构建描述
      const desc = `${title}\n${metaDesc}`;
      
      // 构建内容（优先使用主要内容，如果没有则使用正文）
      const content = mainContent || bodyText;
      
      // 保存到数据库
      await insertMark({ 
        tagId: currentTagId, 
        type: 'link', 
        desc: desc, 
        content: content,
        url: targetUrl 
      });
      
      await fetchMarks();
      await fetchTags();
      getCurrentTag();
      
      setUrl('');
      setOpen(false);
      
    } catch (error) {
      console.error('Error crawling page:', error);
    } finally {
      removeQueue(queueId);
      setLoading(false);
    }
  }

  // 在浏览器环境中解析 HTML 内容
  function parseHtmlContent(html: string, url: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        // 创建一个临时的 div 元素
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // 获取页面标题
        const title = doc.title || new URL(url).hostname;
        
        // 获取元描述
        const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        
        // 尝试获取主要内容
        let mainContent = '';
        const mainElement = doc.querySelector('main') || 
                           doc.querySelector('article') || 
                           doc.querySelector('#content') || 
                           doc.querySelector('.content');
        
        if (mainElement) {
          mainContent = mainElement.textContent || '';
        }
        
        // 获取所有文本内容作为备选
        let bodyText = '';
        if (doc.body) {
          bodyText = doc.body.textContent || '';
        }
        
        // 限制文本长度
        if (mainContent.length > 10000) {
          mainContent = mainContent.substring(0, 10000);
        }
        
        if (bodyText.length > 10000) {
          bodyText = bodyText.substring(0, 10000);
        }
        
        resolve({
          title,
          metaDesc,
          mainContent,
          bodyText,
          url
        });
      } catch (error) {
        resolve({ 
          error: `解析 HTML 内容失败: ${error}`,
          title: new URL(url).hostname,
          metaDesc: '',
          mainContent: '',
          bodyText: '',
          url
        });
      }
    });
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
            <div className="px-4">
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
          <DialogTrigger asChild>
            <TooltipButton icon={<Link />} tooltipText={t('record.mark.type.link') || '链接'} />
          </DialogTrigger>
          <DialogContent className="min-w-full md:min-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t('record.mark.link.title') || '链接记录'}</DialogTitle>
              <DialogDescription>
                {t('record.mark.link.description') || '输入网页链接，系统将自动爬取页面内容并保存'}
              </DialogDescription>
            </DialogHeader>
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
            <DialogFooter className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
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
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

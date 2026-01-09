import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { Link } from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import { fetch } from '@tauri-apps/plugin-http'
import { v4 as uuidv4 } from 'uuid'
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'

export function ControlLink() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()

  const handleOpen = useCallback(() => {
    setOpen(true)
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-link', handleOpen)
    return () => {
      emitter.off('toolbar-shortcut-link', handleOpen)
    }
  }, [handleOpen])

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
    <Dialog open={open} onOpenChange={setOpen}>
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
        <Input 
          placeholder="https://example.com" 
          value={url} 
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />
        <DialogFooter className="flex items-center justify-between">
          <p className="text-sm text-zinc-500 mr-4">
            {loading ? '正在爬取页面内容...' : ''}
          </p>
          <Button 
            type="submit" 
            onClick={handleSuccess} 
            disabled={!url || loading}
          >
            {loading ? '处理中...' : (t('record.mark.link.save') || '保存')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

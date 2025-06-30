"use client"
import { NotebookPen } from "lucide-react"
import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import { fetchAiStream } from "@/lib/ai"
import { convertImage } from "@/lib/utils"
import { TooltipButton } from "@/components/tooltip-button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useState, useImperativeHandle, forwardRef, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Store } from "@tauri-apps/plugin-store"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation";
import dayjs, { Dayjs } from "dayjs"
import { ScrollArea } from "@/components/ui/scroll-area"

interface MarkGenProps {
  inputValue?: string;
}

export const MarkGen = forwardRef<{ openGen: () => void }, MarkGenProps>(({ inputValue }, ref) => {
  const [open, setOpen] = useState(false)
  const { primaryModel } = useSettingStore()
  const { currentTagId } = useTagStore()
  const { insert, loading, setLoading, saveChat, locale } = useChatStore()
  const { fetchMarks, marks } = useMarkStore()
  const [tab, setTab] = useState('0')
  const [genTemplate, setGenTemplate] = useState<GenTemplate[]>([])
  const router = useRouter()
  const abortControllerRef = useRef<AbortController | null>(null)

  async function initGenTemplates() {
    const store = await Store.load('store.json')
    const template = await store.get<GenTemplate[]>('templateList') || []
    setGenTemplate(template)
  }

  useImperativeHandle(ref, () => ({
    openGen
  }))

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        handleGen()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      } else if (e.key === 'Escape' && loading) {
        e.preventDefault()
        terminateChat()
      }
    }

    setTimeout(() => {
      window.addEventListener('keydown', handleKeyDown)
    }, 500);
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, loading])

  function terminateChat() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setLoading(false)
    }
  }

  function openGen() {
    setOpen(true)
    initGenTemplates()
  }

  async function handleGen() {
    setOpen(false)
    if (!primaryModel) return
    setLoading(true)
    const message = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'note',
      inserted: false,
      image: undefined,
    })
    if (!message) return
    await fetchMarks()
    const range = genTemplate.find(item => item.id === tab)?.range
    let subtractDate: Dayjs
    switch (range) {
      case GenTemplateRange.All:
        subtractDate = dayjs().subtract(99, 'year')
        break
      case GenTemplateRange.Today:
        subtractDate = dayjs().subtract(1, 'day')
        break
      case GenTemplateRange.Week:
        subtractDate = dayjs().subtract(1, 'week')
        break
      case GenTemplateRange.Month:
        subtractDate = dayjs().subtract(1, 'month')
        break
      case GenTemplateRange.ThreeMonth:
        subtractDate = dayjs().subtract(3, 'month')
        break
      case GenTemplateRange.Year:
        subtractDate = dayjs().subtract(1, 'year')
        break
    };
    const marksByRange = marks.filter(item => dayjs(item.createdAt).isAfter(subtractDate))
    const scanMarks = marksByRange.filter(item => item.type === 'scan')
    const textMarks = marksByRange.filter(item => item.type === 'text')
    const imageMarks = marksByRange.filter(item => item.type === 'image')
    const linkMarks = marksByRange.filter(item => item.type === 'link')
    const fileMarks = marksByRange.filter(item => item.type === 'file')
    for (const image of imageMarks) {
      if (!image.url.includes('http')) {
        image.url = await convertImage(`/image/${image.url}`)
      }
    }
    const request_content = `
      以下是通过截图后，使用OCR识别出的文字片段：
      ${scanMarks.map((item, index) => `第 ${index + 1} 条记录内容：${item.content}。创建于 ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}。
      以下是通过文本复制记录的片段：
      ${textMarks.map((item, index) => `第 ${index + 1} 条记录内容：${item.content}。创建于 ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}。
      以下是插图记录的片段描述：
      ${imageMarks.map(item => `
        描述：${item.content}，
        图片地址：${item.url}
      `).join(';\n\n')}。
      以下是链接记录的内容：
      ${linkMarks.map((item, index) => `第 ${index + 1} 条链接记录：
        标题：${item.desc}
        链接：${item.url}
        内容：${item.content}
        创建于：${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}。
      以下是文件记录的片段描述：·
      ${fileMarks.map(item => `
        内容：${item.content}，
      `).join(';\n\n')}。
      ---
      ${inputValue ? '满足需求：'+inputValue : ''}
      如果记录内容为空，则返回本次整理中不存在任何记录信息。
      满足以下格式要求：
      - 使用 ${locale} 语言。
      - 使用 Markdown 语法。
      - 确保存在一级标题。
      - 笔记顺序可能是错误的，要按照正确顺序排列。
      - 如果存在链接记录，将其作为参考链接放在文章末尾，格式如下：
        ## 参考链接
        1. [标题1](链接1)
        2. [标题2](链接2)
      
      ${
        imageMarks.length > 0 ?
        '- 如果存在插图记录，通过插图记录的描述，将图片链接放在笔记中的适合位置，图片地址包含 uuid，请完整返回，并对插图附带简单的描述。'
        : ''
      }
      ${genTemplate.find(item => item.id === tab)?.content}
    `
    // 先保存空消息，然后通过流式请求更新
    await saveChat({
      ...message,
      content: '',
    }, true)
    
    // 创建新的 AbortController 用于终止请求
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal
    
    // 使用流式方式获取AI结果
    let cache_content = '';
    try {
      await fetchAiStream(request_content, async (content) => {
        cache_content = content
        // 每次收到流式内容时更新消息
        await saveChat({
          ...message,
          content: content,
        }, false)
      }, signal)
    } catch (error: any) {
      // 如果不是中止错误，则记录错误信息
      if (error.name !== 'AbortError') {
        console.error('Stream error:', error)
      }
    } finally {
      abortControllerRef.current = null
      setLoading(false)
      const cleanedContent = cache_content.replace(/<thinking>[\s\S]*?<thinking>/g, '');
      await saveChat({
        ...message,
        content: cleanedContent
      }, true)
    }
  }

  function handleSetting() {
    router.push('/core/setting/template');
  }

  return (
    <AlertDialog onOpenChange={openGen} open={open}>
      <AlertDialogTrigger className="relative" asChild>
        <TooltipButton size="sm" variant={"default"} icon={<NotebookPen />} disabled={loading || !primaryModel} tooltipText="整理" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>将记录整理成...</AlertDialogTitle> 
          <Tabs defaultValue={tab} onValueChange={value => setTab(value)}>
            <TabsList>
              {
                genTemplate.map(item => (
                  <TabsTrigger value={item.id} key={item.id}>{item.title}</TabsTrigger>
                ))
              }
            </TabsList>
          </Tabs>
        </AlertDialogHeader>
        <div className="px-2 space-y-2">
          <div className="space-y-1">
            <Label htmlFor="name">模板内容</Label>
            <ScrollArea className="h-32 w-full p-2 rounded-md border">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                { genTemplate.find(item => item.id === tab)?.content }
              </p>
            </ScrollArea>
          </div>
          <div className="space-y-1">
            <Label htmlFor="username">记录选择范围</Label>
            <p className="text-xs text-muted-foreground">{ genTemplate.find(item => item.id === tab)?.range }</p>
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant={"ghost"} disabled={loading} onClick={handleSetting}>管理模板</Button>
          <Button variant={"outline"} onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleGen}>开始整理</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
})

MarkGen.displayName = 'MarkGen';
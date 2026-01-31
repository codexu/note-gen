"use client"
import { Send, Square } from "lucide-react"
import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting"
import useMarkStore from "@/stores/mark"
import useArticleStore from "@/stores/article"
import { fetchAiStream } from "@/lib/ai/chat"
import { convertImage } from "@/lib/utils"
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
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Store } from "@tauri-apps/plugin-store"
import { Label } from "@/components/ui/label"
import dayjs, { Dayjs } from "dayjs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslations } from "next-intl"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { toast } from "@/hooks/use-toast"
import emitter from "@/lib/emitter"

export function OrganizeToolbar() {
  const [open, setOpen] = useState(false)
  const { primaryModel } = useSettingStore()
  const { fetchMarks, marks } = useMarkStore()
  const { setActiveFilePath, loadFileTree, readArticle, activeFilePath } = useArticleStore()
  const [tab, setTab] = useState('0')
  const [genTemplate, setGenTemplate] = useState<GenTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [isRemoveThinking, setIsRemoveThinking] = useState(true)
  const t = useTranslations('record.chat.note')
  const tMark = useTranslations('record.mark')

  async function initGenTemplates() {
    const store = await Store.load('store.json')
    const template = await store.get<GenTemplate[]>('templateList') || []
    setGenTemplate(template)
  }

  useEffect(() => {
    const handleToolbarOrganize = () => {
      setOpen(true)
      initGenTemplates()
    }
    
    emitter.on('toolbar-organize', handleToolbarOrganize)
    return () => {
      emitter.off('toolbar-organize', handleToolbarOrganize)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        handleOrganize()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (loading) {
          terminateGeneration()
        } else {
          setOpen(false)
        }
      }
    }

    setTimeout(() => {
      window.addEventListener('keydown', handleKeyDown)
    }, 500);
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, loading])

  function terminateGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setLoading(false)
    }
  }

  async function handleOrganize() {
    setOpen(false)
    if (!primaryModel) return
    
    setLoading(true)
    
    try {
      // 1. Create empty markdown file or use current file
      let filePath = activeFilePath
      const workspace = await getWorkspacePath()
      
      if (!filePath) {
        const timestamp = new Date().getTime()
        const fileName = `整理笔记_${timestamp}.md`
        filePath = fileName
        const pathOptions = await getFilePathOptions(filePath)
        
        // Write empty file
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, '')
        } else {
          await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
        }
        
        // Load file tree and open the file
        await loadFileTree()
        setActiveFilePath(filePath)
        
        // Wait for editor to be ready
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      
      const pathOptions = await getFilePathOptions(filePath)
      
      // 2. Prepare marks data
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
        default:
          subtractDate = dayjs().subtract(99, 'year')
          break
      }
      
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
      
      const store = await Store.load('store.json')
      const locale = await store.get<string>('locale') || 'zh'
      
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
        以下是文件记录的片段描述：
        ${fileMarks.map(item => `
          内容：${item.content}，
        `).join(';\n\n')}。
        ---
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
      
      // 3. Stream generation to editor
      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal
      
      let fullContent = ''
      await fetchAiStream(request_content, async (content) => {
        fullContent = content
        // Update file content in real-time
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, content)
        } else {
          await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
        }
        // Trigger editor reload
        await readArticle(filePath, '', true)
      }, signal)
      
      // 4. Extract title and rename file if it's a new file
      const cleanedContent = fullContent
      
      if (filePath.startsWith('整理笔记_')) {
        const titleMatch = cleanedContent.match(/^#\s+(.+)$/m)
        
        if (titleMatch && titleMatch[1]) {
          const title = titleMatch[1].trim()
          const sanitizedTitle = title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50)
          const newFileName = `${sanitizedTitle}.md`
          const newFilePath = newFileName
          const newPathOptions = await getFilePathOptions(newFilePath)
          
          // Write to new file
          if (workspace.isCustom) {
            await writeTextFile(newPathOptions.path, cleanedContent)
          } else {
            await writeTextFile(newPathOptions.path, cleanedContent, { baseDir: newPathOptions.baseDir })
          }
          
          // Delete old file
          const { remove } = await import('@tauri-apps/plugin-fs')
          if (workspace.isCustom) {
            await remove(pathOptions.path)
          } else {
            await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          
          // Update file tree and active file
          await loadFileTree()
          setActiveFilePath(newFilePath)
          await readArticle(newFilePath, '', true)
          
          toast({
            description: tMark('organizeSuccess', { title: sanitizedTitle }),
          })
        } else {
          // No title found, just save the cleaned content
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, cleanedContent)
          } else {
            await writeTextFile(pathOptions.path, cleanedContent, { baseDir: pathOptions.baseDir })
          }
          await readArticle(filePath, '', true)
          
          toast({
            description: tMark('organizeSuccess', { title: filePath }),
          })
        }
      } else {
        // Existing file, just save the cleaned content
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, cleanedContent)
        } else {
          await writeTextFile(pathOptions.path, cleanedContent, { baseDir: pathOptions.baseDir })
        }
        await readArticle(filePath, '', true)
        
        toast({
          description: tMark('organizeSuccess', { title: filePath }),
        })
      }
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Organize error:', error)
        toast({
          description: tMark('organizeError'),
          variant: 'destructive',
        })
      }
    } finally {
      abortControllerRef.current = null
      setLoading(false)
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  if (loading) {
    return (
      <button
        className="vditor-tooltipped vditor-tooltipped__s"
        aria-label={t('stop')}
        onClick={handleStop}
      >
        <Square className="size-4 text-destructive" />
      </button>
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button className="vditor-tooltipped vditor-tooltipped__s" aria-label={tMark('organizeNotes')}>
          <Send className="size-4" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('organizeAs')}</AlertDialogTitle> 
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
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="name">{t('templateContent')}</Label>
              <Label>{t('recordRange')}: { genTemplate.find(item => item.id === tab)?.range }</Label>
            </div>
            <ScrollArea className="h-32 w-full p-2 rounded-md border">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                { genTemplate.find(item => item.id === tab)?.content }
              </p>
            </ScrollArea>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="remove-thinking" checked={isRemoveThinking} onCheckedChange={(checked) => setIsRemoveThinking(checked === true)} />
            <Label htmlFor="remove-thinking">{t('filterThinkingContent')}</Label>
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant={"outline"} onClick={() => setOpen(false)}>{t('cancel')}</Button>
          <Button onClick={handleOrganize}>{t('startOrganize')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent> 
    </AlertDialog>
  )
}

"use client"
import * as React from "react"
import { NotebookPen } from "lucide-react"
import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import { fetchAi } from "@/lib/ai"
import { convertImage } from "@/lib/utils"
import { TooltipButton } from "@/components/tooltip-button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
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
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Store } from "@tauri-apps/plugin-store"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation";
import dayjs, { Dayjs } from "dayjs"

export function MarkGen() {
  const { apiKey } = useSettingStore()
  const { currentTagId } = useTagStore()
  const { insert, loading, setLoading, saveChat, locale } = useChatStore()
  const { fetchMarks, marks } = useMarkStore()
  const [tab, setTab] = useState('0')
  const [genTemplate, setGenTemplate] = useState<GenTemplate[]>([])
  const router = useRouter()

  async function initGenTemplates() {
    const store = await Store.load('store.json')
    const template = await store.get<GenTemplate[]>('templateList') || []
    setGenTemplate(template)
  }

  async function handleGen() {
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
      ---
      如果记录内容为空，则返回本次整理中不存在任何记录信息。
      满足以下格式要求：
      - 使用 ${locale} 语言。
      - 使用 Markdown 语法。
      - 笔记顺序可能是错误的，要按照正确顺序排列。
      
      ${
        imageMarks.length > 0 ?
        '- 如果存在插图记录，通过插图记录的描述，将图片链接放在笔记中的适合位置，图片地址包含 uuid，请完整返回，并对插图附带简单的描述。'
        : ''
      }
      ${genTemplate.find(item => item.id === tab)?.content}
    `
    const content = await fetchAi(request_content)
    await saveChat({
      ...message,
      content,
    })
    setLoading(false)
  }

  function handleSetting() {
    router.push('/core/setting?anchor=template', { scroll: false });
  }

  return (
    <AlertDialog onOpenChange={initGenTemplates}>
      <AlertDialogTrigger asChild>
        <TooltipButton icon={<NotebookPen />} disabled={loading || !apiKey} tooltipText="整理" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{_t('organize_record_to')}</AlertDialogTitle> 
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
            <Label htmlFor="name">{_t('template_content')}</Label>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{ genTemplate.find(item => item.id === tab)?.content }</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="username">{_t('record_select_range')}</Label>
            <p className="text-xs text-muted-foreground">{ genTemplate.find(item => item.id === tab)?.range }</p>
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant={"ghost"} disabled={loading} onClick={handleSetting}>{_t('manage_template')}</Button>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={handleGen}>{_t('start_organize')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
  

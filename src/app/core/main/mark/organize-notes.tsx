"use client"
import { Mark } from "@/db/marks"
import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting"
import useMarkStore from "@/stores/mark"
import useArticleStore from "@/stores/article"
import useTagStore from "@/stores/tag"
import { fetchAiStream } from "@/lib/ai/chat"
import { convertImage } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useCallback, useEffect, useMemo, useImperativeHandle, forwardRef, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Store } from "@tauri-apps/plugin-store"
import { Label } from "@/components/ui/label"
import { useSidebarStore } from "@/stores/sidebar"
import { useRouter } from "next/navigation"
import dayjs, { Dayjs } from "dayjs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslations } from "next-intl"
import { writeTextFile, exists } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { toast } from "@/hooks/use-toast"
import emitter from "@/lib/emitter"
import { shouldEmitOrganizeOnboardingComplete } from "./organize-onboarding"

function shouldAutoSyncOnInitialRead(options?: { isNewFile?: boolean }) {
  return options?.isNewFile !== true
}

interface OrganizeNotesProps {
  inputValue?: string;
}

export interface OrganizeNotesHandle {
  openOrganize: () => void;
  openOrganizeWithMarks: (marks: Mark[]) => void;
}

export const OrganizeNotes = forwardRef<OrganizeNotesHandle, OrganizeNotesProps>(({ inputValue }, ref) => {
  const [open, setOpen] = useState(false)
  const [selectedMarkIds, setSelectedMarkIds] = useState<number[] | null>(null)
  const { primaryModel } = useSettingStore()
  const { fetchMarks, marks } = useMarkStore()
  const { currentTag } = useTagStore()
  const { setActiveFilePath, loadFileTree, readArticle, setCurrentArticle, setSkipSyncOnSave, setAiGeneratingFilePath, setAiTerminateFn } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const router = useRouter()
  const [tab, setTab] = useState('')
  const [genTemplate, setGenTemplate] = useState<GenTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const organizingRef = useRef(false)
  const [isRemoveThinking, setIsRemoveThinking] = useState(true)
  const t = useTranslations('record.chat.note')
  const tMark = useTranslations('record.mark')

  const noteText = useCallback((key: string, fallback: string) => {
    const translated = t(key)
    return translated === `record.chat.note.${key}` ? fallback : translated
  }, [t])

  const initGenTemplates = useCallback(async () => {
    const store = await Store.load('store.json')
    const template = await store.get<GenTemplate[]>('templateList') || []
    setGenTemplate(template)
    setTab((currentTab) => {
      if (template.some((item) => item.id === currentTab)) {
        return currentTab
      }
      return template[0]?.id ?? '0'
    })
  }

  // 使用 useMemo 优化过滤的记录
  const marksByRange = useMemo(() => {
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
    return marks.filter(item => dayjs(item.createdAt).isAfter(subtractDate))
  }, [marks, genTemplate, tab])

  const organizeSourceMarks = useMemo(() => {
    if (!selectedMarkIds) {
      return marksByRange
    }

    return marks.filter(item => selectedMarkIds.includes(item.id))
  }, [marks, marksByRange, selectedMarkIds])

  // 使用 useMemo 优化选中的模板
  const selectedTemplate = useMemo(() => {
    return genTemplate.find(item => item.id === tab)
  }, [genTemplate, tab])

  const isScopedSelection = (selectedMarkIds?.length || 0) > 0
  const isSingleSelection = (selectedMarkIds?.length || 0) === 1

  useEffect(() => {
    if (genTemplate.length === 0) {
      if (tab !== '') {
        setTab('')
      }
      return
    }

    if (!genTemplate.some(item => item.id === tab)) {
      setTab(genTemplate[0].id)
    }
  }, [genTemplate, tab])

  const terminateGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setLoading(false)
    }
  }, [])

  const openOrganize = useCallback(() => {
    setSelectedMarkIds(null)
    setOpen(true)
    void initGenTemplates()
  }, [])

  const handleOrganize = useCallback(async () => {
    if (loading || organizingRef.current) {
      return
    }

    if (!primaryModel) return

    organizingRef.current = true
    setOpen(false)
    setLoading(true)

    // Prepare file path outside try block for access in finally
    const timestamp = new Date().getTime()
    const fileName = `整理笔记_${timestamp}.md`
    const filePath = fileName

    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(filePath)

      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, '')
      } else {
        await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
      }

      const sidebarState = useSidebarStore.getState()

      if (!sidebarState.leftSidebarVisible) {
        await sidebarState.toggleLeftSidebar()
      }
      if (!sidebarState.centerPanelVisible) {
        await sidebarState.toggleCenterPanel()
      }
      await setLeftSidebarTab('notes')

      await loadFileTree()
      await setActiveFilePath(filePath)

      await new Promise(resolve => setTimeout(resolve, 500))

      await fetchMarks()

      // Get latest marks from store after fetch
      const latestMarks = useMarkStore.getState().marks

      // Calculate marksByRange with latest marks
      const range = selectedTemplate?.range
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
      const marksByRange = selectedMarkIds
        ? latestMarks.filter(item => selectedMarkIds.includes(item.id))
        : latestMarks.filter(item => dayjs(item.createdAt).isAfter(subtractDate))

      // Calculate categorizedMarks with latest marks
      const categorizedMarks = {
        scanMarks: marksByRange.filter(item => item.type === 'scan'),
        textMarks: marksByRange.filter(item => item.type === 'text'),
        recordingMarks: marksByRange.filter(item => item.type === 'recording'),
        imageMarks: marksByRange.filter(item => item.type === 'image'),
        linkMarks: marksByRange.filter(item => item.type === 'link'),
        fileMarks: marksByRange.filter(item => item.type === 'file')
      }

      // Process image marks
      const processedImageMarks = await Promise.all(
        categorizedMarks.imageMarks.map(async (image) => {
          if (!image.url.includes('http')) {
            image.url = await convertImage(`/image/${image.url}`)
          }
          return image
        })
      )

      const store = await Store.load('store.json')
      const locale = await store.get<string>('locale') || 'zh'

      const request_content = `
        Here are text fragments recognized by OCR after screenshots:
        ${categorizedMarks.scanMarks.map((item, index) => `Record ${index + 1}: ${item.content}. Created at ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}.
        Here are text fragments copied and recorded:
        ${categorizedMarks.textMarks.map((item, index) => `Record ${index + 1}: ${item.content}. Created at ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}.
        Here are speech-to-text transcripts from audio recordings:
        ${categorizedMarks.recordingMarks.map((item, index) => `Recording ${index + 1}: ${item.content}. Created at ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}.
        Here are image record descriptions:
        ${processedImageMarks.map(item => `
          Description: ${item.content},
          Image URL: ${item.url}
        `).join(';\n\n')}.
        Here are link record contents:
        ${categorizedMarks.linkMarks.map((item, index) => `Link record ${index + 1}:
          Title: ${item.desc}
          URL: ${item.url}
          Content: ${item.content}
          Created at: ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}.
        Here are file record descriptions:
        ${categorizedMarks.fileMarks.map(item => `
          Content: ${item.content},
        `).join(';\n\n')}.
        ---
        ${inputValue ? 'Requirements: '+inputValue : ''}
        If the record content is empty, return that there is no record information in this organization.
        Format requirements:
        - Use ${locale} language for the output.
        - Use Markdown syntax.
        - Ensure there is a level 1 heading (H1).
        - The note order may be incorrect, arrange them in the correct order.
        - If there are link records, place them as reference links at the end of the article in the following format:
          ## References
          1. [Title1](Link1)
          2. [Title2](Link2)

        ${
          processedImageMarks.length > 0 ?
          '- If there are image records, place the image links in appropriate positions in the note based on the image descriptions. The image URLs contain uuid, please return them completely, and add a brief description for each image.'
          : ''
        }
        ${selectedTemplate?.content}
      `

      // Emit AI streaming start event with target file path
      emitter.emit('editor-ai-streaming', {
        isStreaming: true,
        targetFilePath: filePath,
        terminate: () => {
          terminateGeneration()
        }
      })

      // 5. Stream generation to editor

      // Skip sync for AI-generated content
      setSkipSyncOnSave(true)
      setAiGeneratingFilePath(filePath)
      setAiTerminateFn(() => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
          abortControllerRef.current = null
          setLoading(false)
        }
      })

      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal
      const targetFilePath = filePath // 保存目标文件路径

      let fullContent = ''
      let streamFinished = false
      await fetchAiStream(request_content, async (content) => {
        // Check if user switched to a different file - stop writing if so
        const currentActivePath = useArticleStore.getState().activeFilePath
        if (currentActivePath !== targetFilePath) {
          return
        }

        fullContent = content
        // Update editor content in real-time without reloading file
        setCurrentArticle(content)
        emitter.emit('external-content-update', {
          content,
          targetFilePath,
        })
        // Also write to file
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, content)
        } else {
          await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
        }
      }, signal)
      streamFinished = true

      // Re-enable sync after AI generation
      setSkipSyncOnSave(false)
      setAiGeneratingFilePath(null)
      setAiTerminateFn(null)

      // Emit AI streaming end event
      emitter.emit('editor-ai-streaming', {
        isStreaming: false,
        targetFilePath: filePath
      })

      // 6. Extract title and rename file
      const cleanedContent = fullContent

      // Try to extract title: H1 -> H2 -> H3
      let titleMatch = cleanedContent.match(/^#\s+(.+)$/m)
      if (!titleMatch) {
        titleMatch = cleanedContent.match(/^##\s+(.+)$/m)
      }
      if (!titleMatch) {
        titleMatch = cleanedContent.match(/^###\s+(.+)$/m)
      }

      if (titleMatch && titleMatch[1]) {
        const title = titleMatch[1].trim()
        const sanitizedTitle = title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50)

        // Check for duplicate filenames and add (1), (2) etc if needed
        let newFileName = `${sanitizedTitle}.md`
        let counter = 1
        let newFilePath = newFileName
        let newPathOptions = await getFilePathOptions(newFilePath)

        while (await exists(newPathOptions.path, workspace.isCustom ? undefined : { baseDir: newPathOptions.baseDir })) {
          newFileName = `${sanitizedTitle}(${counter}).md`
          newFilePath = newFileName
          newPathOptions = await getFilePathOptions(newFilePath)
          counter++
        }

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
        await readArticle(newFilePath, '', shouldAutoSyncOnInitialRead({ isNewFile: true }))
        if (shouldEmitOrganizeOnboardingComplete({ streamFinished, aborted: signal.aborted })) {
          emitter.emit('onboarding-step-complete', { step: 'organize-note', filePath: newFilePath })
        }

        toast({
          description: tMark('toolbar.organizeSuccess', { title: sanitizedTitle }),
        })
      } else {
        // No title found, just save the cleaned content
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, cleanedContent)
        } else {
          await writeTextFile(pathOptions.path, cleanedContent, { baseDir: pathOptions.baseDir })
        }
        await readArticle(filePath, '', shouldAutoSyncOnInitialRead())
        if (shouldEmitOrganizeOnboardingComplete({ streamFinished, aborted: signal.aborted })) {
          emitter.emit('onboarding-step-complete', { step: 'organize-note', filePath })
        }

        toast({
          description: tMark('toolbar.organizeSuccess', { title: fileName }),
        })
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Organize error:', error)
        toast({
          description: tMark('toolbar.organizeError'),
          variant: 'destructive',
        })
      }
    } finally {
      organizingRef.current = false
      abortControllerRef.current = null
      setLoading(false)
      // Re-enable sync in case of termination
      setSkipSyncOnSave(false)
      setAiGeneratingFilePath(null)
      setAiTerminateFn(null)
      // Emit AI streaming end event
      emitter.emit('editor-ai-streaming', {
        isStreaming: false,
        targetFilePath: filePath
      })
    }
  }, [primaryModel, categorizedMarks, selectedTemplate, inputValue, fetchMarks, loadFileTree, setActiveFilePath, setLeftSidebarTab, setCurrentArticle, readArticle, tMark, loading])

  useImperativeHandle(ref, () => ({
    openOrganize,
    openOrganizeWithMarks
  }), [openOrganize, openOrganizeWithMarks])

  useEffect(() => {
    const handleOpenOrganize = (payload?: { marks?: Mark[] }) => {
      if (payload?.marks?.length) {
        openOrganizeWithMarks(payload.marks)
        return
      }

      openOrganize()
    }

    emitter.on('open-organize-notes', handleOpenOrganize)
    return () => {
      emitter.off('open-organize-notes', handleOpenOrganize)
    }
  }, [openOrganize, openOrganizeWithMarks])

  // Listen for abort event from editor
  useEffect(() => {
    const handleAbortAiStreaming = () => {
      if (loading) {
        terminateGeneration()
      }
    }
    emitter.on('abort-ai-streaming', handleAbortAiStreaming)
    return () => {
      emitter.off('abort-ai-streaming', handleAbortAiStreaming)
    }
  }, [loading, terminateGeneration])

  const handleDialogKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open || e.nativeEvent.isComposing) return

    if (e.key === 'Escape') {
      e.preventDefault()
      if (loading) {
        terminateGeneration()
      } else {
        setOpen(false)
      }
    }
  }, [open, loading, terminateGeneration])

  const handleSetting = useCallback(() => {
    router.push('/core/setting/template')
  }, [router])

  return (
    <AlertDialog onOpenChange={(nextOpen) => {
      if (open === nextOpen) {
        return
      }

      setOpen(nextOpen)
      if (!nextOpen) {
        setSelectedMarkIds(null)
      }
    }} open={open}>
      <AlertDialogContent onKeyDown={handleDialogKeyDown}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('organizeAs')}</AlertDialogTitle>
          <Tabs value={tab} onValueChange={value => setTab(value)}>
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
              <Label htmlFor="name">{noteText('templateContent', '模板内容')}</Label>
              <div className="flex items-center gap-2">
                <Label className="text-muted-foreground">
                  {isScopedSelection
                    ? (isSingleSelection
                      ? noteText('selectedRecording', '当前范围: 单条录音')
                      : tMark('toolbar.selectedCount', { count: selectedMarkIds?.length || 0 }))
                    : `${noteText('currentScope', '当前范围')}: ${currentTag?.name || '-'}`}
                </Label>
                {!isScopedSelection ? <Label>{noteText('recordRange', '记录选择范围')}: { selectedTemplate?.range }</Label> : null}
              </div>
            </div>
            <ScrollArea className="h-32 w-full p-2 rounded-md border">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                { selectedTemplate?.content }
              </p>
            </ScrollArea>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="remove-thinking" checked={isRemoveThinking} onCheckedChange={(checked) => setIsRemoveThinking(checked === true)} />
            <Label htmlFor="remove-thinking">{noteText('filterThinkingContent', '移除记录中的思考')}</Label>
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant={"ghost"} disabled={loading} onClick={handleSetting}>{noteText('manageTemplate', '管理模板')}</Button>
          <Button variant={"outline"} onClick={() => setOpen(false)}>{noteText('cancel', '取消')}</Button>
          <Button onClick={handleOrganize} disabled={organizeSourceMarks.length === 0 || loading}>
            {isSingleSelection ? noteText('startOrganizeSingle', '开始整理此录音') : noteText('startOrganizeAll', '开始整理当前标签')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
})

OrganizeNotes.displayName = 'OrganizeNotes';

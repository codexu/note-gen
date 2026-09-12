"use client"
import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting"
import useMarkStore from "@/stores/mark"
import useArticleStore, { type DirTree } from "@/stores/article"
import useTagStore from "@/stores/tag"
import { fetchAiStream } from "@/lib/ai/chat"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCallback, useEffect, useMemo, useImperativeHandle, forwardRef, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Store } from "@tauri-apps/plugin-store"
import { Label } from "@/components/ui/label"
import { useSidebarStore } from "@/stores/sidebar"
import { useRouter } from "next/navigation"
import dayjs, { Dayjs } from "dayjs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { useTranslations } from "next-intl"
import { BaseDirectory, writeTextFile, exists, readFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { joinRelativePath } from "@/lib/path"
import { toast } from "@/hooks/use-toast"
import emitter from "@/lib/emitter"
import { shouldEmitOrganizeOnboardingComplete } from "./organize-onboarding"
import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getTemplateRangeLabel, getTemplateRangeOptions } from "@/lib/template-range-utils"
import { ArrowLeft, ArrowRight, Check, ChevronDown, FileText, FolderOpen, Home, ListChecks, Pencil, Settings2, X, Zap } from "lucide-react"
import { getMarkLocalAssetPath, type Mark } from "@/db/marks"
import { MarkItem } from "./mark-item"
import { useSettingsDialogStore } from "@/stores/settings-dialog"
import { saveImageToWorkspace } from "@/lib/image-handler"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
} from "@/components/ui/item"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Field, FieldLabel } from "@/components/ui/field"
import { downloadRecordAssets } from "@/lib/sync/record-assets"
import { getRecordImageThumbnailPath } from "@/lib/record-image-thumbnail"
import {
  markEditorPathMutation,
  prepareActiveEditorDeactivationDurably,
  prepareActiveEditorPathMutationDurably,
  runEditorPathWriteTransaction,
} from "@/lib/editor-deactivation"

function shouldAutoSyncOnInitialRead(options?: { isNewFile?: boolean }) {
  return options?.isNewFile !== true
}

interface OrganizeNotesProps {
  inputValue?: string;
}

type OrganizeStep = 'template' | 'records' | 'settings'

const ROOT_FOLDER_VALUE = '__root__'
const NO_TEMPLATE_VALUE = '__no_template__'
const ALL_TAGS_VALUE = '__all_tags__'
const ORGANIZE_STEP_ORDER: OrganizeStep[] = ['template', 'records', 'settings']

function sanitizeMarkdownTitle(title: string) {
  const sanitized = title.trim().replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50)
  return sanitized || '整理笔记'
}

function normalizeOutputFolder(folderValue: string) {
  return folderValue === ROOT_FOLDER_VALUE ? '' : folderValue
}

function buildOutputPath(folder: string, fileName: string) {
  return folder ? joinRelativePath(folder, fileName) : fileName
}

function ensurePreferredHeading(content: string, title: string) {
  const normalizedTitle = title.trim()
  if (!normalizedTitle) return content

  const headingPattern = /^#{1,6}\s+.+$/m
  if (headingPattern.test(content)) {
    return content.replace(headingPattern, `# ${normalizedTitle}`)
  }

  return `# ${normalizedTitle}\n\n${content}`
}

async function getAvailableOutputPath(folder: string, rawTitle: string, isCustomWorkspace: boolean) {
  const sanitizedTitle = sanitizeMarkdownTitle(rawTitle)
  let fileName = `${sanitizedTitle}.md`
  let filePath = buildOutputPath(folder, fileName)
  let pathOptions = await getFilePathOptions(filePath)
  let counter = 1

  while (await exists(pathOptions.path, isCustomWorkspace ? undefined : { baseDir: pathOptions.baseDir })) {
    fileName = `${sanitizedTitle}(${counter}).md`
    filePath = buildOutputPath(folder, fileName)
    pathOptions = await getFilePathOptions(filePath)
    counter++
  }

  return { fileName, filePath, pathOptions, sanitizedTitle }
}

async function readLocalRecordImage(mark: Mark, localAssetPath: string) {
  try {
    return {
      bytes: await readFile(localAssetPath, { baseDir: BaseDirectory.AppData }),
      fileName: localAssetPath.split('/').pop() || mark.url,
    }
  } catch (initialError) {
    try {
      await downloadRecordAssets([mark])
      return {
        bytes: await readFile(localAssetPath, { baseDir: BaseDirectory.AppData }),
        fileName: localAssetPath.split('/').pop() || mark.url,
      }
    } catch {
      // 远端没有原图时继续尝试使用本地缩略图。
    }

    const thumbnailPath = await getRecordImageThumbnailPath(localAssetPath)
    if (thumbnailPath) {
      const normalizedThumbnailPath = thumbnailPath.replace(/^\/+/, '')
      return {
        bytes: await readFile(normalizedThumbnailPath, { baseDir: BaseDirectory.AppData }),
        fileName: normalizedThumbnailPath.split('/').pop() || 'record-image.webp',
      }
    }

    throw initialError
  }
}

export const OrganizeNotes = forwardRef<{ openOrganize: () => void }, OrganizeNotesProps>(({ inputValue }, ref) => {
  const [open, setOpen] = useState(false)
  const { primaryModel, templateList } = useSettingStore()
  const { marks, fetchAllMarks, allMarks } = useMarkStore()
  const { tags, fetchTags } = useTagStore()
  const { activeFilePath, fileTree, setActiveFilePath, loadFileTree, readArticle, setCurrentArticle, setSkipSyncOnSave, setAiGeneratingFilePath, setAiTerminateFn } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const router = useRouter()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState(NO_TEMPLATE_VALUE)
  const [genTemplate, setGenTemplate] = useState<GenTemplate[]>(templateList)
  const [loading, setLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const organizingRef = useRef(false)
  const [isRemoveThinking, setIsRemoveThinking] = useState(true)
  const [templateRange, setTemplateRange] = useState<GenTemplateRange>(GenTemplateRange.All)
  const [templateContent, setTemplateContent] = useState('')
  const [organizeStep, setOrganizeStep] = useState<OrganizeStep>('template')
  const [selectedRecordTagId, setSelectedRecordTagId] = useState<number | null>(null)
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<number>>(new Set())
  const [outputTitle, setOutputTitle] = useState('')
  const [outputFolderValue, setOutputFolderValue] = useState(ROOT_FOLDER_VALUE)
  const [isFolderTreeOpen, setIsFolderTreeOpen] = useState(false)
  const [includeImages, setIncludeImages] = useState(true)
  const [includeReferences, setIncludeReferences] = useState(true)
  const [additionalRequirement, setAdditionalRequirement] = useState('')
  const t = useTranslations('record.chat.note')
  const tGlobal = useTranslations()
  const tMark = useTranslations('record.mark')

  async function initGenTemplates() {
    const store = await Store.load('store.json')
    const storedTemplates = await store.get<GenTemplate[]>('templateList')
    const template = storedTemplates ?? useSettingStore.getState().templateList
    const enabledTemplates = template.filter(item => item.status !== false)
    const lastTemplateId = await store.get<string>('lastOrganizeTemplateId')
    setGenTemplate(template)
    setTab(() => {
      if (lastTemplateId === NO_TEMPLATE_VALUE) {
        return NO_TEMPLATE_VALUE
      }
      if (lastTemplateId && enabledTemplates.some((item) => item.id === lastTemplateId)) {
        return lastTemplateId
      }
      return NO_TEMPLATE_VALUE
    })
  }

  const persistLastTemplateId = useCallback(async (templateId: string) => {
    const store = await Store.load('store.json')
    await store.set('lastOrganizeTemplateId', templateId)
  }, [])

  const handleTemplateChange = useCallback((templateId: string) => {
    setTab(templateId)
    setOrganizeStep('template')
    void persistLastTemplateId(templateId)
  }, [persistLastTemplateId])

  const availableTemplates = useMemo(() => {
    return genTemplate.filter(item => item.status !== false)
  }, [genTemplate])

  const recordSourceMarks = useMemo(() => {
    if (!selectedRecordTagId) {
      return allMarks.length > 0 ? allMarks : marks
    }

    const marksForSelectedTag = allMarks.filter(item => item.tagId === selectedRecordTagId)
    if (marksForSelectedTag.length > 0) {
      return marksForSelectedTag
    }

    return marks.filter(item => item.tagId === selectedRecordTagId)
  }, [allMarks, marks, selectedRecordTagId])

  // 使用 useMemo 优化过滤的记录
  const marksByRange = useMemo(() => {
    let subtractDate: Dayjs
    switch (templateRange) {
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
    return recordSourceMarks.filter(item => dayjs(item.createdAt).isAfter(subtractDate))
  }, [recordSourceMarks, templateRange])

  const recordPreviewMarks = useMemo(() => {
    return [...marksByRange]
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [marksByRange])

  const selectedMarksByRange = useMemo(() => {
    return marksByRange.filter(item => selectedRecordIds.has(item.id))
  }, [marksByRange, selectedRecordIds])

  const recordTypeCounts = useMemo(() => {
    return marksByRange.reduce<Record<Mark['type'], number>>((counts, item) => {
      counts[item.type] += 1
      return counts
    }, {
      scan: 0,
      text: 0,
      image: 0,
      link: 0,
      file: 0,
      recording: 0,
      todo: 0,
    })
  }, [marksByRange])

  const selectedRecordTypes = useMemo(() => {
    const types = new Set(selectedMarksByRange.map(item => item.type))
    return (Object.keys(recordTypeCounts) as Mark['type'][])
      .filter(type => recordTypeCounts[type] > 0 && types.has(type))
  }, [recordTypeCounts, selectedMarksByRange])

  // 使用 useMemo 优化选中的模板
  const selectedTemplate = useMemo(() => {
    return availableTemplates.find(item => item.id === tab)
  }, [availableTemplates, tab])

  const selectedTemplateRangeLabel = useMemo(() => {
    return getTemplateRangeLabel(templateRange, tGlobal)
  }, [templateRange, tGlobal])

  useEffect(() => {
    if (tab === NO_TEMPLATE_VALUE) {
      setTemplateRange(GenTemplateRange.All)
      setTemplateContent('')
      return
    }

    if (selectedTemplate) {
      setTemplateRange(selectedTemplate.range)
      setTemplateContent(selectedTemplate.content)
    }
  }, [selectedTemplate, tab])

  const organizeDisabledReason = useMemo(() => {
    if (loading) return ''
    if (!primaryModel) return tGlobal('record.chat.input.placeholder.noPrimaryModel')
    if (recordSourceMarks.length === 0) return t('noRecords')
    if (marksByRange.length === 0) return t('noRecordsInRange')
    if (selectedMarksByRange.length === 0) return t('noRecordsSelected')
    return ''
  }, [loading, primaryModel, recordSourceMarks.length, marksByRange.length, selectedMarksByRange.length, t, tGlobal])

  const isOrganizeDisabled = Boolean(organizeDisabledReason) || loading
  const organizeStepIndex = ORGANIZE_STEP_ORDER.indexOf(organizeStep)
  const stepItems = useMemo(() => ([
    {
      value: 'template' as const,
      number: '1',
      title: t('stepTemplate'),
      meta: t('templateStepDescription'),
      icon: FileText,
      disabled: false,
    },
    {
      value: 'records' as const,
      number: '2',
      title: t('stepRecords'),
      meta: t('recordsStepDescription'),
      icon: ListChecks,
      disabled: marksByRange.length === 0,
    },
    {
      value: 'settings' as const,
      number: '3',
      title: t('stepSettings'),
      meta: t('settingsStepDescription'),
      icon: Settings2,
      disabled: selectedMarksByRange.length === 0,
    },
  ]), [
    marksByRange.length,
    selectedMarksByRange.length,
    t,
  ])
  const activeStepItem = stepItems[organizeStepIndex] ?? stepItems[0]
  const { openSettings } = useSettingsDialogStore()

  const handleManageTemplate = useCallback(() => {
    setOpen(false)
    if (isMobile) {
      router.push('/mobile/setting/pages/template')
    } else {
      openSettings('template')
    }
  }, [isMobile, openSettings, router])

  const getMarkTypeLabel = useCallback((type: Mark['type']) => {
    return tGlobal(`record.mark.type.${type}`)
  }, [tGlobal])

  const getFolderLabel = useCallback((folderValue: string) => {
    return folderValue === ROOT_FOLDER_VALUE ? t('saveFolderRoot') : folderValue
  }, [t])

  const handleSelectOutputFolder = useCallback((folderValue: string) => {
    setOutputFolderValue(folderValue)
    setIsFolderTreeOpen(false)
  }, [])

  const renderFolderTree = useCallback((items: DirTree[], parentPath = '', level = 0): ReactNode => {
    return items
      .filter(item => item.isDirectory)
      .map(item => {
        const folderPath = joinRelativePath(parentPath, item.name)
        const selected = outputFolderValue === folderPath
        const hasChildren = item.children?.some(child => child.isDirectory)

        return (
          <div key={folderPath} className="min-w-0">
            <button
              className={cn(
                "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent",
                selected && 'bg-accent text-accent-foreground'
              )}
              style={{ paddingLeft: `${8 + level * 16}px` }}
              type="button"
              onClick={() => handleSelectOutputFolder(folderPath)}
              title={folderPath}
            >
              {
                hasChildren ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )
              }
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{item.name}</span>
              {selected ? <Check className="ml-auto size-4 shrink-0" /> : null}
            </button>
            {
              hasChildren ? (
                <div className="min-w-0">
                  {renderFolderTree(item.children ?? [], folderPath, level + 1)}
                </div>
              ) : null
            }
          </div>
        )
      })
  }, [handleSelectOutputFolder, outputFolderValue])

  const toggleSelectedRecord = useCallback((recordId: number) => {
    setSelectedRecordIds(current => {
      const next = new Set(current)
      if (next.has(recordId)) {
        next.delete(recordId)
      } else {
        next.add(recordId)
      }
      return next
    })
  }, [])

  const selectAllPreviewRecords = useCallback(() => {
    setSelectedRecordIds(new Set(marksByRange.map(item => item.id)))
  }, [marksByRange])

  const clearSelectedPreviewRecords = useCallback(() => {
    setSelectedRecordIds(new Set())
  }, [])

  const handleRecordTypeSelectionChange = useCallback((types: string[]) => {
    const nextTypes = new Set(types as Mark['type'][])

    setSelectedRecordIds(current => {
      const currentTypes = new Set(
        marksByRange
          .filter(item => current.has(item.id))
          .map(item => item.type)
      )
      const next = new Set(current)

      for (const mark of marksByRange) {
        const wasSelected = currentTypes.has(mark.type)
        const shouldSelect = nextTypes.has(mark.type)

        if (wasSelected === shouldSelect) continue
        if (shouldSelect) {
          next.add(mark.id)
        } else {
          next.delete(mark.id)
        }
      }

      return next
    })
  }, [marksByRange])

  const terminateGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  const openOrganize = useCallback(() => {
    const latestTemplates = useSettingStore.getState().templateList
    const enabledTemplates = latestTemplates.filter(item => item.status !== false)
    const nextTemplate = tab === NO_TEMPLATE_VALUE
      ? undefined
      : enabledTemplates.find(item => item.id === tab)
    setGenTemplate(latestTemplates)
    setTab(nextTemplate?.id ?? NO_TEMPLATE_VALUE)
    setTemplateRange(nextTemplate?.range ?? GenTemplateRange.All)
    setTemplateContent(nextTemplate?.content ?? '')
    setOpen(true)
    setOrganizeStep('template')
    setSelectedRecordTagId(null)
    setAdditionalRequirement(inputValue ?? '')
    setOutputTitle('')
    setOutputFolderValue(activeFilePath.includes('/') ? activeFilePath.split('/').slice(0, -1).join('/') : ROOT_FOLDER_VALUE)
    void initGenTemplates()
    void fetchTags()
    void fetchAllMarks()
  }, [activeFilePath, fetchAllMarks, fetchTags, inputValue, tab])

  const handleOrganize = useCallback(async (options?: { quick?: boolean }) => {
    if (loading || organizingRef.current) {
      return
    }

    const quickMode = options?.quick === true
    const recordIdsToUse = new Set(quickMode ? marksByRange.map(item => item.id) : selectedRecordIds)

    if (!primaryModel || recordIdsToUse.size === 0) return

    const articleState = useArticleStore.getState()
    if (!await prepareActiveEditorDeactivationDurably(articleState.activeFilePath)) {
      return
    }

    organizingRef.current = true
    setOpen(false)
    setLoading(true)
    const controller = new AbortController()
    abortControllerRef.current = controller
    const signal = controller.signal

    // Prepare file path outside try block for access in finally
    const timestamp = new Date().getTime()
    const outputFolder = normalizeOutputFolder(outputFolderValue)
    const preferredTitle = outputTitle.trim()
    const extraRequirement = additionalRequirement.trim()
    const fileName = `整理笔记_${timestamp}.md`
    const filePath = buildOutputPath(outputFolder, fileName)

    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(filePath)

      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, '')
      } else {
        await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
      }

      await loadFileTree()
      await setActiveFilePath(
        filePath,
        shouldAutoSyncOnInitialRead({ isNewFile: true }),
        { deactivationAlreadyPrepared: true },
      )

      // Switch to files tab in sidebar
      await setLeftSidebarTab('files')

      if (isMobile) {
        router.push('/mobile/writing')
      }

      await new Promise(resolve => setTimeout(resolve, 500))

      await fetchAllMarks()

      // Get latest marks from store after fetch
      const latestMarks = useMarkStore.getState().allMarks
        .filter(item => !selectedRecordTagId || item.tagId === selectedRecordTagId)

      // Calculate marksByRange with latest marks
      let subtractDate: Dayjs
      switch (templateRange) {
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
      const marksByRange = latestMarks
        .filter(item => dayjs(item.createdAt).isAfter(subtractDate))
        .filter(item => quickMode || recordIdsToUse.has(item.id))

      // Calculate categorizedMarks with latest marks
      const categorizedMarks = {
        scanMarks: marksByRange.filter(item => item.type === 'scan'),
        textMarks: marksByRange.filter(item => item.type === 'text'),
        imageMarks: marksByRange.filter(item => item.type === 'image'),
        linkMarks: marksByRange.filter(item => item.type === 'link'),
        fileMarks: marksByRange.filter(item => item.type === 'file'),
        recordingMarks: marksByRange.filter(item => item.type === 'recording'),
        todoMarks: marksByRange.filter(item => item.type === 'todo'),
      }

      // Process image marks
      const processedImageMarks = includeImages ? await Promise.all(
        categorizedMarks.imageMarks.map(async (image) => {
          const localAssetPath = getMarkLocalAssetPath(image)
          if (!localAssetPath) {
            return image
          }

          try {
            const localImage = await readLocalRecordImage(image, localAssetPath)
            const savedImage = await saveImageToWorkspace(new File([localImage.bytes], localImage.fileName), filePath)

            return {
              ...image,
              url: savedImage.relativePath,
            }
          } catch (error) {
            console.error('[OrganizeNotes] Failed to copy local record image:', localAssetPath, error)
            return {
              ...image,
              url: '',
            }
          }
        })
      ) : categorizedMarks.imageMarks
      const embeddableImageCount = processedImageMarks.filter(item => Boolean(item.url)).length

      const store = await Store.load('store.json')
      const locale = await store.get<string>('locale') || 'zh'

      const request_content = `
        Here are text fragments recognized by OCR after screenshots:
        ${categorizedMarks.scanMarks.map((item, index) => `Record ${index + 1}: ${item.content}. Created at ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}.
        Here are text fragments copied and recorded:
        ${categorizedMarks.textMarks.map((item, index) => `Record ${index + 1}: ${item.content}. Created at ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}.
        Here are recording transcripts:
        ${categorizedMarks.recordingMarks.map((item, index) => `Recording record ${index + 1}: ${item.content}. Created at ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}.
        Here are todo records:
        ${categorizedMarks.todoMarks.map((item, index) => `Todo record ${index + 1}: ${item.content || item.desc}. Created at ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}`).join(';\n\n')}.
        Here are image record descriptions:
        ${processedImageMarks.map(item => `
          Description: ${item.content},
          ${includeImages && item.url ? `Image URL: ${item.url}` : 'Use the description only. Do not embed this image.'}
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
        ${extraRequirement ? 'Additional requirements: '+extraRequirement : ''}
        If the record content is empty, return that there is no record information in this organization.
        Format requirements:
        - Use ${locale} language for the output.
        - Use Markdown syntax.
        - Ensure there is a level 1 heading (H1).
        ${preferredTitle ? `- The H1 title must be exactly: ${preferredTitle}` : '- Generate a clear H1 title based on the selected records.'}
        - The note order may be incorrect, arrange them in the correct order.
        ${isRemoveThinking ? '- Remove thinking-process or reasoning fragments from records before composing the final note.' : ''}
        ${includeReferences ? `- If there are link records, place them as reference links at the end of the article in the following format:
          ## References
          1. [Title1](Link1)
          2. [Title2](Link2)` : '- Do not add a References section. Use link contents only when they are relevant to the note.'}

        ${
          includeImages && embeddableImageCount > 0 ?
          '- If there are image records, place the image links in appropriate positions in the note based on the image descriptions. The image URLs contain uuid, please return them completely, and add a brief description for each image.'
          : processedImageMarks.length > 0 ?
          '- Do not embed image links in the note. You may use image descriptions as source material if they are relevant.'
          : ''
        }
        ${templateContent}
      `

      // A navigation during preparation must not start a stream into another note.
      if (signal.aborted || useArticleStore.getState().activeFilePath !== filePath) return

      setSkipSyncOnSave(true)
      setAiGeneratingFilePath(filePath)
      setAiTerminateFn(terminateGeneration)
      emitter.emit('editor-ai-streaming', {
        isStreaming: true,
        targetFilePath: filePath,
        terminate: terminateGeneration,
      })

      // Keep only the latest snapshot. fetchAiStream does not await its callback,
      // so async work here must be drained explicitly before saving/renaming.
      let fullContent = ''
      let savedContent = ''
      let displayedContent = ''
      let receivedContent = false
      let receivedThinking = false
      let savedFirstContent = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let pendingWrite: Promise<void> = Promise.resolve()
      let writeError: unknown
      let writeFailed = false
      let streamFinished = false
      const unsubscribe = useArticleStore.subscribe((state) => {
        if (state.activeFilePath !== filePath) controller.abort()
      })
      const displayContent = () => {
        if (fullContent === displayedContent || useArticleStore.getState().activeFilePath !== filePath) return
        displayedContent = fullContent
        markEditorPathMutation(filePath)
        setCurrentArticle(fullContent)
        emitter.emit('external-content-update', fullContent)
      }
      const flushContent = async () => {
        const content = fullContent
        if (content === savedContent) return
        const written = await runEditorPathWriteTransaction(filePath, async () => {
          markEditorPathMutation(filePath)
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, content)
          } else {
            await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
          }
          markEditorPathMutation(filePath)
          return true
        })
        if (!written) throw new Error('Generated note could not be saved')
        savedContent = content
        if (!savedFirstContent) {
          savedFirstContent = true
          console.info('[OrganizeNotes] First content saved', { characters: content.length })
        }
      }
      let flushing = false
      const scheduleFlush = () => {
        if (timer !== undefined || streamFinished || signal.aborted) return
        // Longer documents need fewer full Markdown parses on the UI thread.
        const delay = fullContent.length > 50_000 ? 1_000 : 300
        timer = setTimeout(() => {
          timer = undefined
          displayContent()
          // Rendering must keep progressing while an earlier disk write waits.
          if (flushing || fullContent === savedContent) return
          flushing = true
          pendingWrite = flushContent().catch((error: unknown) => {
            writeFailed = true
            writeError = error
            controller.abort()
          }).finally(() => {
            flushing = false
            if (fullContent !== savedContent) scheduleFlush()
          })
        }, delay)
      }
      try {
        console.info('[OrganizeNotes] Starting AI stream')
        const result = await fetchAiStream(request_content, (content) => {
          if (signal.aborted || content === fullContent) return
          if (!receivedContent && content) {
            receivedContent = true
            console.info('[OrganizeNotes] First content received', { characters: content.length })
          }
          fullContent = content
          scheduleFlush()
        }, signal, undefined, undefined, undefined, undefined, () => {
          if (!receivedThinking) {
            receivedThinking = true
            console.info('[OrganizeNotes] Model is returning reasoning before content')
          }
        })
        if (!signal.aborted && (!result || result !== fullContent)) {
          throw new Error('Note generation did not complete successfully')
        }
      } finally {
        streamFinished = true
        if (timer !== undefined) clearTimeout(timer)
        displayContent()
        console.info('[OrganizeNotes] Stream ended; draining saves', {
          aborted: signal.aborted,
          characters: fullContent.length,
          receivedThinking,
        })
        await pendingWrite
        try {
          if (writeFailed) throw writeError
          // Preserve the last received text on completion, cancellation or error.
          await flushContent()
        } finally {
          unsubscribe()
        }
      }
      if (signal.aborted || useArticleStore.getState().activeFilePath !== filePath) return

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
      let cleanedContent = fullContent
      if (preferredTitle) {
        cleanedContent = ensurePreferredHeading(cleanedContent, preferredTitle)
      }

      // Try to extract title: H1 -> H2 -> H3
      let titleMatch = cleanedContent.match(/^#\s+(.+)$/m)
      if (!titleMatch) {
        titleMatch = cleanedContent.match(/^##\s+(.+)$/m)
      }
      if (!titleMatch) {
        titleMatch = cleanedContent.match(/^###\s+(.+)$/m)
      }

      if ((titleMatch && titleMatch[1]) || preferredTitle) {
        const title = preferredTitle || titleMatch?.[1]?.trim() || fileName.replace(/\.md$/, '')
        const { filePath: newFilePath, pathOptions: newPathOptions, sanitizedTitle } = await getAvailableOutputPath(outputFolder, title, workspace.isCustom)
        const pathChanged = newFilePath !== filePath
        if (
          pathChanged
          && !await prepareActiveEditorPathMutationDurably(
            useArticleStore.getState().activeFilePath,
            [filePath],
          )
        ) {
          throw new Error('Active editor could not be durably deactivated before renaming the generated note')
        }

        // Write to new file
        if (workspace.isCustom) {
          await writeTextFile(newPathOptions.path, cleanedContent)
        } else {
          await writeTextFile(newPathOptions.path, cleanedContent, { baseDir: newPathOptions.baseDir })
        }

        // Delete old file
        const { remove } = await import('@tauri-apps/plugin-fs')
        if (pathChanged) {
          if (workspace.isCustom) {
            await remove(pathOptions.path)
          } else {
            await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          await useArticleStore.getState().syncOpenTabsForPathChange(filePath, newFilePath)
        }

        // Update file tree and active file
        await loadFileTree()
        if (useArticleStore.getState().activeFilePath === filePath) {
          await setActiveFilePath(
            newFilePath,
            shouldAutoSyncOnInitialRead({ isNewFile: true }),
            pathChanged ? { deactivationAlreadyPrepared: true } : undefined,
          )
        }
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
        if (useArticleStore.getState().activeFilePath === filePath) {
          await readArticle(filePath, '', shouldAutoSyncOnInitialRead())
        }
        if (shouldEmitOrganizeOnboardingComplete({ streamFinished, aborted: signal.aborted })) {
          emitter.emit('onboarding-step-complete', { step: 'organize-note', filePath })
        }

        toast({
          description: tMark('toolbar.organizeSuccess', { title: fileName }),
        })
      }

    } catch (error: unknown) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
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
  }, [
    additionalRequirement,
    fetchAllMarks,
    includeImages,
    includeReferences,
    isRemoveThinking,
    loadFileTree,
    loading,
    outputFolderValue,
    outputTitle,
    primaryModel,
    readArticle,
    marksByRange,
    selectedRecordIds,
    selectedRecordTagId,
    templateContent,
    templateRange,
    setActiveFilePath,
    setAiGeneratingFilePath,
    setAiTerminateFn,
    setCurrentArticle,
    setLeftSidebarTab,
    setSkipSyncOnSave,
    isMobile,
    tMark,
    router,
    terminateGeneration,
  ])

  useImperativeHandle(ref, () => ({
    openOrganize
  }))

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

  useEffect(() => {
    if (!open) return
    setSelectedRecordIds(new Set(marksByRange.map(item => item.id)))
  }, [marksByRange, open])

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

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          isMobile
            ? "left-0 top-0 h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 duration-0 data-[state=closed]:animate-none data-[state=open]:animate-none sm:rounded-none"
            : "h-[calc(100vh-2rem)] max-h-[760px] w-[calc(100vw-2rem)] sm:max-w-5xl"
        )}
        onKeyDown={handleDialogKeyDown}
        showCloseButton={false}
        style={isMobile ? { animation: 'none' } : undefined}
      >
        <DialogHeader
          className={cn(
            "shrink-0 min-w-0 border-b",
            isMobile ? "px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]" : "px-6 py-4"
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className={cn(isMobile ? "text-lg leading-6" : "text-xl")}>{t('organizeAs')}</DialogTitle>
              {
                isMobile ? (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {activeStepItem.title} · {selectedTemplateRangeLabel}
                  </p>
                ) : null
              }
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary">
                {activeStepItem.number}/3
              </Badge>
              <Button
                aria-label={tGlobal('common.close')}
                className="size-8 p-0"
                disabled={loading}
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div
          className={cn(
            "shrink-0 border-b",
            isMobile ? "bg-background px-3 py-2" : "bg-muted/20 px-5 py-4"
          )}
        >
          <div className="w-full min-w-0">
            <div className="grid grid-cols-3 gap-2">
              {
                stepItems.map((item, index) => {
                  const Icon = item.icon
                  const isActive = item.value === organizeStep
                  const isComplete = index < organizeStepIndex
                  return (
                    <div
                      aria-current={isActive ? 'step' : undefined}
                      className={cn(
                        "min-w-0 rounded-md border text-left",
                        isMobile ? "flex flex-col items-center gap-1.5 px-2 py-2" : "flex items-center gap-3 p-3",
                        isActive && 'border-primary bg-background shadow-sm',
                        !isActive && isComplete && 'border-border bg-background/80',
                        !isActive && !isComplete && 'border-transparent',
                        item.disabled && 'opacity-50'
                      )}
                      key={item.value}
                    >
                      <span
                        className={cn(
                          "flex shrink-0 items-center justify-center rounded-full border font-semibold",
                          isMobile ? "size-7 text-xs" : "size-9 text-sm",
                          isActive && 'border-primary bg-primary text-primary-foreground',
                          !isActive && isComplete && 'border-primary bg-primary/10 text-primary',
                          !isActive && !isComplete && 'bg-background text-muted-foreground'
                        )}
                      >
                        {isComplete ? <Check className={cn(isMobile ? "size-3.5" : "size-4")} /> : item.number}
                      </span>
                      <span className={cn("min-w-0", isMobile && "text-center")}>
                        <span className={cn("flex min-w-0 items-center gap-1.5 font-medium", isMobile ? "justify-center text-xs" : "text-sm")}>
                          <Icon className="size-4 shrink-0" />
                          <span className="truncate">{item.title}</span>
                        </span>
                        <span className={cn("mt-0.5 truncate text-xs text-muted-foreground", isMobile ? "hidden" : "hidden lg:block")}>{item.meta}</span>
                      </span>
                    </div>
                  )
                })
              }
            </div>
          </div>
        </div>
        <main className={cn("flex min-h-0 min-w-0 flex-1 overflow-hidden", isMobile ? "px-3 py-3" : "px-6 py-5")}>
          <div className={cn("flex h-full w-full min-h-0 min-w-0 flex-col", isMobile ? "gap-3" : "gap-4")}>
          {
            organizeStep === 'template' ? (
              <div className={cn(
                "flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto",
                isMobile ? "gap-3 pb-2" : "gap-4 pr-1"
              )}>
                <div className={cn("flex min-w-0 flex-col gap-2", isMobile && "rounded-2xl border bg-background p-3")}>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <Label>{t('selectTemplate')}</Label>
                    <Button className={cn("h-8 gap-1 px-2", isMobile && "rounded-full text-xs")} variant="outline" disabled={loading} onClick={handleManageTemplate}>
                      <Pencil className="size-4" />
                      {t('manageTemplate')}
                    </Button>
                  </div>
                  <Select value={tab} onValueChange={handleTemplateChange}>
                    <SelectTrigger id="organize-template" className={cn("w-full", isMobile && "rounded-xl")}>
                      <SelectValue placeholder={t('selectTemplate')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={NO_TEMPLATE_VALUE}>{t('noTemplate')}</SelectItem>
                        {
                          availableTemplates.map(item => (
                            <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>
                          ))
                        }
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Field>
                    <FieldLabel htmlFor="organize-template-range">{t('recordRange')}</FieldLabel>
                    <Select
                      value={templateRange}
                      onValueChange={(value: GenTemplateRange) => setTemplateRange(value)}
                    >
                      <SelectTrigger id="organize-template-range" className={cn("w-full", isMobile && "rounded-xl")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {
                            getTemplateRangeOptions(tGlobal).map(option => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))
                          }
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field className={cn(isMobile && "rounded-2xl border bg-background p-3")}>
                  <FieldLabel htmlFor="organize-template-content">{t('templateContent')}</FieldLabel>
                  <Textarea
                    id="organize-template-content"
                    className={cn("min-h-40 resize-y", isMobile && "rounded-xl")}
                    rows={10}
                    maxRows={24}
                    value={templateContent}
                    onChange={(event) => setTemplateContent(event.target.value)}
                    placeholder={tGlobal('settings.template.noContent')}
                  />
                </Field>
              </div>
            ) : organizeStep === 'records' ? (
              <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3">
                <div className={cn(
                  "flex min-w-0 gap-2",
                  isMobile ? "flex-col rounded-2xl border bg-background p-3" : "flex-wrap items-center justify-between"
                )}>
                  <ToggleGroup
                    className="max-w-full flex-wrap justify-start"
                    type="multiple"
                    size="sm"
                    spacing={2}
                    value={selectedRecordTypes}
                    variant="outline"
                    onValueChange={handleRecordTypeSelectionChange}
                  >
                    {
                      Object.entries(recordTypeCounts)
                        .filter(([, count]) => count > 0)
                        .map(([type, count]) => (
                          <ToggleGroupItem key={type} value={type}>
                            <span>{getMarkTypeLabel(type as Mark['type'])}</span>
                            <span className="font-normal">{count}</span>
                          </ToggleGroupItem>
                        ))
                    }
                  </ToggleGroup>
                  <div className={cn(
                    "shrink-0 gap-2",
                    isMobile ? "grid grid-cols-2" : "flex flex-wrap items-center justify-end"
                  )}>
                    <div className={cn(isMobile && "col-span-2")}>
                      <Select
                        value={selectedRecordTagId ? String(selectedRecordTagId) : ALL_TAGS_VALUE}
                        onValueChange={(value) => setSelectedRecordTagId(value === ALL_TAGS_VALUE ? null : Number(value))}
                      >
                        <SelectTrigger className={cn("h-8 w-40", isMobile && "h-9 w-full rounded-xl")}>
                          <SelectValue placeholder={tMark('toolbar.filter.tag')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={ALL_TAGS_VALUE}>{tMark('toolbar.allTags')}</SelectItem>
                            {
                              tags.map(tag => (
                                <SelectItem key={tag.id} value={String(tag.id)}>{tag.name}</SelectItem>
                              ))
                            }
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button className={cn("h-8 px-2", isMobile && "h-9 rounded-xl")} variant="outline" onClick={selectAllPreviewRecords}>{t('selectAllRecords')}</Button>
                    <Button className={cn("h-8 px-2", isMobile && "h-9 rounded-xl")} variant="outline" onClick={clearSelectedPreviewRecords}>{t('clearRecordSelection')}</Button>
                  </div>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <ItemGroup className={isMobile ? "p-2.5" : "p-2"}>
                    {
                      recordPreviewMarks.length > 0 ? (
                        recordPreviewMarks.map(mark => (
                          <Item
                            className={cn(
                              "items-start bg-background",
                              !selectedRecordIds.has(mark.id) && 'opacity-60'
                            )}
                            key={mark.id}
                            size="sm"
                            variant="outline"
                          >
                            <ItemMedia className="pt-2">
                              <Checkbox
                                checked={selectedRecordIds.has(mark.id)}
                                id={`organize-record-${mark.id}`}
                                onCheckedChange={() => toggleSelectedRecord(mark.id)}
                              />
                            </ItemMedia>
                            <ItemContent className="min-w-0">
                              <MarkItem mark={mark} variant="list" interactive={false} />
                            </ItemContent>
                          </Item>
                        ))
                      ) : (
                        <Empty className="min-h-32 border">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <ListChecks />
                            </EmptyMedia>
                            <EmptyTitle>{t('previewEmpty')}</EmptyTitle>
                          </EmptyHeader>
                        </Empty>
                      )
                    }
                  </ItemGroup>
                </ScrollArea>
              </div>
            ) : (
              <div className={cn("min-h-0 w-full flex-1 overflow-y-auto", isMobile ? "pb-2" : "p-1 pr-2")}>
                <div className={cn("grid min-w-0", isMobile ? "gap-3" : "gap-4")}>
                  <div className={cn("grid min-w-0 md:grid-cols-2", isMobile ? "gap-3" : "gap-4")}>
                    <div className={cn("grid min-w-0 gap-2", isMobile && "rounded-2xl border bg-background p-3")}>
                      <Label htmlFor="organize-save-folder">{t('saveFolder')}</Label>
                      <Popover open={isFolderTreeOpen} onOpenChange={setIsFolderTreeOpen}>
                        <PopoverTrigger asChild>
                          <button
                            id="organize-save-folder"
                            className={cn(
                              "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-left text-sm transition-colors hover:bg-accent",
                              isMobile && "rounded-xl"
                            )}
                            type="button"
                          >
                            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{getFolderLabel(outputFolderValue)}</span>
                            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className={cn("w-80 p-0", isMobile && "w-[calc(100vw-2rem)]")} portalled={false}>
                          <div className="border-b px-3 py-2 text-sm font-medium">{t('saveFolder')}</div>
                          <div className="p-1">
                            <button
                              className={cn(
                                "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent",
                                outputFolderValue === ROOT_FOLDER_VALUE && 'bg-accent text-accent-foreground'
                              )}
                              type="button"
                              onClick={() => handleSelectOutputFolder(ROOT_FOLDER_VALUE)}
                            >
                              <Home className="size-4 shrink-0 text-muted-foreground" />
                              <span className="truncate">{t('saveFolderRoot')}</span>
                              {outputFolderValue === ROOT_FOLDER_VALUE ? <Check className="ml-auto size-4 shrink-0" /> : null}
                            </button>
                          </div>
                          <div className="h-64 overflow-y-auto border-t">
                            <div className="p-1">
                              {
                                fileTree.some(item => item.isDirectory) ? (
                                  renderFolderTree(fileTree)
                                ) : (
                                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">{t('noFolderAvailable')}</div>
                                )
                              }
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className={cn("grid min-w-0 gap-2 md:col-span-2", isMobile && "rounded-2xl border bg-background p-3")}>
                      <Label htmlFor="organize-output-title">{t('articleTitle')}</Label>
                      <Input
                        className={cn(isMobile && "rounded-xl")}
                        id="organize-output-title"
                        value={outputTitle}
                        onChange={(event) => setOutputTitle(event.target.value)}
                        placeholder={t('articleTitlePlaceholder')}
                      />
                    </div>
                    <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-md border bg-background p-3", isMobile && "rounded-2xl")}>
                      <div className="min-w-0">
                        <Label htmlFor="organize-include-images">{t('includeImages')}</Label>
                      </div>
                      <Switch id="organize-include-images" checked={includeImages} onCheckedChange={setIncludeImages} />
                    </div>
                    <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-md border bg-background p-3", isMobile && "rounded-2xl")}>
                      <div className="min-w-0">
                        <Label htmlFor="organize-include-references">{t('includeReferences')}</Label>
                      </div>
                      <Switch id="organize-include-references" checked={includeReferences} onCheckedChange={setIncludeReferences} />
                    </div>
                    <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-md border bg-background p-3", isMobile && "rounded-2xl")}>
                      <div className="min-w-0">
                        <Label htmlFor="remove-thinking">{t('filterThinkingContent')}</Label>
                      </div>
                      <Switch id="remove-thinking" checked={isRemoveThinking} onCheckedChange={setIsRemoveThinking} />
                    </div>
                    <div className={cn("grid min-w-0 gap-2 md:col-span-2", isMobile && "rounded-2xl border bg-background p-3")}>
                      <Label htmlFor="organize-additional-requirement">{t('additionalRequirement')}</Label>
                      <Textarea
                        className={cn("resize-none", isMobile ? "min-h-32 rounded-xl" : "min-h-28")}
                        id="organize-additional-requirement"
                        rows={5}
                        maxRows={12}
                        value={additionalRequirement}
                        onChange={(event) => setAdditionalRequirement(event.target.value)}
                        placeholder={t('additionalRequirementPlaceholder')}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          }
          {
            organizeStep !== 'template' && organizeDisabledReason ? (
              <p className={cn("text-xs text-muted-foreground", isMobile && "rounded-xl bg-muted/40 px-3 py-2")}>{organizeDisabledReason}</p>
            ) : null
          }
            </div>
          </main>
        <DialogFooter
          className={cn(
            "mx-0 mb-0 shrink-0 rounded-none border-t",
            isMobile
              ? "flex-row items-center justify-between gap-2 space-x-0 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3"
              : "px-6 py-4"
          )}
        >
          {
            organizeStep !== 'template' ? (
              <Button
                className={cn(isMobile && "h-10 shrink-0 rounded-xl px-3")}
                variant="ghost"
                disabled={loading}
                onClick={() => setOrganizeStep(organizeStep === 'settings' ? 'records' : 'template')}
              >
                <ArrowLeft className="size-4" />
                {t('previousStep')}
              </Button>
            ) : null
          }
          {
            organizeStep === 'template' ? (
              <>
                <Button
                  className={cn(isMobile && "h-10 flex-1 rounded-xl px-3")}
                  onClick={() => handleOrganize({ quick: true })}
                  disabled={!primaryModel || marksByRange.length === 0 || loading}
                  title={!primaryModel ? tGlobal('record.chat.input.placeholder.noPrimaryModel') : marksByRange.length === 0 ? t('noRecordsInRange') : t('quickOrganizeHelp')}
                >
                  <Zap className="size-4" />
                  {t('quickOrganize')}
                </Button>
                <Button
                  className={cn(isMobile && "h-10 flex-1 rounded-xl px-3")}
                  onClick={() => setOrganizeStep('records')}
                  disabled={marksByRange.length === 0 || loading}
                  title={marksByRange.length === 0 ? t('noRecordsInRange') : undefined}
                >
                  {t('nextStep')}
                  <ArrowRight className="size-4" />
                </Button>
              </>
            ) : organizeStep === 'records' ? (
              <Button
                className={cn(isMobile && "h-10 flex-1 rounded-xl px-3")}
                onClick={() => setOrganizeStep('settings')}
                disabled={selectedMarksByRange.length === 0 || loading}
                title={selectedMarksByRange.length === 0 ? t('noRecordsSelected') : undefined}
              >
                {t('nextStep')}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                className={cn(isMobile && "h-10 flex-1 rounded-xl px-3")}
                onClick={() => handleOrganize()}
                disabled={isOrganizeDisabled}
                title={organizeDisabledReason || undefined}
              >
                {t('startOrganize')}
              </Button>
            )
          }
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

OrganizeNotes.displayName = 'OrganizeNotes';

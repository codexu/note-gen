import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Table,
  Minus,
  Sparkles,
  FileText,
  ListPlus,
  MessageSquarePlus,
  Sigma,
  GitBranch,
  GitCommit,
  Calendar,
  Layers,
  Activity,
  PieChart,
  Database,
  Map,
  Image as ImageIcon,
  FilePlus,
} from 'lucide-react'
import { SuggestionProps } from '@tiptap/suggestion'
import { type Editor, type Range } from '@tiptap/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { handleImageUpload } from '@/lib/image-handler'
import useArticleStore from '@/stores/article'
import { toast } from '@/hooks/use-toast'
import { getWorkspacePath, isAbsoluteFsPath } from '@/lib/workspace'
import { isMobileDevice } from '@/lib/check'
import { pickImagesFromPhotoLibrary } from '@/lib/image-picker'

export interface SlashCommandItem {
  id?: string
  title: string
  description?: string
  icon: React.ReactNode
  group: string
  searchTerms?: string[]
  command: (props: { editor: Editor; range: Range }) => void
}

const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/

function normalizeLocalFilePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  const hasUncPrefix = normalized.startsWith('//')
  const hasLeadingSlash = normalized.startsWith('/')
  const segments: string[] = []

  normalized.split('/').forEach((segment) => {
    if (!segment || segment === '.') {
      return
    }

    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop()
      } else if (!hasLeadingSlash) {
        segments.push(segment)
      }
      return
    }

    segments.push(segment)
  })

  const normalizedPath = segments.join('/')
  if (hasUncPrefix) {
    return `//${normalizedPath}`
  }

  return hasLeadingSlash ? `/${normalizedPath}` : normalizedPath
}

function getPathName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).pop() || normalized || path
}

function normalizeWorkspacePathSegments(path: string): string[] {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')

  if (!normalized) {
    return []
  }

  const segments: string[] = []

  normalized.split('/').forEach((segment) => {
    if (!segment || segment === '.') {
      return
    }

    if (segment === '..') {
      if (segments.length > 0) {
        segments.pop()
      }
      return
    }

    segments.push(segment)
  })

  return segments
}

function toMarkdownRelativePath(currentFilePath: string, targetWorkspacePath: string): string {
  const currentSegments = normalizeWorkspacePathSegments(currentFilePath)
  const currentDirSegments = currentSegments.slice(0, -1)
  const targetSegments = normalizeWorkspacePathSegments(targetWorkspacePath)

  let commonPrefixLength = 0
  while (
    commonPrefixLength < currentDirSegments.length &&
    commonPrefixLength < targetSegments.length &&
    currentDirSegments[commonPrefixLength] === targetSegments[commonPrefixLength]
  ) {
    commonPrefixLength += 1
  }

  const upwardSegments = new Array(currentDirSegments.length - commonPrefixLength).fill('..')
  const downwardSegments = targetSegments.slice(commonPrefixLength)
  return [...upwardSegments, ...downwardSegments].join('/') || getPathName(targetWorkspacePath)
}

function encodeLocalLinkHref(path: string): string {
  return encodeURI(path)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

function toFileUrl(path: string): string {
  const normalized = normalizeLocalFilePath(path)
  const encodedPath = encodeLocalLinkHref(normalized)

  if (normalized.startsWith('//')) {
    return `file:${encodedPath}`
  }

  if (normalized.startsWith('/') || WINDOWS_ABSOLUTE_PATH_RE.test(normalized)) {
    return `file://${normalized.startsWith('/') ? '' : '/'}${encodedPath}`
  }

  return encodedPath
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function createMarkdownLink(href: string, label: string): string {
  return `[${escapeMarkdownLinkText(label)}](${href})`
}

function normalizePathForCompare(path: string): string {
  const normalized = normalizeLocalFilePath(path).replace(/\/+$/, '')
  return WINDOWS_ABSOLUTE_PATH_RE.test(normalized) ? normalized.toLowerCase() : normalized
}

function getPathInsideRoot(path: string, root: string): string | null {
  const normalizedPath = normalizePathForCompare(path)
  const normalizedRoot = normalizePathForCompare(root)

  if (normalizedPath === normalizedRoot) {
    return ''
  }

  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return null
  }

  return normalizeLocalFilePath(path).slice(normalizeLocalFilePath(root).replace(/\/+$/, '').length + 1)
}

async function getWorkspaceRelativePathForAbsolutePath(path: string): Promise<string | null> {
  const workspace = await getWorkspacePath()

  if (workspace.isCustom) {
    return getPathInsideRoot(path, workspace.path)
  }

  const appDir = await appDataDir()
  const defaultWorkspacePath = await join(appDir, 'article')
  return getPathInsideRoot(path, defaultWorkspacePath)
}

async function getMarkdownHrefForFilePath(path: string, currentFilePath: string): Promise<string> {
  const normalizedPath = normalizeLocalFilePath(path)

  if (isAbsoluteFsPath(normalizedPath)) {
    const workspaceRelativePath = await getWorkspaceRelativePathForAbsolutePath(normalizedPath)

    if (workspaceRelativePath !== null) {
      return encodeLocalLinkHref(toMarkdownRelativePath(currentFilePath, workspaceRelativePath))
    }

    return toFileUrl(normalizedPath)
  }

  return encodeLocalLinkHref(toMarkdownRelativePath(currentFilePath, normalizedPath))
}

async function createMarkdownLinksForFilePaths(paths: string[], currentFilePath: string): Promise<string[]> {
  return await Promise.all(
    paths.map(async (path) => {
      const href = await getMarkdownHrefForFilePath(path, currentFilePath)
      return createMarkdownLink(href, getPathName(path))
    })
  )
}

// 辅助函数: 创建 Mermaid 图表命令
const createMermaidCommand = (
  type: 'flowchart' | 'sequence' | 'gantt' | 'classDiagram' | 'stateDiagram' | 'pie' | 'er' | 'journey'
) => ({
  command: ({ editor, range }: { editor: Editor; range: Range }) => {
    editor.chain().focus().deleteRange(range).run()
    const event = new CustomEvent('tiptap-insert-mermaid', {
      detail: { type },
    })
    document.dispatchEvent(event)
  },
})

// 辅助函数: 创建自定义事件命令
const createCustomEventCommand = (eventName: string, detail?: unknown) => ({
  command: ({ editor, range }: { editor: Editor; range: Range }) => {
    editor.chain().focus().deleteRange(range).run()
    const event = new CustomEvent(eventName, { detail })
    document.dispatchEvent(event)
  },
})

const createCustomAiInstructionCommand = () => ({
  command: ({ editor, range }: { editor: Editor; range: Range }) => {
    const position = Math.min(range.from, editor.state.doc.content.size)
    const coords = editor.view.coordsAtPos(position)
    editor.chain().focus().deleteRange(range).run()
    const event = new CustomEvent('tiptap-ai-custom-instruction-open', {
      detail: {
        clientRect: new DOMRect(
          coords.left,
          coords.top,
          Math.max(0, coords.right - coords.left),
          Math.max(0, coords.bottom - coords.top)
        ),
      },
    })
    document.dispatchEvent(event)
  },
})

// 翻译接口
export interface SlashCommandTranslations {
  groups: {
    ai: string
    heading: string
    list: string
    block: string
    align: string
    embed: string
    math: string
    chart: string
  }
  items: {
    continue: string
    continueDesc: string
    generateSection: string
    generateSectionDesc: string
    summarize: string
    summarizeDesc: string
    customInstruction: string
    customInstructionDesc: string
    heading1: string
    heading1Desc: string
    heading2: string
    heading2Desc: string
    heading3: string
    heading3Desc: string
    heading4: string
    heading4Desc: string
    heading5: string
    heading5Desc: string
    heading6: string
    heading6Desc: string
    bulletList: string
    bulletListDesc: string
    orderedList: string
    orderedListDesc: string
    taskList: string
    taskListDesc: string
    image: string
    imageDesc: string
    file: string
    fileDesc: string
    table: string
    tableDesc: string
    blockquote: string
    blockquoteDesc: string
    codeBlock: string
    codeBlockDesc: string
    divider: string
    dividerDesc: string
    inlineMath: string
    inlineMathDesc: string
    blockMath: string
    blockMathDesc: string
    flowchart: string
    flowchartDesc: string
    sequence: string
    sequenceDesc: string
    gantt: string
    ganttDesc: string
    classDiagram: string
    classDiagramDesc: string
    stateDiagram: string
    stateDiagramDesc: string
    pie: string
    pieDesc: string
    erDiagram: string
    erDiagramDesc: string
    journey: string
    journeyDesc: string
  }
  imageUpload: {
    success: string
    saveSuccess: string
    savePath: string
    failed: string
  }
  fileInsert: {
    failed: string
  }
}

// 导出搜索函数供外部使用
export function filterItems(items: SlashCommandItem[], query: string): SlashCommandItem[] {
  if (!query || query.length === 0) {
    return items
  }
  const search = query.toLowerCase()
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(search) ||
      item.searchTerms?.some((term) => term.toLowerCase().includes(search)) ||
      item.description?.toLowerCase().includes(search)
  )
}

export const suggestionItems = (t?: SlashCommandTranslations): SlashCommandItem[] => {
  // 默认中文翻译（作为后备）
  const defaultT: SlashCommandTranslations = {
    groups: {
      ai: 'AI',
      heading: '标题',
      list: '列表',
      block: '块级',
      align: '对齐',
      embed: '嵌入',
      math: '数学',
      chart: '图表',
    },
    items: {
      continue: '续写',
      continueDesc: 'AI 续写内容',
      generateSection: '生成章节',
      generateSectionDesc: '根据当前笔记生成一个新章节',
      summarize: '总结',
      summarizeDesc: '总结当前笔记内容',
      customInstruction: '自定义指令',
      customInstructionDesc: '输入自己的指令并让 AI 执行',
      heading1: '一级标题',
      heading1Desc: '大标题',
      heading2: '二级标题',
      heading2Desc: '中标题',
      heading3: '三级标题',
      heading3Desc: '小标题',
      heading4: '四级标题',
      heading4Desc: '四级标题',
      heading5: '五级标题',
      heading5Desc: '五级标题',
      heading6: '六级标题',
      heading6Desc: '六级标题',
      bulletList: '无序列表',
      bulletListDesc: '创建简单的项目列表',
      orderedList: '有序列表',
      orderedListDesc: '创建带编号的列表',
      taskList: '任务列表',
      taskListDesc: '创建带复选框的任务列表',
      image: '图片',
      imageDesc: '插入本地图片或图床图片',
      file: '文件',
      fileDesc: '选择本地文件并插入链接',
      table: '表格',
      tableDesc: '插入表格',
      blockquote: '引用',
      blockquoteDesc: '捕获引用内容',
      codeBlock: '代码块',
      codeBlockDesc: '捕获代码片段',
      divider: '分割线',
      dividerDesc: '在元素之间创建分隔线',
      inlineMath: '行内公式',
      inlineMathDesc: '插入行内 LaTeX 公式',
      blockMath: '块级公式',
      blockMathDesc: '插入块级 LaTeX 公式',
      flowchart: '流程图',
      flowchartDesc: '插入流程图',
      sequence: '时序图',
      sequenceDesc: '插入时序图',
      gantt: '甘特图',
      ganttDesc: '插入甘特图',
      classDiagram: '类图',
      classDiagramDesc: '插入类图',
      stateDiagram: '状态图',
      stateDiagramDesc: '插入状态图',
      pie: '饼图',
      pieDesc: '插入饼图',
      erDiagram: 'ER图',
      erDiagramDesc: '插入实体关系图',
      journey: '旅程图',
      journeyDesc: '插入用户旅程图',
    },
    imageUpload: {
      success: '上传成功',
      saveSuccess: '保存成功',
      savePath: '保存路径: __PATH__',
      failed: '插入图片失败',
    },
    fileInsert: {
      failed: '插入文件链接失败',
    },
  }

  const tr = t || defaultT

  const items: SlashCommandItem[] = [
    // AI
    {
      title: tr.items.continue,
      description: tr.items.continueDesc,
      icon: <Sparkles className="w-4 h-4" />,
      group: tr.groups.ai,
      searchTerms: ['ai', 'continue', 'write', 'completion'],
      ...createCustomEventCommand('tiptap-ai-continue'),
    },
    {
      title: tr.items.generateSection,
      description: tr.items.generateSectionDesc,
      icon: <ListPlus className="w-4 h-4" />,
      group: tr.groups.ai,
      searchTerms: ['ai', 'section', 'chapter', 'generate', 'write'],
      ...createCustomEventCommand('tiptap-ai-generate', { action: 'section' }),
    },
    {
      title: tr.items.summarize,
      description: tr.items.summarizeDesc,
      icon: <FileText className="w-4 h-4" />,
      group: tr.groups.ai,
      searchTerms: ['ai', 'summary', 'summarize', 'abstract'],
      ...createCustomEventCommand('tiptap-ai-generate', { action: 'summary' }),
    },
    {
      title: tr.items.customInstruction,
      description: tr.items.customInstructionDesc,
      icon: <MessageSquarePlus className="w-4 h-4" />,
      group: tr.groups.ai,
      searchTerms: ['ai', 'custom', 'instruction', 'prompt'],
      ...createCustomAiInstructionCommand(),
    },
    {
      title: tr.items.heading1,
      description: tr.items.heading1Desc,
      icon: <Heading1 className="w-4 h-4" />,
      group: tr.groups.heading,
      searchTerms: ['heading', 'h1', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
      },
    },
    {
      title: tr.items.heading2,
      description: tr.items.heading2Desc,
      icon: <Heading2 className="w-4 h-4" />,
      group: tr.groups.heading,
      searchTerms: ['heading', 'h2', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
      },
    },
    {
      title: tr.items.heading3,
      description: tr.items.heading3Desc,
      icon: <Heading3 className="w-4 h-4" />,
      group: tr.groups.heading,
      searchTerms: ['heading', 'h3', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
      },
    },
    {
      title: tr.items.heading4,
      description: tr.items.heading4Desc,
      icon: <Heading4 className="w-4 h-4" />,
      group: tr.groups.heading,
      searchTerms: ['heading', 'h4', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run()
      },
    },
    {
      title: tr.items.heading5,
      description: tr.items.heading5Desc,
      icon: <Heading5 className="w-4 h-4" />,
      group: tr.groups.heading,
      searchTerms: ['heading', 'h5', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 5 }).run()
      },
    },
    {
      title: tr.items.heading6,
      description: tr.items.heading6Desc,
      icon: <Heading6 className="w-4 h-4" />,
      group: tr.groups.heading,
      searchTerms: ['heading', 'h6', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 6 }).run()
      },
    },

    // 列表
    {
      title: tr.items.bulletList,
      description: tr.items.bulletListDesc,
      icon: <List className="w-4 h-4" />,
      group: tr.groups.list,
      searchTerms: ['bullet', 'ul', 'list'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
    },
    {
      title: tr.items.orderedList,
      description: tr.items.orderedListDesc,
      icon: <ListOrdered className="w-4 h-4" />,
      group: tr.groups.list,
      searchTerms: ['ordered', 'ol', 'numbered', 'list'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
    },
    {
      title: tr.items.taskList,
      description: tr.items.taskListDesc,
      icon: <CheckSquare className="w-4 h-4" />,
      group: tr.groups.list,
      searchTerms: ['task', 'todo', 'checkbox', 'checklist'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
      },
    },

    // 块级元素
    {
      title: tr.items.image,
      description: tr.items.imageDesc,
      icon: (
        <span aria-hidden="true">
          <ImageIcon className="w-4 h-4" />
        </span>
      ),
      group: tr.groups.block,
      searchTerms: ['image', 'picture', 'photo', 'img'],
      command: async ({ editor, range }: { editor: Editor; range: Range }) => {
        const rangeStart = range.from

        // Insert "Uploading..." text as placeholder
        editor.chain().focus().deleteRange(range).insertContentAt(rangeStart, {
          type: 'text',
          text: 'Uploading... ',
        }).run()

        // Get the position range of the placeholder
        const placeholderStart = rangeStart
        const placeholderEnd = rangeStart + 'Uploading... '.length

        try {
          let fileObj: File | null = null

          if (isMobileDevice()) {
            fileObj = (await pickImagesFromPhotoLibrary())[0] || null
          } else {
            const file = await open({
              multiple: false,
              filters: [
                {
                  name: 'Images',
                  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
                },
              ],
            })

            if (typeof file === 'string') {
              const fileData = await readFile(file)
              const ext = file.split('.').pop() || 'png'
              const fileName = file.split('/').pop() || `image.${ext}`
              const arrayBuffer = new Uint8Array(fileData).buffer
              fileObj = new File([arrayBuffer], fileName, { type: `image/${ext}` })
            }
          }

          if (!fileObj) {
            // User cancelled, remove placeholder
            editor.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run()
            return
          }

          const activeFilePath = useArticleStore.getState().activeFilePath
          const result = await handleImageUpload(fileObj, activeFilePath)

          // Delete the placeholder text
          editor.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run()

          // Insert the actual image
          editor.chain().focus().insertContentAt(placeholderStart, {
            type: 'image',
            attrs: {
              src: result.src,
              alt: fileObj.name,
              relativeSrc: result.relativePath,
            },
          }).run()
        } catch (error) {
          // Remove the placeholder on error
          editor.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run()

          toast({
            title: tr.imageUpload.failed,
            description: error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
          })
        }
      },
    },
    {
      title: tr.items.file,
      description: tr.items.fileDesc,
      icon: <FilePlus className="w-4 h-4" />,
      group: tr.groups.block,
      searchTerms: ['file', 'attachment', 'link', 'local', 'document', '文件', '附件', '链接'],
      command: async ({ editor, range }: { editor: Editor; range: Range }) => {
        const rangeStart = range.from
        editor.chain().focus().deleteRange(range).run()

        try {
          const selected = await open({
            multiple: true,
            directory: false,
          })

          const paths = Array.isArray(selected)
            ? selected
            : selected
              ? [selected]
              : []

          if (paths.length === 0) {
            return
          }

          const currentFilePath = useArticleStore.getState().activeFilePath
          const links = await createMarkdownLinksForFilePaths(paths, currentFilePath)

          if (links.length === 0) {
            return
          }

          editor.chain()
            .focus()
            .insertContentAt(rangeStart, links.join('\n'), { contentType: 'markdown' })
            .run()
        } catch (error) {
          toast({
            title: tr.fileInsert.failed,
            description: error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
          })
        }
      },
    },
    {
      title: tr.items.table,
      description: tr.items.tableDesc,
      icon: <Table className="w-4 h-4" />,
      group: tr.groups.block,
      searchTerms: ['table', 'grid', 'matrix'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      },
    },
    {
      title: tr.items.blockquote,
      description: tr.items.blockquoteDesc,
      icon: <Quote className="w-4 h-4" />,
      group: tr.groups.block,
      searchTerms: ['blockquote', 'quote', 'citation'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
      },
    },
    {
      title: tr.items.codeBlock,
      description: tr.items.codeBlockDesc,
      icon: <Code className="w-4 h-4" />,
      group: tr.groups.block,
      searchTerms: ['code', 'pre', 'programming'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
      },
    },
    {
      title: tr.items.divider,
      description: tr.items.dividerDesc,
      icon: <Minus className="w-4 h-4" />,
      group: tr.groups.block,
      searchTerms: ['hr', 'horizontal', 'divider', 'line'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
    },

    // 数学公式
    {
      title: tr.items.inlineMath,
      description: tr.items.inlineMathDesc,
      icon: <Sigma className="w-4 h-4" />,
      group: tr.groups.math,
      searchTerms: ['math', 'inline', 'latex', 'formula', 'inline-math'],
      ...createCustomEventCommand('tiptap-insert-inline-math'),
    },
    {
      title: tr.items.blockMath,
      description: tr.items.blockMathDesc,
      icon: <Sigma className="w-4 h-4" />,
      group: tr.groups.math,
      searchTerms: ['math', 'block', 'latex', 'formula', 'block-math', 'display'],
      ...createCustomEventCommand('tiptap-insert-block-math'),
    },

    // 图表
    {
      title: tr.items.flowchart,
      description: tr.items.flowchartDesc,
      icon: <GitBranch className="w-4 h-4" />,
      group: tr.groups.chart,
      searchTerms: ['mermaid', 'flowchart', 'diagram'],
      ...createMermaidCommand('flowchart'),
    },
    {
      title: tr.items.sequence,
      description: tr.items.sequenceDesc,
      icon: <GitCommit className="w-4 h-4" />,
      group: tr.groups.chart,
      searchTerms: ['mermaid', 'sequence', 'sequenceDiagram'],
      ...createMermaidCommand('sequence'),
    },
    {
      title: tr.items.gantt,
      description: tr.items.ganttDesc,
      icon: <Calendar className="w-4 h-4" />,
      group: tr.groups.chart,
      searchTerms: ['mermaid', 'gantt'],
      ...createMermaidCommand('gantt'),
    },
    {
      title: tr.items.classDiagram,
      description: tr.items.classDiagramDesc,
      icon: <Layers className="w-4 h-4" />,
      group: tr.groups.chart,
      searchTerms: ['mermaid', 'class', 'classDiagram'],
      ...createMermaidCommand('classDiagram'),
    },
    {
      title: tr.items.stateDiagram,
      description: tr.items.stateDiagramDesc,
      icon: <Activity className="w-4 h-4" />,
      group: tr.groups.chart,
      searchTerms: ['mermaid', 'state', 'stateDiagram'],
      ...createMermaidCommand('stateDiagram'),
    },
    {
      title: tr.items.pie,
      description: tr.items.pieDesc,
      icon: <PieChart className="w-4 h-4" />,
      group: tr.groups.chart,
      searchTerms: ['mermaid', 'pie', 'chart'],
      ...createMermaidCommand('pie'),
    },
    {
      title: tr.items.erDiagram,
      description: tr.items.erDiagramDesc,
      icon: <Database className="w-4 h-4" />,
      group: tr.groups.chart,
      searchTerms: ['mermaid', 'er', 'erDiagram'],
      ...createMermaidCommand('er'),
    },
    {
      title: tr.items.journey,
      description: tr.items.journeyDesc,
      icon: <Map className="w-4 h-4" />,
      group: tr.groups.chart,
      searchTerms: ['mermaid', 'journey'],
      ...createMermaidCommand('journey'),
    },
  ]

  return items
}

// Simple slash match function - hardcoded to match "/"
function findSlashMatch(config: {
  char: string
  allowSpaces: boolean
  allowedPrefixes: string[] | null
  startOfLine: boolean
  $position: any
}) {
  const { $position } = config
  const $pos = $position

  const parent = $pos.parent
  if (!parent?.isTextblock) {
    return null
  }

  const text = parent.textBetween(0, $pos.parentOffset, undefined, '\uFFFC')
  if (!text) {
    return null
  }

  // Markdown 链接或图片的目标地址由文件路径推荐处理，不能触发 Slash Command。
  if (/\[[^\]\n]+\]\([^)\n]*$/.test(text)) {
    return null
  }

  // Slash command should only activate when the slash is at the start of the
  // current text block or after whitespace / sentence punctuation, and the
  // cursor is still directly after the query text.
  const match = /(?:^|[\s([{'"`<>]|[.,!?;:，。！？；：（）【】《》、])\/([^\s/]*)$/.exec(text)
  if (!match) {
    return null
  }

  const fullMatch = match[0]
  const slashOffset = text.length - fullMatch.length + fullMatch.lastIndexOf('/')
  const from = $pos.start() + slashOffset
  const to = $pos.pos

  return {
    range: { from, to },
    query: match[1] || '',
    text: text.slice(slashOffset),
  }
}

export { findSlashMatch }

// Global callback for menu keyboard handling
let menuKeyDownHandler: ((props: { event: KeyboardEvent }) => boolean) | null = null

export function setMenuKeyDownHandler(handler: ((props: { event: KeyboardEvent }) => boolean) | null) {
  menuKeyDownHandler = handler
}

export const suggestionOptions = {
  items: ({ query }: { query: string }) => {
    return filterItems(suggestionItems(), query)
  },

  render: () => {
    return {
      onStart: (props: SuggestionProps) => {
        const rect = props.clientRect
        const clientRect = typeof rect === 'function' ? rect() : rect
        if (!clientRect) {
          return
        }

        const editor = props.editor
        if (!editor) {
          return
        }

        const event = new CustomEvent('slash-command-show', {
          detail: {
            editor,
            range: props.range,
            clientRect,
            query: props.query || '',
          },
        })
        document.dispatchEvent(event)
      },

      onUpdate: (props: SuggestionProps) => {
        const rect = props.clientRect
        const clientRect = typeof rect === 'function' ? rect() : rect
        if (!clientRect) {
          return
        }

        const event = new CustomEvent('slash-command-update', {
          detail: {
            editor: props.editor,
            range: props.range,
            clientRect,
            query: props.query || '',
          },
        })
        document.dispatchEvent(event)
      },

      onKeyDown: (props: { event: KeyboardEvent }) => {
        // Call menu's keyDown handler first
        if (menuKeyDownHandler) {
          if (menuKeyDownHandler(props)) {
            return true
          }
        }

        if (props.event.key === 'Escape') {
          const hideEvent = new CustomEvent('slash-command-hide')
          document.dispatchEvent(hideEvent)
          return true
        }

        return false
      },

      onExit: () => {
        const event = new CustomEvent('slash-command-hide')
        document.dispatchEvent(event)
      },
    }
  },
}

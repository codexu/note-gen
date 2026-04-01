import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Table,
  Minus,
  Sparkles,
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
} from 'lucide-react'
import { SuggestionProps } from '@tiptap/suggestion'
import { type Editor, type Range } from '@tiptap/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { handleImageUpload } from '@/lib/image-handler'
import useArticleStore from '@/stores/article'
import { toast } from '@/hooks/use-toast'

export interface SlashCommandItem {
  title: string
  description?: string
  icon: React.ReactNode
  group: string
  searchTerms?: string[]
  command: (props: { editor: Editor; range: Range }) => void
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
const createCustomEventCommand = (eventName: string, detail?: any) => ({
  command: ({ editor, range }: { editor: Editor; range: Range }) => {
    editor.chain().focus().deleteRange(range).run()
    const event = new CustomEvent(eventName, { detail })
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
    heading1: string
    heading1Desc: string
    heading2: string
    heading2Desc: string
    heading3: string
    heading3Desc: string
    bulletList: string
    bulletListDesc: string
    orderedList: string
    orderedListDesc: string
    taskList: string
    taskListDesc: string
    image: string
    imageDesc: string
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
      heading1: '标题1',
      heading1Desc: '大标题',
      heading2: '标题2',
      heading2Desc: '中标题',
      heading3: '标题3',
      heading3Desc: '小标题',
      bulletList: '无序列表',
      bulletListDesc: '创建简单的项目列表',
      orderedList: '有序列表',
      orderedListDesc: '创建带编号的列表',
      taskList: '任务列表',
      taskListDesc: '创建带复选框的任务列表',
      image: '图片',
      imageDesc: '插入本地图片或图床图片',
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
          const file = await open({
            multiple: false,
            filters: [
              {
                name: 'Images',
                extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
              },
            ],
          })

          if (!file) {
            // User cancelled, remove placeholder
            editor.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run()
            return
          }

          const activeFilePath = useArticleStore.getState().activeFilePath
          // open 返回的是文件路径字符串，需要读取文件内容并转换为 File 对象
          let fileObj: File
          if (typeof file === 'string') {
            const fileData = await readFile(file)
            const ext = file.split('.').pop() || 'png'
            const fileName = file.split('/').pop() || `image.${ext}`
            // 创建 ArrayBuffer 副本以避免类型问题
            const arrayBuffer = new Uint8Array(fileData).buffer
            fileObj = new File([arrayBuffer], fileName, { type: `image/${ext}` })
          } else {
            fileObj = file
          }

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

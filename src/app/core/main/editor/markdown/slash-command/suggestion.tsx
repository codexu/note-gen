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
  Image,
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

// 缓存的 items 数组
let cachedItems: SlashCommandItem[] | null = null

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

export const suggestionItems = (): SlashCommandItem[] => {
  if (cachedItems) {
    return cachedItems
  }

  cachedItems = [
    // AI
    {
      title: '续写',
      description: 'AI 续写内容',
      icon: <Sparkles className="w-4 h-4" />,
      group: 'AI',
      searchTerms: ['ai', 'continue', 'write', 'completion'],
      ...createCustomEventCommand('tiptap-ai-continue'),
    },
    {
      title: '标题1',
      description: '大标题',
      icon: <Heading1 className="w-4 h-4" />,
      group: '标题',
      searchTerms: ['heading', 'h1', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
      },
    },
    {
      title: '标题2',
      description: '中标题',
      icon: <Heading2 className="w-4 h-4" />,
      group: '标题',
      searchTerms: ['heading', 'h2', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
      },
    },
    {
      title: '标题3',
      description: '小标题',
      icon: <Heading3 className="w-4 h-4" />,
      group: '标题',
      searchTerms: ['heading', 'h3', 'header'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
      },
    },

    // 列表
    {
      title: '无序列表',
      description: '创建简单的项目列表',
      icon: <List className="w-4 h-4" />,
      group: '列表',
      searchTerms: ['bullet', 'ul', 'list'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
    },
    {
      title: '有序列表',
      description: '创建带编号的列表',
      icon: <ListOrdered className="w-4 h-4" />,
      group: '列表',
      searchTerms: ['ordered', 'ol', 'numbered', 'list'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
    },
    {
      title: '任务列表',
      description: '创建带复选框的任务列表',
      icon: <CheckSquare className="w-4 h-4" />,
      group: '列表',
      searchTerms: ['task', 'todo', 'checkbox', 'checklist'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
      },
    },

    // 块级元素
    {
      title: '图片',
      description: '插入本地图片或图床图片',
      icon: <Image className="w-4 h-4" />,
      group: '块级',
      searchTerms: ['image', 'picture', 'photo', 'img'],
      command: async ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).run()

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

          if (!file) return

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

          editor.chain().focus().insertContent({
            type: 'image',
            attrs: {
              src: result.src,
              alt: fileObj.name,
              relativeSrc: result.relativePath,
            },
          }).run()

          toast({
            title: result.useImageHosting ? '上传成功' : '保存成功',
            description: result.useImageHosting ? '' : `保存路径: ${result.relativePath}`,
          })
        } catch (error) {
          toast({
            title: '插入图片失败',
            description: error instanceof Error ? error.message : '未知错误',
            variant: 'destructive',
          })
        }
      },
    },
    {
      title: '表格',
      description: '插入表格',
      icon: <Table className="w-4 h-4" />,
      group: '块级',
      searchTerms: ['table', 'grid', 'matrix'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      },
    },
    {
      title: '引用',
      description: '捕获引用内容',
      icon: <Quote className="w-4 h-4" />,
      group: '块级',
      searchTerms: ['blockquote', 'quote', 'citation'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
      },
    },
    {
      title: '代码块',
      description: '捕获代码片段',
      icon: <Code className="w-4 h-4" />,
      group: '块级',
      searchTerms: ['code', 'pre', 'programming'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
      },
    },
    {
      title: '分割线',
      description: '在元素之间创建分隔线',
      icon: <Minus className="w-4 h-4" />,
      group: '块级',
      searchTerms: ['hr', 'horizontal', 'divider', 'line'],
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
    },

    // 数学公式
    {
      title: '行内公式',
      description: '插入行内 LaTeX 公式',
      icon: <Sigma className="w-4 h-4" />,
      group: '数学',
      searchTerms: ['math', 'inline', 'latex', 'formula', 'inline-math'],
      ...createCustomEventCommand('tiptap-insert-inline-math'),
    },
    {
      title: '块级公式',
      description: '插入块级 LaTeX 公式',
      icon: <Sigma className="w-4 h-4" />,
      group: '数学',
      searchTerms: ['math', 'block', 'latex', 'formula', 'block-math', 'display'],
      ...createCustomEventCommand('tiptap-insert-block-math'),
    },

    // 图表
    {
      title: '流程图',
      description: '插入流程图',
      icon: <GitBranch className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'flowchart', 'diagram', '流程图'],
      ...createMermaidCommand('flowchart'),
    },
    {
      title: '时序图',
      description: '插入时序图',
      icon: <GitCommit className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'sequence', 'sequenceDiagram', '时序图'],
      ...createMermaidCommand('sequence'),
    },
    {
      title: '甘特图',
      description: '插入甘特图',
      icon: <Calendar className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'gantt', '甘特图'],
      ...createMermaidCommand('gantt'),
    },
    {
      title: '类图',
      description: '插入类图',
      icon: <Layers className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'class', 'classDiagram', '类图'],
      ...createMermaidCommand('classDiagram'),
    },
    {
      title: '状态图',
      description: '插入状态图',
      icon: <Activity className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'state', 'stateDiagram', '状态图'],
      ...createMermaidCommand('stateDiagram'),
    },
    {
      title: '饼图',
      description: '插入饼图',
      icon: <PieChart className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'pie', '饼图', 'chart'],
      ...createMermaidCommand('pie'),
    },
    {
      title: 'ER图',
      description: '插入实体关系图',
      icon: <Database className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'er', 'erDiagram', 'ER图'],
      ...createMermaidCommand('er'),
    },
    {
      title: '旅程图',
      description: '插入用户旅程图',
      icon: <Map className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'journey', '旅程图'],
      ...createMermaidCommand('journey'),
    },
  ]

  return cachedItems
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

  // Check if we're at the start of a text node or have text directly before position
  const nodeBefore = $pos.nodeBefore
  const text = nodeBefore?.isText && nodeBefore.text

  if (!text) {
    return null
  }

  const textFrom = $pos.pos - text.length
  const slashIndex = text.lastIndexOf('/')

  if (slashIndex === -1) {
    return null
  }

  const from = textFrom + slashIndex
  const to = $pos.pos

  return {
    range: { from, to },
    query: text.slice(slashIndex + 1),
    text: text.slice(slashIndex),
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

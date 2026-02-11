import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Image,
  Table,
  Minus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
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
} from 'lucide-react'
import { SuggestionProps } from '@tiptap/suggestion'
import { type Editor } from '@tiptap/core'

export interface SlashCommandItem {
  title: string
  description?: string
  icon: React.ReactNode
  group: string
  searchTerms?: string[]
  command: (props: { editor: Editor; range: any }) => void
}

export const suggestionItems = () => {
  return [
    // AI
    {
      title: '续写',
      description: 'AI 续写内容',
      icon: <Sparkles className="w-4 h-4" />,
      group: 'AI',
      searchTerms: ['ai', 'continue', 'write', 'completion'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-ai-continue')
        document.dispatchEvent(event)
      },
    },
    {
      title: '标题1',
      description: '大标题',
      icon: <Heading1 className="w-4 h-4" />,
      group: '标题',
      searchTerms: ['heading', 'h1', 'header'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
      },
    },
    {
      title: '标题2',
      description: '中标题',
      icon: <Heading2 className="w-4 h-4" />,
      group: '标题',
      searchTerms: ['heading', 'h2', 'header'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
      },
    },
    {
      title: '标题3',
      description: '小标题',
      icon: <Heading3 className="w-4 h-4" />,
      group: '标题',
      searchTerms: ['heading', 'h3', 'header'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
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
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
    },
    {
      title: '有序列表',
      description: '创建带编号的列表',
      icon: <ListOrdered className="w-4 h-4" />,
      group: '列表',
      searchTerms: ['ordered', 'ol', 'numbered', 'list'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
    },
    {
      title: '任务列表',
      description: '创建带复选框的任务列表',
      icon: <CheckSquare className="w-4 h-4" />,
      group: '列表',
      searchTerms: ['task', 'todo', 'checkbox', 'checklist'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
      },
    },

    // 块级元素
    {
      title: '引用',
      description: '捕获引用内容',
      icon: <Quote className="w-4 h-4" />,
      group: '块级',
      searchTerms: ['blockquote', 'quote', 'citation'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
      },
    },
    {
      title: '代码块',
      description: '捕获代码片段',
      icon: <Code className="w-4 h-4" />,
      group: '块级',
      searchTerms: ['code', 'pre', 'programming'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
      },
    },
    {
      title: '分割线',
      description: '在元素之间创建分隔线',
      icon: <Minus className="w-4 h-4" />,
      group: '块级',
      searchTerms: ['hr', 'horizontal', 'divider', 'line'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
    },

    // 对齐
    {
      title: '左对齐',
      description: '将内容左对齐',
      icon: <AlignLeft className="w-4 h-4" />,
      group: '对齐',
      searchTerms: ['align', 'left', 'justify'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).setTextAlign('left').run()
      },
    },
    {
      title: '居中对齐',
      description: '将内容居中对齐',
      icon: <AlignCenter className="w-4 h-4" />,
      group: '对齐',
      searchTerms: ['align', 'center', 'middle'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).setTextAlign('center').run()
      },
    },
    {
      title: '右对齐',
      description: '将内容右对齐',
      icon: <AlignRight className="w-4 h-4" />,
      group: '对齐',
      searchTerms: ['align', 'right'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).setTextAlign('right').run()
      },
    },
    {
      title: '两端对齐',
      description: '将内容两端对齐',
      icon: <AlignJustify className="w-4 h-4" />,
      group: '对齐',
      searchTerms: ['align', 'justify', 'full'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).setTextAlign('justify').run()
      },
    },

    // 嵌入
    {
      title: '图片',
      description: '插入图片',
      icon: <Image className="w-4 h-4" />,
      group: '嵌入',
      searchTerms: ['image', 'photo', 'picture', 'img'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-image')
        document.dispatchEvent(event)
      },
    },
    {
      title: '表格',
      description: '插入表格',
      icon: <Table className="w-4 h-4" />,
      group: '嵌入',
      searchTerms: ['table', 'grid', 'matrix'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      },
    },

    // 数学公式
    {
      title: '行内公式',
      description: '插入行内 LaTeX 公式',
      icon: <Sigma className="w-4 h-4" />,
      group: '数学',
      searchTerms: ['math', 'inline', 'latex', 'formula', 'inline-math'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-inline-math')
        document.dispatchEvent(event)
      },
    },
    {
      title: '块级公式',
      description: '插入块级 LaTeX 公式',
      icon: <Sigma className="w-4 h-4" />,
      group: '数学',
      searchTerms: ['math', 'block', 'latex', 'formula', 'block-math', 'display'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-block-math')
        document.dispatchEvent(event)
      },
    },

    // 图表
    {
      title: '流程图',
      description: '插入流程图',
      icon: <GitBranch className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'flowchart', 'diagram', '流程图'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-mermaid', {
          detail: { type: 'flowchart' },
        })
        document.dispatchEvent(event)
      },
    },
    {
      title: '时序图',
      description: '插入时序图',
      icon: <GitCommit className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'sequence', 'sequenceDiagram', '时序图'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-mermaid', {
          detail: { type: 'sequence' },
        })
        document.dispatchEvent(event)
      },
    },
    {
      title: '甘特图',
      description: '插入甘特图',
      icon: <Calendar className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'gantt', '甘特图'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-mermaid', {
          detail: { type: 'gantt' },
        })
        document.dispatchEvent(event)
      },
    },
    {
      title: '类图',
      description: '插入类图',
      icon: <Layers className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'class', 'classDiagram', '类图'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-mermaid', {
          detail: { type: 'classDiagram' },
        })
        document.dispatchEvent(event)
      },
    },
    {
      title: '状态图',
      description: '插入状态图',
      icon: <Activity className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'state', 'stateDiagram', '状态图'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-mermaid', {
          detail: { type: 'stateDiagram' },
        })
        document.dispatchEvent(event)
      },
    },
    {
      title: '饼图',
      description: '插入饼图',
      icon: <PieChart className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'pie', '饼图', 'chart'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-mermaid', {
          detail: { type: 'pie' },
        })
        document.dispatchEvent(event)
      },
    },
    {
      title: 'ER图',
      description: '插入实体关系图',
      icon: <Database className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'er', 'erDiagram', 'ER图'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-mermaid', {
          detail: { type: 'er' },
        })
        document.dispatchEvent(event)
      },
    },
    {
      title: '旅程图',
      description: '插入用户旅程图',
      icon: <Map className="w-4 h-4" />,
      group: '图表',
      searchTerms: ['mermaid', 'journey', '旅程图'],
      command: ({ editor, range }: { editor: Editor; range: any }) => {
        editor.chain().focus().deleteRange(range).run()
        const event = new CustomEvent('tiptap-insert-mermaid', {
          detail: { type: 'journey' },
        })
        document.dispatchEvent(event)
      },
    },
  ]
}

// Simple slash match function - hardcoded to match "/"
function findSlashMatch(config: {
  char: string
  allowSpaces: boolean
  allowedPrefixes: string[] | null
  startOfLine: boolean
  $position: any
}) {
  const { allowSpaces, $position } = config

  // Hardcode to match "/"
  const char = '/'
  const escapedChar = '\\/'
  const regexp = allowSpaces
    ? new RegExp(`${escapedChar}.*?(?=\\s|$)`, 'gm')
    : new RegExp(`(?:^)?${escapedChar}[^\\s]*`, 'gm')

  const nodeBefore = $position.nodeBefore
  const text = nodeBefore?.isText && nodeBefore.text

  if (!text) {
    return null
  }

  const textFrom = $position.pos - text.length
  const matches = Array.from(text.matchAll(regexp)) as RegExpMatchArray[]
  const match = matches[matches.length - 1]

  if (!match || match.input === undefined || match.index === undefined) {
    return null
  }

  const from = textFrom + match.index
  const to = from + match[0].length

  if (from < $position.pos && to >= $position.pos) {
    return {
      range: { from, to },
      query: match[0].slice(char.length),
      text: match[0],
    }
  }

  return null
}

export { findSlashMatch }

// Global callback for menu keyboard handling
let menuKeyDownHandler: ((props: { event: KeyboardEvent }) => boolean) | null = null

export function setMenuKeyDownHandler(handler: ((props: { event: KeyboardEvent }) => boolean) | null) {
  menuKeyDownHandler = handler
}

export const suggestionOptions = {
  items: ({ query }: { query: string }) => {
    return suggestionItems().filter((item) => {
      if (typeof query === 'string' && query.length > 0) {
        const search = query.toLowerCase()
        return (
          item.title.toLowerCase().includes(search) ||
          item.searchTerms?.some((term) => term.includes(search)) ||
          item.description?.toLowerCase().includes(search)
        )
      }
      return true
    })
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

import {
  Sparkles,
  Quote,
  Bold,
  Highlighter,
  MoreHorizontal,
  Link2,
  Type,
  Trash2,
  Rows3,
  Columns3,
  AlignCenter,
  Italic,
  Underline,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  CheckSquare,
  SquareCode,
  Undo2,
  Redo2,
} from 'lucide-react'

const ACTION_META = {
  undo: { label: '撤销', icon: Undo2 },
  redo: { label: '重做', icon: Redo2 },
  ai: { label: 'AI', icon: Sparkles },
  bold: { label: '粗体', icon: Bold },
  highlight: { label: '高亮', icon: Highlighter },
  more: { label: '更多', icon: MoreHorizontal },
  italic: { label: '斜体', icon: Italic },
  underline: { label: '下划线', icon: Underline },
  strike: { label: '删除线', icon: Strikethrough },
  code: { label: '行内代码', icon: Code },
  blockquote: { label: '引用块', icon: Quote },
  bulletList: { label: '无序列表', icon: List },
  orderedList: { label: '有序列表', icon: ListOrdered },
  taskList: { label: '任务列表', icon: CheckSquare },
  codeBlock: { label: '代码块', icon: SquareCode },
  'image-src': { label: '地址', icon: Link2 },
  'image-alt': { label: '说明', icon: Type },
  'delete-image': { label: '删除', icon: Trash2 },
  'add-row': { label: '加行', icon: Rows3 },
  'add-column': { label: '加列', icon: Columns3 },
  align: { label: '对齐', icon: AlignCenter },
} as const

export function buildMobileEditorContextBarViewModel(actions: string[] = []) {
  return {
    showSummary: false,
    showActionText: false,
    hideScrollbar: true,
    buttonVariant: 'ghost' as const,
    buttonSize: 'icon' as const,
    items: actions
      .filter((action): action is keyof typeof ACTION_META => action in ACTION_META)
      .map((action) => ({
        action,
        ...ACTION_META[action],
      })),
  }
}

'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CheckSquare,
  ChevronLeft,
  Code2,
  Database,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  GitBranch,
  GitCommit,
  Calendar,
  Layers,
  List,
  ListOrdered,
  Map,
  Minus,
  MoreHorizontal,
  Pilcrow,
  PieChart,
  Plus,
  Quote,
  Sigma,
  Sparkles,
  Table2,
  Workflow,
} from 'lucide-react'
import { useState, type MouseEvent, type PointerEvent } from 'react'

type MobileWritingToolbarMenu = 'root' | 'ai' | 'title' | 'list' | 'block' | 'math' | 'diagram'

type MobileWritingToolbarAction =
  | 'insert-heading-2'
  | 'insert-task-list'
  | 'insert-blockquote'
  | 'insert-bullet-list'
  | 'insert-ordered-list'
  | 'insert-code-block'
  | 'insert-horizontal-rule'
  | 'insert-image'
  | 'insert-table'
  | 'format-paragraph'
  | 'format-heading-1'
  | 'format-heading-2'
  | 'format-heading-3'
  | 'format-bold'
  | 'format-italic'
  | 'format-highlight'
  | 'ai-continue'
  | 'ai-generate-section'
  | 'ai-generate-summary'
  | 'open-ai-custom'
  | 'open-mobile-more'
  | 'open-search-replace'
  | 'toggle-outline'
  | 'undo'
  | 'redo'
  | 'insert-inline-math'
  | 'insert-block-math'
  | 'insert-mermaid-flowchart'
  | 'insert-mermaid-sequence'
  | 'insert-mermaid-gantt'
  | 'insert-mermaid-class'
  | 'insert-mermaid-state'
  | 'insert-mermaid-pie'
  | 'insert-mermaid-er'
  | 'insert-mermaid-journey'

interface MobileWritingToolbarProps {
  activeActions?: string[]
  onAction: (action: MobileWritingToolbarAction) => void
}

type ToolbarItem =
  | {
      kind: 'menu'
      menu: Exclude<MobileWritingToolbarMenu, 'root'>
      label: string
      icon: typeof Plus
    }
  | {
      kind: 'action'
      action: MobileWritingToolbarAction
      label: string
      icon: typeof Plus
    }

const ROOT_ITEMS: ToolbarItem[] = [
  { kind: 'menu', menu: 'ai', label: 'AI', icon: Sparkles },
  { kind: 'menu', menu: 'title', label: '标题', icon: Heading2 },
  { kind: 'menu', menu: 'list', label: '列表', icon: List },
  { kind: 'menu', menu: 'block', label: '块级', icon: Quote },
  { kind: 'menu', menu: 'math', label: '数学', icon: Sigma },
  { kind: 'menu', menu: 'diagram', label: '图表', icon: Workflow },
  { kind: 'action', action: 'open-mobile-more', label: '更多', icon: MoreHorizontal },
]

const MENU_LABELS: Record<Exclude<MobileWritingToolbarMenu, 'root'>, string> = {
  ai: 'AI',
  title: '标题',
  list: '列表',
  block: '块级',
  math: '数学',
  diagram: '图表',
}

const SECONDARY_ITEMS: Record<Exclude<MobileWritingToolbarMenu, 'root'>, ToolbarItem[]> = {
  ai: [
    { kind: 'action', action: 'ai-continue', label: '续写', icon: Sparkles },
    { kind: 'action', action: 'ai-generate-section', label: '生成章节', icon: Sparkles },
    { kind: 'action', action: 'ai-generate-summary', label: '总结全文', icon: Sparkles },
    { kind: 'action', action: 'open-ai-custom', label: '自定义', icon: Sparkles },
  ],
  title: [
    { kind: 'action', action: 'format-paragraph', label: '正文', icon: Pilcrow },
    { kind: 'action', action: 'format-heading-1', label: '一级标题', icon: Heading1 },
    { kind: 'action', action: 'format-heading-2', label: '二级标题', icon: Heading2 },
    { kind: 'action', action: 'format-heading-3', label: '三级标题', icon: Heading3 },
  ],
  list: [
    { kind: 'action', action: 'insert-bullet-list', label: '无序列表', icon: List },
    { kind: 'action', action: 'insert-ordered-list', label: '有序列表', icon: ListOrdered },
    { kind: 'action', action: 'insert-task-list', label: '待办列表', icon: CheckSquare },
  ],
  block: [
    { kind: 'action', action: 'insert-blockquote', label: '引用', icon: Quote },
    { kind: 'action', action: 'insert-code-block', label: '代码块', icon: Code2 },
    { kind: 'action', action: 'insert-horizontal-rule', label: '分割线', icon: Minus },
    { kind: 'action', action: 'insert-image', label: '图片', icon: ImagePlus },
    { kind: 'action', action: 'insert-table', label: '表格', icon: Table2 },
  ],
  math: [
    { kind: 'action', action: 'insert-inline-math', label: '行内公式', icon: Sigma },
    { kind: 'action', action: 'insert-block-math', label: '块级公式', icon: Sigma },
  ],
  diagram: [
    { kind: 'action', action: 'insert-mermaid-flowchart', label: '流程图', icon: GitBranch },
    { kind: 'action', action: 'insert-mermaid-sequence', label: '时序图', icon: GitCommit },
    { kind: 'action', action: 'insert-mermaid-gantt', label: '甘特图', icon: Calendar },
    { kind: 'action', action: 'insert-mermaid-class', label: '类图', icon: Layers },
    { kind: 'action', action: 'insert-mermaid-state', label: '状态图', icon: Workflow },
    { kind: 'action', action: 'insert-mermaid-pie', label: '饼图', icon: PieChart },
    { kind: 'action', action: 'insert-mermaid-er', label: 'ER 图', icon: Database },
    { kind: 'action', action: 'insert-mermaid-journey', label: '用户旅程', icon: Map },
  ],
}

export function MobileWritingToolbar({
  activeActions = [],
  onAction,
}: MobileWritingToolbarProps) {
  const [activeMenu, setActiveMenu] = useState<MobileWritingToolbarMenu>('root')
  const items = activeMenu === 'root'
    ? ROOT_ITEMS
    : SECONDARY_ITEMS[activeMenu]

  const preventFocusSteal = (event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
  }

  return (
    <div className="mobile-writing-toolbar border-t border-border bg-background/95 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div key={activeMenu} className="mobile-writing-toolbar-track flex items-center gap-1 overflow-x-auto overflow-y-hidden px-2 scrollbar-hide">
        {activeMenu !== 'root' && (
          <Button
            type="button"
            aria-label="返回一级菜单"
            title="返回一级菜单"
            variant="default"
            size="sm"
            className="h-9 min-w-9 shrink-0 rounded-full px-2.5 text-xs"
            onPointerDown={preventFocusSteal}
            onMouseDown={preventFocusSteal}
            onClick={() => setActiveMenu('root')}
          >
            <ChevronLeft className="size-4" />
            <span>{MENU_LABELS[activeMenu]}</span>
          </Button>
        )}

        {items.map((item) => {
          const Icon = item.icon
          const isActive = item.kind === 'action' && activeActions.includes(item.action)

          return (
            <Button
              key={item.kind === 'menu' ? item.menu : item.action}
              type="button"
              aria-label={item.label}
              title={item.label}
              variant="ghost"
              size="sm"
              className={cn(
                'h-9 min-w-9 shrink-0 rounded-full px-2.5 text-xs',
                'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                isActive && 'bg-muted text-foreground',
              )}
              onPointerDown={preventFocusSteal}
              onMouseDown={preventFocusSteal}
              onClick={() => {
                if (item.kind === 'menu') {
                  setActiveMenu(item.menu)
                  return
                }

                onAction(item.action)
                setActiveMenu('root')
              }}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export default MobileWritingToolbar

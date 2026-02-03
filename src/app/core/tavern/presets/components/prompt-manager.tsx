'use client'

import { useState, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { GripVertical, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { 
  PromptItem,
  PromptOrderEntry,
  PROMPT_MARKER_ICONS, 
  PROMPT_MARKER_LABELS 
} from '@/lib/tavern/preset-types'
import { PromptEditorDialog } from './prompt-editor-dialog'

// 简化的 token 估算函数（约 4 字符 = 1 token，对于英文）
// 对于中文约 1.5-2 字符 = 1 token
function estimateTokens(text: string): number {
  if (!text) return 0
  // 简化估算：统计中文和非中文字符
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const otherChars = text.length - chineseChars
  // 中文约 1.5 字符/token，其他约 4 字符/token
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

interface PromptManagerProps {
  prompts: PromptItem[]
  promptOrder: PromptOrderEntry[]
  maxContext?: number  // 最大上下文长度，用于警告
  onChange: (prompts: PromptItem[]) => void
}

export function PromptManager({ prompts, promptOrder, maxContext = 16384, onChange }: PromptManagerProps) {
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // 计算每个提示词的 token 数
  const tokenCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    prompts.forEach(p => {
      counts[p.id] = estimateTokens(p.content)
    })
    return counts
  }, [prompts])

  // 计算启用的提示词总 token 数
  const totalEnabledTokens = useMemo(() => {
    return prompts
      .filter(p => p.enabled && p.content)
      .reduce((sum, p) => sum + (tokenCounts[p.id] || 0), 0)
  }, [prompts, tokenCounts])

  // 是否超出预算警告阈值（50%）
  const isOverBudget = totalEnabledTokens > maxContext * 0.5

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = prompts.findIndex((p) => p.id === active.id)
      const newIndex = prompts.findIndex((p) => p.id === over.id)
      const newPrompts = arrayMove(prompts, oldIndex, newIndex).map((p, i) => ({
        ...p,
        order: i,
      }))
      onChange(newPrompts)
    }
  }

  const handleToggle = (id: string, enabled: boolean) => {
    const newPrompts = prompts.map((p) =>
      p.id === id ? { ...p, enabled } : p
    )
    onChange(newPrompts)
  }

  const handleEdit = (prompt: PromptItem) => {
    setEditingPrompt(prompt)
  }

  const handleSavePrompt = (prompt: PromptItem) => {
    if (isCreating) {
      // 添加新提示词
      const newPrompts = [...prompts, { ...prompt, order: prompts.length }]
      onChange(newPrompts)
      setIsCreating(false)
    } else {
      // 更新现有提示词
      const newPrompts = prompts.map((p) =>
        p.id === prompt.id ? prompt : p
      )
      onChange(newPrompts)
    }
    setEditingPrompt(null)
  }

  const handleDelete = (id: string) => {
    const prompt = prompts.find(p => p.id === id)
    if (prompt?.isSystem) return // 系统提示词不可删除
    
    const newPrompts = prompts
      .filter((p) => p.id !== id)
      .map((p, i) => ({ ...p, order: i }))
    onChange(newPrompts)
  }

  const handleCreateNew = () => {
    const newPrompt: PromptItem = {
      id: `custom_${Date.now()}`,
      name: '新提示词',
      identifier: `custom_${Date.now()}`,
      markerType: 'custom',
      role: 'system',
      content: '',
      enabled: true,
      position: 'relative',
      depth: 0,
      order: prompts.length,
      triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
      forbidOverrides: false,
      isSystem: false,
      marker: false,
      injectionOrder: 100,
      injectionTrigger: [],
    }
    setEditingPrompt(newPrompt)
    setIsCreating(true)
  }

  // 只展示 character_id: 100001 的 order 中的提示词
  const customOrder = promptOrder.find(o => o.characterId === 100001)
  const visibleIdentifiers = new Set(customOrder?.order.map(item => item.identifier) || [])
  const visiblePrompts = prompts.filter(p => visibleIdentifiers.has(p.identifier))

  return (
    <div className="space-y-3">
      {/* Token 统计概览 */}
      <div className={cn(
        "flex items-center justify-between p-2 rounded-lg text-sm",
        isOverBudget ? "bg-amber-500/10 text-amber-600" : "bg-muted/50"
      )}>
        <div className="flex items-center gap-2">
          {isOverBudget && <AlertTriangle className="h-4 w-4" />}
          <span>
            提示词 Token: <strong>{totalEnabledTokens.toLocaleString()}</strong>
          </span>
          <span className="text-muted-foreground">
            / {maxContext.toLocaleString()} ({Math.round(totalEnabledTokens / maxContext * 100)}%)
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleCreateNew}>
          <Plus className="h-4 w-4 mr-1" />
          添加
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        拖拽调整顺序，开关控制启用状态
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visiblePrompts.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            {visiblePrompts.map((prompt) => (
              <SortablePromptItem
                key={prompt.id}
                prompt={prompt}
                tokenCount={tokenCounts[prompt.id] || 0}
                onToggle={(enabled) => handleToggle(prompt.id, enabled)}
                onEdit={() => handleEdit(prompt)}
                onDelete={() => handleDelete(prompt.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editingPrompt && (
        <PromptEditorDialog
          prompt={editingPrompt}
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setEditingPrompt(null)
              setIsCreating(false)
            }
          }}
          onSave={handleSavePrompt}
        />
      )}
    </div>
  )
}

interface SortablePromptItemProps {
  prompt: PromptItem
  tokenCount: number
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

function SortablePromptItem({ prompt, tokenCount, onToggle, onEdit, onDelete }: SortablePromptItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: prompt.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const icon = PROMPT_MARKER_ICONS[prompt.markerType]
  const label = PROMPT_MARKER_LABELS[prompt.markerType]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 p-2 rounded-lg border bg-card',
        isDragging && 'opacity-50',
        !prompt.enabled && 'opacity-60'
      )}
    >
      {/* 拖拽手柄 */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 hover:bg-accent rounded"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>

      {/* 图标和名称 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="font-medium text-sm truncate">{prompt.name}</span>
          {prompt.markerType !== 'custom' && (
            <span className="text-xs text-muted-foreground">({label})</span>
          )}
          {tokenCount > 0 && (
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded-full",
              prompt.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}>
              {tokenCount} tok
            </span>
          )}
        </div>
        {prompt.content && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {prompt.content.slice(0, 50)}
            {prompt.content.length > 50 && '...'}
          </p>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {!prompt.isSystem && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Switch
          checked={prompt.enabled}
          onCheckedChange={onToggle}
          className="ml-1"
        />
      </div>
    </div>
  )
}

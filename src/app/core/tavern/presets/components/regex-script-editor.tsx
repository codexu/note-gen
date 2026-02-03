'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, GripVertical, Code2 } from 'lucide-react'
import { RegexScript, RegexPlacement } from '@/lib/tavern/preset-types'
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
import { cn } from '@/lib/utils'

interface RegexScriptEditorProps {
  scripts: RegexScript[]
  onChange: (scripts: RegexScript[]) => void
}

const PLACEMENT_OPTIONS: { value: RegexPlacement; label: string }[] = [
  { value: 1, label: '用户输入' },
  { value: 2, label: 'AI输出' },
]

// 创建空的正则脚本
function createEmptyScript(): RegexScript {
  return {
    id: `regex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    scriptName: '新正则脚本',
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  }
}

export function RegexScriptEditor({ scripts, onChange }: RegexScriptEditorProps) {
  const [editingScript, setEditingScript] = useState<RegexScript | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = scripts.findIndex((s) => s.id === active.id)
      const newIndex = scripts.findIndex((s) => s.id === over.id)
      onChange(arrayMove(scripts, oldIndex, newIndex))
    }
  }

  const handleAdd = () => {
    setEditingScript(createEmptyScript())
    setDialogOpen(true)
  }

  const handleEdit = (script: RegexScript) => {
    setEditingScript({ ...script })
    setDialogOpen(true)
  }

  const handleDelete = (id: string) => {
    onChange(scripts.filter(s => s.id !== id))
  }

  const handleToggle = (id: string, disabled: boolean) => {
    onChange(scripts.map(s => s.id === id ? { ...s, disabled } : s))
  }

  const handleSave = (script: RegexScript) => {
    const exists = scripts.find(s => s.id === script.id)
    if (exists) {
      onChange(scripts.map(s => s.id === script.id ? script : s))
    } else {
      onChange([...scripts, script])
    }
    setDialogOpen(false)
    setEditingScript(null)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        正则脚本用于处理用户输入和AI输出的文本替换，拖拽调整执行顺序
      </p>

      {/* 脚本列表 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={scripts.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {scripts.map((script) => (
              <SortableRegexItem
                key={script.id}
                script={script}
                onToggle={(disabled) => handleToggle(script.id, disabled)}
                onEdit={() => handleEdit(script)}
                onDelete={() => handleDelete(script.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {scripts.length === 0 && (
        <div className="text-center py-6 text-muted-foreground text-sm">
          暂无正则脚本
        </div>
      )}

      <Button variant="outline" size="sm" onClick={handleAdd}>
        <Plus className="h-4 w-4 mr-1" />
        添加正则脚本
      </Button>

      {/* 编辑弹窗 */}
      {editingScript && (
        <RegexScriptDialog
          script={editingScript}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// 可排序的正则脚本项
interface SortableRegexItemProps {
  script: RegexScript
  onToggle: (disabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

function SortableRegexItem({ script, onToggle, onEdit, onDelete }: SortableRegexItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: script.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border bg-card',
        isDragging && 'opacity-50',
        script.disabled && 'opacity-60 bg-muted/30'
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
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium truncate">{script.scriptName}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {script.findRegex || '(无正则表达式)'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={!script.disabled}
          onCheckedChange={(checked) => onToggle(!checked)}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// 正则脚本编辑弹窗
interface RegexScriptDialogProps {
  script: RegexScript
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (script: RegexScript) => void
}

function RegexScriptDialog({ script, open, onOpenChange, onSave }: RegexScriptDialogProps) {
  const [formData, setFormData] = useState<RegexScript>(script)

  const handlePlacementToggle = (placement: RegexPlacement, checked: boolean) => {
    if (checked) {
      setFormData({
        ...formData,
        placement: [...formData.placement, placement],
      })
    } else {
      setFormData({
        ...formData,
        placement: formData.placement.filter(p => p !== placement),
      })
    }
  }

  const handleSave = () => {
    onSave(formData)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑正则脚本</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 脚本名称 */}
          <div className="space-y-2">
            <Label htmlFor="scriptName">脚本名称</Label>
            <Input
              id="scriptName"
              value={formData.scriptName}
              onChange={(e) => setFormData({ ...formData, scriptName: e.target.value })}
              placeholder="脚本名称"
            />
          </div>

          {/* 查找正则 */}
          <div className="space-y-2">
            <Label htmlFor="findRegex">查找正则表达式</Label>
            <Textarea
              id="findRegex"
              value={formData.findRegex}
              onChange={(e) => setFormData({ ...formData, findRegex: e.target.value })}
              placeholder="例如: /pattern/gi"
              className="min-h-[80px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              支持 JavaScript 正则语法，可包含修饰符
            </p>
          </div>

          {/* 替换字符串 */}
          <div className="space-y-2">
            <Label htmlFor="replaceString">替换字符串</Label>
            <Textarea
              id="replaceString"
              value={formData.replaceString}
              onChange={(e) => setFormData({ ...formData, replaceString: e.target.value })}
              placeholder="替换内容，可使用 $1, $2 等捕获组"
              className="min-h-[60px] font-mono text-sm"
            />
          </div>

          {/* 应用位置 */}
          <div className="space-y-2">
            <Label>应用位置</Label>
            <div className="flex gap-4">
              {PLACEMENT_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`placement-${option.value}`}
                    checked={formData.placement.includes(option.value)}
                    onCheckedChange={(checked) =>
                      handlePlacementToggle(option.value, checked as boolean)
                    }
                  />
                  <label
                    htmlFor={`placement-${option.value}`}
                    className="text-sm cursor-pointer"
                  >
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* 深度范围 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="minDepth">最小深度</Label>
              <Input
                id="minDepth"
                type="number"
                value={formData.minDepth ?? ''}
                onChange={(e) => setFormData({
                  ...formData,
                  minDepth: e.target.value ? parseInt(e.target.value) : null,
                })}
                placeholder="留空=不限"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxDepth">最大深度</Label>
              <Input
                id="maxDepth"
                type="number"
                value={formData.maxDepth ?? ''}
                onChange={(e) => setFormData({
                  ...formData,
                  maxDepth: e.target.value ? parseInt(e.target.value) : null,
                })}
                placeholder="留空=不限"
              />
            </div>
          </div>

          {/* 开关选项 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>仅Markdown</Label>
                <p className="text-xs text-muted-foreground">仅在Markdown渲染时应用</p>
              </div>
              <Switch
                checked={formData.markdownOnly}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, markdownOnly: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>仅提示词</Label>
                <p className="text-xs text-muted-foreground">仅应用于提示词处理</p>
              </div>
              <Switch
                checked={formData.promptOnly}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, promptOnly: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>编辑时运行</Label>
                <p className="text-xs text-muted-foreground">在编辑消息时也应用此脚本</p>
              </div>
              <Switch
                checked={formData.runOnEdit}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, runOnEdit: checked })
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

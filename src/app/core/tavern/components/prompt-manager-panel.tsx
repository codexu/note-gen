'use client'

import { useState, useCallback } from 'react'
import {
  usePromptManagerStore,
  PromptEntry,
  PromptOrderEntry,
  InjectionPosition,
  DEFAULT_PROMPTS,
  DEFAULT_PROMPT_ORDER,
} from '@/stores/tavern-prompt-manager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  ListOrdered,
  GripVertical,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Settings2,
  RotateCcw,
  Download,
  Upload,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'

interface PromptManagerPanelProps {
  cardId?: number
  compact?: boolean
}

export function PromptManagerPanel({ cardId, compact = false }: PromptManagerPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<PromptEntry | null>(null)
  const [isAddingNew, setIsAddingNew] = useState(false)
  
  const {
    prompts,
    globalPromptOrder,
    orderStrategy,
    activeCharacterId,
    getActivePromptOrder,
    togglePrompt,
    movePrompt,
    addPrompt,
    deletePrompt,
    updatePrompt,
    setOrderStrategy,
    setActiveCharacter,
    resetToDefault,
    exportConfig,
    importConfig,
  } = usePromptManagerStore()
  
  const promptOrder = getActivePromptOrder()
  
  // 获取提示词详情
  const getPromptDetails = useCallback((identifier: string): PromptEntry | undefined => {
    return prompts.find(p => p.identifier === identifier)
  }, [prompts])
  
  // 移动提示词
  const handleMove = useCallback((identifier: string, direction: 'up' | 'down') => {
    const currentIndex = promptOrder.findIndex(e => e.identifier === identifier)
    if (currentIndex < 0) return
    
    const newIndex = direction === 'up' 
      ? Math.max(0, currentIndex - 1)
      : Math.min(promptOrder.length - 1, currentIndex + 1)
    
    if (newIndex !== currentIndex) {
      movePrompt(identifier, newIndex)
    }
  }, [promptOrder, movePrompt])
  
  // 添加新提示词
  const handleAddPrompt = useCallback((newPrompt: Omit<PromptEntry, 'systemPrompt' | 'marker'>) => {
    addPrompt({
      ...newPrompt,
      systemPrompt: false,
      marker: false,
    })
    setIsAddingNew(false)
  }, [addPrompt])
  
  // 导出配置
  const handleExport = useCallback(() => {
    const config = exportConfig()
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prompt-manager-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [exportConfig])
  
  // 导入配置
  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      try {
        const text = await file.text()
        const config = JSON.parse(text)
        importConfig(config)
      } catch (err) {
        console.error('导入失败:', err)
      }
    }
    input.click()
  }, [importConfig])

  // 紧凑模式按钮
  if (compact) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ListOrdered className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>提示词管理器</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-80 p-0" align="end">
          <PromptManagerContent
            prompts={prompts}
            promptOrder={promptOrder}
            orderStrategy={orderStrategy}
            cardId={cardId}
            onToggle={togglePrompt}
            onMove={handleMove}
            onEdit={setEditingPrompt}
            onDelete={deletePrompt}
            onAddNew={() => setIsAddingNew(true)}
            onExport={handleExport}
            onImport={handleImport}
            onReset={resetToDefault}
            onStrategyChange={setOrderStrategy}
            getPromptDetails={getPromptDetails}
          />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <ListOrdered className="h-4 w-4" />
          提示词管理器
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>提示词管理器</DialogTitle>
        </DialogHeader>
        <PromptManagerContent
          prompts={prompts}
          promptOrder={promptOrder}
          orderStrategy={orderStrategy}
          cardId={cardId}
          onToggle={togglePrompt}
          onMove={handleMove}
          onEdit={setEditingPrompt}
          onDelete={deletePrompt}
          onAddNew={() => setIsAddingNew(true)}
          onExport={handleExport}
          onImport={handleImport}
          onReset={resetToDefault}
          onStrategyChange={setOrderStrategy}
          getPromptDetails={getPromptDetails}
          expanded
        />
      </DialogContent>
      
      {/* 编辑提示词对话框 */}
      {editingPrompt && (
        <PromptEditDialog
          prompt={editingPrompt}
          onSave={(updates) => {
            updatePrompt(editingPrompt.identifier, updates)
            setEditingPrompt(null)
          }}
          onClose={() => setEditingPrompt(null)}
        />
      )}
      
      {/* 添加新提示词对话框 */}
      {isAddingNew && (
        <PromptAddDialog
          onAdd={handleAddPrompt}
          onClose={() => setIsAddingNew(false)}
        />
      )}
    </Dialog>
  )
}

// 提示词管理器内容
interface PromptManagerContentProps {
  prompts: PromptEntry[]
  promptOrder: PromptOrderEntry[]
  orderStrategy: 'global' | 'character'
  cardId?: number
  onToggle: (identifier: string, enabled?: boolean) => void
  onMove: (identifier: string, direction: 'up' | 'down') => void
  onEdit: (prompt: PromptEntry) => void
  onDelete: (identifier: string) => boolean
  onAddNew: () => void
  onExport: () => void
  onImport: () => void
  onReset: () => void
  onStrategyChange: (strategy: 'global' | 'character') => void
  getPromptDetails: (identifier: string) => PromptEntry | undefined
  expanded?: boolean
}

function PromptManagerContent({
  prompts,
  promptOrder,
  orderStrategy,
  cardId,
  onToggle,
  onMove,
  onEdit,
  onDelete,
  onAddNew,
  onExport,
  onImport,
  onReset,
  onStrategyChange,
  getPromptDetails,
  expanded = false,
}: PromptManagerContentProps) {
  return (
    <div className="flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Select value={orderStrategy} onValueChange={(v) => onStrategyChange(v as 'global' | 'character')}>
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">全局</SelectItem>
              <SelectItem value="character">角色</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onAddNew}>
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>添加提示词</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onExport}>
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>导出配置</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onImport}>
                <Upload className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>导入配置</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onReset}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重置为默认</TooltipContent>
          </Tooltip>
        </div>
      </div>
      
      {/* 提示词列表 */}
      <ScrollArea className={expanded ? 'h-[400px]' : 'h-[300px]'}>
        <div className="p-2 space-y-1">
          {promptOrder.map((entry, index) => {
            const prompt = getPromptDetails(entry.identifier)
            if (!prompt) return null
            
            return (
              <PromptOrderItem
                key={entry.identifier}
                entry={entry}
                prompt={prompt}
                index={index}
                total={promptOrder.length}
                onToggle={() => onToggle(entry.identifier)}
                onMoveUp={() => onMove(entry.identifier, 'up')}
                onMoveDown={() => onMove(entry.identifier, 'down')}
                onEdit={() => onEdit(prompt)}
                onDelete={() => onDelete(entry.identifier)}
              />
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

// 提示词顺序项
interface PromptOrderItemProps {
  entry: PromptOrderEntry
  prompt: PromptEntry
  index: number
  total: number
  onToggle: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onDelete: () => void
}

function PromptOrderItem({
  entry,
  prompt,
  index,
  total,
  onToggle,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: PromptOrderItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 p-2 rounded-md border',
        entry.enabled ? 'bg-background' : 'bg-muted/50 opacity-60'
      )}
    >
      {/* 拖拽手柄 */}
      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
      
      {/* 启用开关 */}
      <Switch
        checked={entry.enabled}
        onCheckedChange={onToggle}
        className="scale-75"
      />
      
      {/* 名称和标识 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{prompt.name}</span>
          {prompt.marker && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
              动态
            </span>
          )}
          {prompt.systemPrompt && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
              系统
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{prompt.identifier}</span>
      </div>
      
      {/* 操作按钮 */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onMoveUp}
          disabled={index === 0}
        >
          <ChevronUp className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onMoveDown}
          disabled={index === total - 1}
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onEdit}
        >
          <Settings2 className="h-3 w-3" />
        </Button>
        {!prompt.systemPrompt && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}


// 编辑提示词对话框
interface PromptEditDialogProps {
  prompt: PromptEntry
  onSave: (updates: Partial<PromptEntry>) => void
  onClose: () => void
}

function PromptEditDialog({ prompt, onSave, onClose }: PromptEditDialogProps) {
  const [name, setName] = useState(prompt.name)
  const [content, setContent] = useState(prompt.content)
  const [role, setRole] = useState(prompt.role)
  const [injectionPosition, setInjectionPosition] = useState(prompt.injectionPosition)
  const [injectionDepth, setInjectionDepth] = useState(prompt.injectionDepth)
  
  const handleSave = () => {
    onSave({
      name,
      content,
      role,
      injectionPosition,
      injectionDepth,
    })
  }
  
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑提示词: {prompt.identifier}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          
          {!prompt.marker && (
            <div className="space-y-2">
              <Label>内容</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="提示词内容..."
              />
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>角色</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'system' | 'user' | 'assistant')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">系统</SelectItem>
                  <SelectItem value="user">用户</SelectItem>
                  <SelectItem value="assistant">助手</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>注入位置</Label>
              <Select
                value={injectionPosition.toString()}
                onValueChange={(v) => setInjectionPosition(parseInt(v) as InjectionPosition)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">相对位置</SelectItem>
                  <SelectItem value="1">绝对位置</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {injectionPosition === InjectionPosition.Absolute && (
            <div className="space-y-2">
              <Label>注入深度</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={injectionDepth}
                onChange={(e) => setInjectionDepth(parseInt(e.target.value) || 0)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 添加提示词对话框
interface PromptAddDialogProps {
  onAdd: (prompt: Omit<PromptEntry, 'systemPrompt' | 'marker'>) => void
  onClose: () => void
}

function PromptAddDialog({ onAdd, onClose }: PromptAddDialogProps) {
  const [identifier, setIdentifier] = useState('')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [role, setRole] = useState<'system' | 'user' | 'assistant'>('system')
  const [injectionPosition, setInjectionPosition] = useState(InjectionPosition.Relative)
  const [injectionDepth, setInjectionDepth] = useState(0)
  
  const handleAdd = () => {
    if (!identifier.trim() || !name.trim()) return
    
    onAdd({
      identifier: identifier.trim(),
      name: name.trim(),
      content,
      role,
      injectionPosition,
      injectionDepth,
      injectionOrder: 100,
      forbidOverrides: false,
    })
  }
  
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加新提示词</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>标识符</Label>
              <Input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="my_prompt"
              />
            </div>
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="我的提示词"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>内容</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="提示词内容..."
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>角色</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'system' | 'user' | 'assistant')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">系统</SelectItem>
                  <SelectItem value="user">用户</SelectItem>
                  <SelectItem value="assistant">助手</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>注入位置</Label>
              <Select
                value={injectionPosition.toString()}
                onValueChange={(v) => setInjectionPosition(parseInt(v) as InjectionPosition)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">相对位置</SelectItem>
                  <SelectItem value="1">绝对位置</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {injectionPosition === InjectionPosition.Absolute && (
            <div className="space-y-2">
              <Label>注入深度</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={injectionDepth}
                onChange={(e) => setInjectionDepth(parseInt(e.target.value) || 0)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleAdd} disabled={!identifier.trim() || !name.trim()}>
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

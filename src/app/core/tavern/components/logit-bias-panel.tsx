'use client'

import { useState, useCallback } from 'react'
import { useTavernLogitBiasStore, LogitBiasEntry, LogitBiasPreset } from '@/stores/tavern-logit-bias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Scale,
  Plus,
  Trash2,
  GripVertical,
  Settings2,
  Save,
  Copy,
  HelpCircle,
} from 'lucide-react'

interface LogitBiasPanelProps {
  cardId?: number
  compact?: boolean
  className?: string
}

export function LogitBiasPanel({
  cardId,
  compact = false,
  className,
}: LogitBiasPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')

  const {
    presets,
    currentPresetId,
    cardBindings,
    getCurrentPreset,
    getPresetForCard,
    createPreset,
    updatePreset,
    deletePreset,
    selectPreset,
    addEntry,
    updateEntry,
    removeEntry,
    bindPresetToCard,
  } = useTavernLogitBiasStore()

  // 获取当前使用的预设
  const activePreset = cardId ? getPresetForCard(cardId) : getCurrentPreset()
  const boundPresetId = cardId ? cardBindings[cardId] : null

  // 创建新预设
  const handleCreatePreset = useCallback(() => {
    if (!newPresetName.trim()) return
    const id = createPreset(newPresetName.trim())
    if (cardId) {
      bindPresetToCard(cardId, id)
    }
    setNewPresetName('')
    setIsCreateDialogOpen(false)
  }, [newPresetName, createPreset, cardId, bindPresetToCard])

  // 复制预设
  const handleDuplicatePreset = useCallback((preset: LogitBiasPreset) => {
    const id = createPreset(`${preset.name} (副本)`)
    // 复制条目
    for (const entry of preset.entries) {
      addEntry(id)
      const newPreset = presets.find(p => p.id === id)
      if (newPreset && newPreset.entries.length > 0) {
        const newEntry = newPreset.entries[newPreset.entries.length - 1]
        updateEntry(id, newEntry.id, {
          text: entry.text,
          value: entry.value,
          enabled: entry.enabled,
        })
      }
    }
  }, [createPreset, addEntry, presets, updateEntry])

  // 选择预设
  const handleSelectPreset = useCallback((presetId: string) => {
    selectPreset(presetId)
    if (cardId) {
      bindPresetToCard(cardId, presetId)
    }
  }, [selectPreset, cardId, bindPresetToCard])

  // 解绑角色预设
  const handleUnbindCard = useCallback(() => {
    if (cardId) {
      bindPresetToCard(cardId, null)
    }
  }, [cardId, bindPresetToCard])

  // 获取启用的条目数量
  const enabledCount = activePreset?.entries.filter(e => e.enabled && e.text.trim()).length || 0

  // 紧凑模式 - 只显示按钮
  if (compact) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 gap-1 text-xs',
                  enabledCount > 0 && 'text-purple-600',
                  className
                )}
              >
                <Scale className="h-4 w-4" />
                {enabledCount > 0 && (
                  <span className="hidden sm:inline">{enabledCount}</span>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Logit Bias ({enabledCount} 条启用)</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96 p-0" align="end">
          <LogitBiasContent
            presets={presets}
            activePreset={activePreset}
            currentPresetId={currentPresetId}
            boundPresetId={boundPresetId}
            cardId={cardId}
            onSelectPreset={handleSelectPreset}
            onUnbindCard={handleUnbindCard}
            onCreatePreset={() => setIsCreateDialogOpen(true)}
            onDuplicatePreset={handleDuplicatePreset}
            onDeletePreset={deletePreset}
            onAddEntry={addEntry}
            onUpdateEntry={updateEntry}
            onRemoveEntry={removeEntry}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // 完整模式
  return (
    <div className={cn('space-y-4', className)}>
      <LogitBiasContent
        presets={presets}
        activePreset={activePreset}
        currentPresetId={currentPresetId}
        boundPresetId={boundPresetId}
        cardId={cardId}
        onSelectPreset={handleSelectPreset}
        onUnbindCard={handleUnbindCard}
        onCreatePreset={() => setIsCreateDialogOpen(true)}
        onDuplicatePreset={handleDuplicatePreset}
        onDeletePreset={deletePreset}
        onAddEntry={addEntry}
        onUpdateEntry={updateEntry}
        onRemoveEntry={removeEntry}
        expanded
      />

      {/* 创建预设对话框 */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建 Logit Bias 预设</DialogTitle>
            <DialogDescription>
              创建一个新的 Logit Bias 预设来调整 token 生成概率
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="preset-name">预设名称</Label>
              <Input
                id="preset-name"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="输入预设名称"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreatePreset()
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreatePreset} disabled={!newPresetName.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


// 内容组件
interface LogitBiasContentProps {
  presets: LogitBiasPreset[]
  activePreset: LogitBiasPreset | null
  currentPresetId: string | null
  boundPresetId: string | null
  cardId?: number
  onSelectPreset: (presetId: string) => void
  onUnbindCard: () => void
  onCreatePreset: () => void
  onDuplicatePreset: (preset: LogitBiasPreset) => void
  onDeletePreset: (presetId: string) => void
  onAddEntry: (presetId: string) => void
  onUpdateEntry: (presetId: string, entryId: string, updates: Partial<Omit<LogitBiasEntry, 'id'>>) => void
  onRemoveEntry: (presetId: string, entryId: string) => void
  expanded?: boolean
}

function LogitBiasContent({
  presets,
  activePreset,
  currentPresetId,
  boundPresetId,
  cardId,
  onSelectPreset,
  onUnbindCard,
  onCreatePreset,
  onDuplicatePreset,
  onDeletePreset,
  onAddEntry,
  onUpdateEntry,
  onRemoveEntry,
  expanded = false,
}: LogitBiasContentProps) {
  const [showHelp, setShowHelp] = useState(false)

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-purple-600" />
          <span className="font-medium text-sm">Logit Bias</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowHelp(!showHelp)}
              >
                <HelpCircle className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                Logit Bias 可以调整特定 token 的生成概率。
                正值增加出现概率，负值减少出现概率。
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <Button variant="ghost" size="sm" onClick={onCreatePreset}>
          <Plus className="h-4 w-4 mr-1" />
          新建
        </Button>
      </div>

      {/* 帮助信息 */}
      {showHelp && (
        <div className="p-3 bg-muted/50 border-b text-xs space-y-1">
          <p><strong>文本格式:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
            <li><code>hello</code> - 普通文本 (自动添加前导空格)</li>
            <li><code>{'{'}hello{'}'}</code> - 精确文本 (不添加空格)</li>
            <li><code>[123, 456]</code> - Token ID 数组</li>
          </ul>
          <p className="mt-2"><strong>偏置值:</strong> -100 到 100</p>
          <p className="text-muted-foreground">正值增加概率，负值减少概率，-100 几乎禁止</p>
        </div>
      )}

      {/* 预设选择 */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2">
          <Select
            value={activePreset?.id || ''}
            onValueChange={onSelectPreset}
          >
            <SelectTrigger className="flex-1 h-8">
              <SelectValue placeholder="选择预设" />
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  <div className="flex items-center gap-2">
                    <span>{preset.name}</span>
                    {preset.isDefault && (
                      <span className="text-xs text-muted-foreground">(默认)</span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activePreset && !activePreset.isDefault && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onDuplicatePreset(activePreset)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>复制预设</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => onDeletePreset(activePreset.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>删除预设</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
        {cardId && boundPresetId && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>已绑定到当前角色</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={onUnbindCard}
            >
              解除绑定
            </Button>
          </div>
        )}
      </div>

      {/* 条目列表 */}
      {activePreset && (
        <ScrollArea className={cn('flex-1', expanded ? 'h-[400px]' : 'max-h-[300px]')}>
          <div className="p-3 space-y-2">
            {activePreset.entries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <p>暂无条目</p>
                <p className="text-xs mt-1">点击下方按钮添加</p>
              </div>
            ) : (
              activePreset.entries.map((entry) => (
                <LogitBiasEntryItem
                  key={entry.id}
                  entry={entry}
                  presetId={activePreset.id}
                  onUpdate={onUpdateEntry}
                  onRemove={onRemoveEntry}
                />
              ))
            )}
          </div>
        </ScrollArea>
      )}

      {/* 添加按钮 */}
      {activePreset && (
        <div className="p-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onAddEntry(activePreset.id)}
          >
            <Plus className="h-4 w-4 mr-1" />
            添加条目
          </Button>
        </div>
      )}
    </div>
  )
}

// 条目组件
interface LogitBiasEntryItemProps {
  entry: LogitBiasEntry
  presetId: string
  onUpdate: (presetId: string, entryId: string, updates: Partial<Omit<LogitBiasEntry, 'id'>>) => void
  onRemove: (presetId: string, entryId: string) => void
}

function LogitBiasEntryItem({
  entry,
  presetId,
  onUpdate,
  onRemove,
}: LogitBiasEntryItemProps) {
  // 获取偏置值的颜色
  const getBiasColor = (value: number) => {
    if (value > 50) return 'text-green-600'
    if (value > 0) return 'text-green-500'
    if (value < -50) return 'text-red-600'
    if (value < 0) return 'text-red-500'
    return 'text-muted-foreground'
  }

  return (
    <div className={cn(
      'flex items-center gap-2 p-2 rounded-lg border bg-card',
      !entry.enabled && 'opacity-50'
    )}>
      {/* 拖拽手柄 */}
      <div className="cursor-grab text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* 启用开关 */}
      <Switch
        checked={entry.enabled}
        onCheckedChange={(checked) => onUpdate(presetId, entry.id, { enabled: checked })}
        className="scale-75"
      />

      {/* 文本输入 */}
      <Input
        value={entry.text}
        onChange={(e) => onUpdate(presetId, entry.id, { text: e.target.value })}
        placeholder="文本或 token"
        className="flex-1 h-8 text-sm"
      />

      {/* 偏置值滑块 */}
      <div className="flex items-center gap-2 w-32">
        <Slider
          value={[entry.value]}
          onValueChange={([value]) => onUpdate(presetId, entry.id, { value })}
          min={-100}
          max={100}
          step={1}
          className="flex-1"
        />
        <span className={cn('text-xs font-mono w-8 text-right', getBiasColor(entry.value))}>
          {entry.value > 0 ? '+' : ''}{entry.value}
        </span>
      </div>

      {/* 删除按钮 */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        onClick={() => onRemove(presetId, entry.id)}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  )
}

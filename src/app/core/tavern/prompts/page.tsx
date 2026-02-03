'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePromptManagerStore } from '@/stores/tavern-prompt-manager'
import {
  PromptEntry,
  PromptOrderEntry,
  InjectionPosition,
  PromptRole,
} from '@/lib/tavern/prompt-manager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  Plus,
  RotateCcw,
  GripVertical,
  Pencil,
  Trash2,
  MoreVertical,
  Download,
  Upload,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'

export default function PromptManagerPage() {
  const router = useRouter()
  const {
    prompts: storePrompts,
    getPrompt,
    updatePrompt,
    addPrompt,
    deletePrompt,
    togglePrompt,
    movePrompt,
    getActivePromptOrder,
    exportConfig,
    importConfig,
    resetToDefault,
  } = usePromptManagerStore()
  
  const [prompts, setPrompts] = useState<PromptEntry[]>([])
  const [promptOrder, setLocalPromptOrder] = useState<PromptOrderEntry[]>([])
  const [editingPrompt, setEditingPrompt] = useState<PromptEntry | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isNewPrompt, setIsNewPrompt] = useState(false)
  
  // 初始化和刷新数据
  useEffect(() => {
    refreshData()
  }, [storePrompts])
  
  const refreshData = useCallback(() => {
    setPrompts([...storePrompts])
    setLocalPromptOrder(getActivePromptOrder())
  }, [storePrompts, getActivePromptOrder])
  
  // 获取排序后的提示词列表
  const sortedPrompts = promptOrder.map(entry => {
    const prompt = prompts.find(p => p.identifier === entry.identifier)
    return prompt ? { ...prompt, enabled: entry.enabled } : null
  }).filter(Boolean) as (PromptEntry & { enabled: boolean })[]
  
  // 处理编辑
  const handleEdit = (prompt: PromptEntry) => {
    setEditingPrompt({ ...prompt })
    setIsNewPrompt(false)
    setIsEditDialogOpen(true)
  }
  
  // 处理新建
  const handleNew = () => {
    setEditingPrompt({
      identifier: '',
      name: '',
      role: 'system',
      content: '',
      systemPrompt: false,
      marker: false,
      injectionPosition: InjectionPosition.Relative,
      injectionDepth: 4,
      injectionOrder: 100,
      forbidOverrides: false,
    })
    setIsNewPrompt(true)
    setIsEditDialogOpen(true)
  }
  
  // 保存编辑
  const handleSaveEdit = () => {
    if (!editingPrompt) return
    
    if (isNewPrompt) {
      // 生成唯一标识符
      const identifier = editingPrompt.identifier || `custom_${Date.now()}`
      const newPrompt: PromptEntry = {
        ...editingPrompt,
        identifier,
        systemPrompt: false,
        marker: false,
      }
      addPrompt(newPrompt)
    } else {
      updatePrompt(editingPrompt.identifier, editingPrompt)
    }
    
    setIsEditDialogOpen(false)
    setEditingPrompt(null)
    refreshData()
  }
  
  // 删除提示词
  const handleDelete = (identifier: string) => {
    if (deletePrompt(identifier)) {
      refreshData()
    }
  }
  
  // 切换启用状态
  const handleToggle = (identifier: string) => {
    togglePrompt(identifier)
    refreshData()
  }
  
  // 移动提示词
  const handleMove = (identifier: string, direction: 'up' | 'down') => {
    const currentIndex = promptOrder.findIndex(e => e.identifier === identifier)
    if (currentIndex < 0) return
    
    const newIndex = direction === 'up' 
      ? Math.max(0, currentIndex - 1)
      : Math.min(promptOrder.length - 1, currentIndex + 1)
    
    if (newIndex !== currentIndex) {
      movePrompt(identifier, newIndex)
      refreshData()
    }
  }
  
  // 重置配置
  const handleReset = () => {
    resetToDefault()
    refreshData()
  }
  
  // 导出配置
  const handleExport = () => {
    const config = exportConfig()
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prompt-manager-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  
  // 导入配置
  const handleImport = () => {
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
        refreshData()
      } catch (err) {
        console.error('导入失败:', err)
      }
    }
    input.click()
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">提示词管理器</h1>
            <p className="text-xs text-muted-foreground">
              管理和排序 AI 提示词
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                导出配置
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleImport}>
                <Upload className="h-4 w-4 mr-2" />
                导入配置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleReset} className="text-destructive">
                <RotateCcw className="h-4 w-4 mr-2" />
                重置为默认
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={handleNew}>
            <Plus className="h-4 w-4 mr-1" />
            新建
          </Button>
        </div>
      </div>
      
      {/* 提示词列表 */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {sortedPrompts.map((prompt, index) => (
            <div
              key={prompt.identifier}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border',
                prompt.enabled
                  ? 'bg-card border-border'
                  : 'bg-muted/50 border-transparent opacity-60'
              )}
            >
              {/* 拖拽手柄 */}
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleMove(prompt.identifier, 'up')}
                  disabled={index === 0}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleMove(prompt.identifier, 'down')}
                  disabled={index === sortedPrompts.length - 1}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
              
              {/* 启用开关 */}
              <Switch
                checked={prompt.enabled}
                onCheckedChange={() => handleToggle(prompt.identifier)}
              />
              
              {/* 信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{prompt.name}</span>
                  {prompt.marker && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                      标记
                    </span>
                  )}
                  {prompt.systemPrompt && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                      系统
                    </span>
                  )}
                  {prompt.injectionPosition === InjectionPosition.Absolute && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300">
                      深度 {prompt.injectionDepth}
                    </span>
                  )}
                </div>
                {!prompt.marker && prompt.content && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {prompt.content.slice(0, 100)}
                  </p>
                )}
              </div>
              
              {/* 操作按钮 */}
              <div className="flex items-center gap-1">
                {!prompt.marker && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleEdit(prompt)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {!prompt.systemPrompt && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(prompt.identifier)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      
      {/* 编辑对话框 */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isNewPrompt ? '新建提示词' : '编辑提示词'}
            </DialogTitle>
            <DialogDescription>
              配置提示词的内容和注入位置
            </DialogDescription>
          </DialogHeader>
          
          {editingPrompt && (
            <div className="space-y-4">
              {/* 名称 */}
              <div className="space-y-2">
                <Label>名称</Label>
                <Input
                  value={editingPrompt.name}
                  onChange={(e) => setEditingPrompt({
                    ...editingPrompt,
                    name: e.target.value,
                  })}
                  placeholder="提示词名称"
                />
              </div>
              
              {/* 角色 */}
              <div className="space-y-2">
                <Label>角色</Label>
                <Select
                  value={editingPrompt.role}
                  onValueChange={(value: PromptRole) => setEditingPrompt({
                    ...editingPrompt,
                    role: value,
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="assistant">Assistant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* 内容 */}
              <div className="space-y-2">
                <Label>内容</Label>
                <Textarea
                  value={editingPrompt.content}
                  onChange={(e) => setEditingPrompt({
                    ...editingPrompt,
                    content: e.target.value,
                  })}
                  placeholder="提示词内容，支持 {{char}} {{user}} 等宏"
                  rows={6}
                />
              </div>
              
              {/* 注入位置 */}
              <div className="space-y-2">
                <Label>注入位置</Label>
                <Select
                  value={editingPrompt.injectionPosition.toString()}
                  onValueChange={(value) => setEditingPrompt({
                    ...editingPrompt,
                    injectionPosition: parseInt(value) as InjectionPosition,
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">相对位置 (按顺序)</SelectItem>
                    <SelectItem value="1">绝对位置 (按深度)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* 深度 (仅绝对位置) */}
              {editingPrompt.injectionPosition === InjectionPosition.Absolute && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>注入深度</Label>
                    <Input
                      type="number"
                      min={0}
                      value={editingPrompt.injectionDepth}
                      onChange={(e) => setEditingPrompt({
                        ...editingPrompt,
                        injectionDepth: parseInt(e.target.value) || 0,
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>注入顺序</Label>
                    <Input
                      type="number"
                      min={0}
                      value={editingPrompt.injectionOrder}
                      onChange={(e) => setEditingPrompt({
                        ...editingPrompt,
                        injectionOrder: parseInt(e.target.value) || 100,
                      })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveEdit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

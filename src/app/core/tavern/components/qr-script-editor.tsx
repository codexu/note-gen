'use client'

import { useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import {
  Play,
  Save,
  FileCode,
  Terminal,
  AlertCircle,
  CheckCircle,
  Code,
  Plus,
  Trash2,
  Copy,
  Edit,
  ListOrdered,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { validateScript, executeScriptCommand } from '@/lib/tavern/slash-commands-service'
import { getAllCommands } from '@/lib/tavern/stscript'
import { cn } from '@/lib/utils'

// ============ 类型定义 ============

/**
 * QR 按钮定义
 */
export interface QRButton {
  id: string
  label: string
  script: string
  icon?: string
  color?: string
  /** 触发条件 */
  trigger?: {
    type: 'manual' | 'auto' | 'event'
    event?: string
    condition?: string
  }
  /** 执行设置 */
  settings?: {
    hidden?: boolean
    autoExecute?: boolean
    cooldown?: number
  }
}

/**
 * QR 按钮组
 */
export interface QRButtonSet {
  id: string
  name: string
  buttons: QRButton[]
  enabled: boolean
}

interface QRScriptEditorProps {
  button?: QRButton
  onSave: (button: QRButton) => void
  onDelete?: () => void
  onClose: () => void
  chatId?: number
}

// ============ 脚本编辑器组件 ============

export function QRScriptEditor({
  button,
  onSave,
  onDelete,
  onClose,
  chatId,
}: QRScriptEditorProps) {
  const isNew = !button
  
  const [label, setLabel] = useState(button?.label || '')
  const [script, setScript] = useState(button?.script || '')
  const [color, setColor] = useState(button?.color || 'default')
  const [triggerType, setTriggerType] = useState<'manual' | 'auto' | 'event'>(
    button?.trigger?.type || 'manual'
  )
  const [triggerEvent, setTriggerEvent] = useState(button?.trigger?.event || '')
  const [triggerCondition, setTriggerCondition] = useState(button?.trigger?.condition || '')
  const [autoExecute, setAutoExecute] = useState(button?.settings?.autoExecute || false)
  
  const [testOutput, setTestOutput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [validation, setValidation] = useState<{ valid: boolean; error?: string } | null>(null)
  
  // 验证脚本
  const handleValidate = useCallback(() => {
    const result = validateScript(script)
    setValidation(result)
    if (result.valid) {
      toast({ title: '脚本语法正确' })
    } else {
      toast({ title: '脚本语法错误', description: result.error, variant: 'destructive' })
    }
  }, [script])
  
  // 测试运行脚本
  const handleRun = useCallback(async () => {
    if (!script.trim()) {
      toast({ title: '请输入脚本内容', variant: 'destructive' })
      return
    }
    
    setIsRunning(true)
    setTestOutput('')
    
    try {
      const result = await executeScriptCommand(script, { chatId }, {
        onOutput: (text) => setTestOutput(prev => prev + text + '\n'),
      })
      
      if (result.success) {
        setTestOutput(prev => prev + (result.output || '(执行成功)'))
        toast({ title: '脚本执行成功' })
      } else {
        setTestOutput(prev => prev + `错误: ${result.error}`)
        toast({ title: '脚本执行失败', description: result.error, variant: 'destructive' })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setTestOutput(`异常: ${msg}`)
      toast({ title: '脚本执行异常', description: msg, variant: 'destructive' })
    } finally {
      setIsRunning(false)
    }
  }, [script, chatId])
  
  // 保存按钮
  const handleSave = useCallback(() => {
    if (!label.trim()) {
      toast({ title: '请输入按钮标签', variant: 'destructive' })
      return
    }
    if (!script.trim()) {
      toast({ title: '请输入脚本内容', variant: 'destructive' })
      return
    }
    
    // 验证脚本
    const result = validateScript(script)
    if (!result.valid) {
      toast({ 
        title: '脚本语法错误', 
        description: '是否仍要保存?', 
        variant: 'destructive' 
      })
      // 这里可以添加确认对话框，暂时允许保存
    }
    
    onSave({
      id: button?.id || `qr-${Date.now()}`,
      label: label.trim(),
      script,
      color: color !== 'default' ? color : undefined,
      trigger: triggerType !== 'manual' ? {
        type: triggerType,
        event: triggerEvent || undefined,
        condition: triggerCondition || undefined,
      } : undefined,
      settings: {
        autoExecute,
      },
    })
    
    toast({ title: isNew ? '按钮已创建' : '按钮已保存' })
    onClose()
  }, [button, label, script, color, triggerType, triggerEvent, triggerCondition, autoExecute, isNew, onSave, onClose])
  
  // 获取可用命令列表
  const commands = useMemo(() => getAllCommands(), [])
  
  // 插入命令
  const insertCommand = useCallback((cmdName: string) => {
    setScript(prev => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + `/${cmdName} `)
  }, [])
  
  return (
    <DialogContent className="max-w-4xl max-h-[90vh]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileCode className="h-5 w-5" />
          {isNew ? '创建 QR 按钮' : '编辑 QR 按钮'}
        </DialogTitle>
        <DialogDescription>
          使用 STscript 脚本语言创建自动化按钮
        </DialogDescription>
      </DialogHeader>
      
      <div className="grid grid-cols-3 gap-4 h-[600px]">
        {/* 左侧: 基本设置 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>按钮标签</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="我的脚本"
            />
          </div>
          
          <div className="space-y-2">
            <Label>按钮颜色</Label>
            <Select value={color} onValueChange={setColor}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认</SelectItem>
                <SelectItem value="blue">蓝色</SelectItem>
                <SelectItem value="green">绿色</SelectItem>
                <SelectItem value="yellow">黄色</SelectItem>
                <SelectItem value="red">红色</SelectItem>
                <SelectItem value="purple">紫色</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>触发方式</Label>
            <Select value={triggerType} onValueChange={(v) => setTriggerType(v as typeof triggerType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">手动点击</SelectItem>
                <SelectItem value="auto">自动执行</SelectItem>
                <SelectItem value="event">事件触发</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {triggerType === 'event' && (
            <div className="space-y-2">
              <Label>触发事件</Label>
              <Select value={triggerEvent} onValueChange={setTriggerEvent}>
                <SelectTrigger>
                  <SelectValue placeholder="选择事件" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="message_received">收到消息</SelectItem>
                  <SelectItem value="message_sent">发送消息</SelectItem>
                  <SelectItem value="chat_started">开始聊天</SelectItem>
                  <SelectItem value="generation_complete">生成完成</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          
          {(triggerType === 'auto' || triggerType === 'event') && (
            <div className="space-y-2">
              <Label>执行条件 (可选)</Label>
              <Input
                value={triggerCondition}
                onChange={(e) => setTriggerCondition(e.target.value)}
                placeholder="{{var}} > 10"
                className="font-mono text-sm"
              />
            </div>
          )}
          
          {/* 命令参考 */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <ListOrdered className="h-3 w-3" />
              命令参考
            </Label>
            <ScrollArea className="h-40 border rounded-md">
              <div className="p-2 space-y-1">
                {commands.slice(0, 30).map(cmd => (
                  <Tooltip key={cmd.name}>
                    <TooltipTrigger asChild>
                      <button
                        className="w-full text-left px-2 py-1 text-xs font-mono rounded hover:bg-muted truncate"
                        onClick={() => insertCommand(cmd.name)}
                      >
                        /{cmd.name}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p className="max-w-xs">{cmd.description}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
        
        {/* 中间: 脚本编辑器 */}
        <div className="col-span-2 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1">
              <Code className="h-3 w-3" />
              脚本内容
            </Label>
            <div className="flex items-center gap-1">
              {validation && (
                <Badge variant={validation.valid ? 'default' : 'destructive'} className="text-xs">
                  {validation.valid ? (
                    <><CheckCircle className="h-3 w-3 mr-1" /> 语法正确</>
                  ) : (
                    <><AlertCircle className="h-3 w-3 mr-1" /> 语法错误</>
                  )}
                </Badge>
              )}
              <Button size="sm" variant="outline" onClick={handleValidate}>
                验证
              </Button>
              <Button size="sm" variant="outline" onClick={handleRun} disabled={isRunning}>
                <Play className="h-3 w-3 mr-1" />
                {isRunning ? '运行中...' : '测试'}
              </Button>
            </div>
          </div>
          
          <Textarea
            value={script}
            onChange={(e) => {
              setScript(e.target.value)
              setValidation(null)
            }}
            placeholder={`// 示例脚本
/setvar key=counter value=0
/echo 开始计数...
/addvar key=counter value=1
/getvar key=counter | /echo 当前值: {{pipe}}`}
            className="flex-1 font-mono text-sm resize-none min-h-[300px]"
          />
          
          {/* 测试输出 */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Terminal className="h-3 w-3" />
              测试输出
            </Label>
            <div className="bg-muted/50 rounded-md p-2 min-h-[80px] max-h-[120px] overflow-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {testOutput || '点击"测试"运行脚本...'}
              </pre>
            </div>
          </div>
          
          {/* 语法错误提示 */}
          {validation && !validation.valid && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-2">
              <p className="text-xs text-destructive">{validation.error}</p>
            </div>
          )}
        </div>
      </div>
      
      <DialogFooter className="flex justify-between">
        <div>
          {onDelete && (
            <Button variant="destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4 mr-1" />
              删除
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-1" />
            保存
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  )
}

// ============ QR 按钮面板组件 ============

interface QRButtonsPanelProps {
  buttons: QRButton[]
  onExecute: (button: QRButton) => void
  onEdit?: (button: QRButton) => void
  onAdd?: () => void
  compact?: boolean
}

export function QRButtonsPanel({
  buttons,
  onExecute,
  onEdit,
  onAdd,
  compact = false,
}: QRButtonsPanelProps) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500 hover:bg-blue-600 text-white',
    green: 'bg-green-500 hover:bg-green-600 text-white',
    yellow: 'bg-yellow-500 hover:bg-yellow-600 text-white',
    red: 'bg-red-500 hover:bg-red-600 text-white',
    purple: 'bg-purple-500 hover:bg-purple-600 text-white',
  }
  
  if (buttons.length === 0 && !onAdd) {
    return null
  }
  
  return (
    <div className={cn(
      'flex flex-wrap gap-1',
      compact ? 'p-1' : 'p-2'
    )}>
      {buttons.map(btn => (
        <Tooltip key={btn.id}>
          <TooltipTrigger asChild>
            <Button
              size={compact ? 'sm' : 'default'}
              variant={btn.color ? 'default' : 'outline'}
              className={cn(
                compact ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
                btn.color && colorClasses[btn.color]
              )}
              onClick={() => onExecute(btn)}
              onContextMenu={(e) => {
                e.preventDefault()
                onEdit?.(btn)
              }}
            >
              {btn.label}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>点击执行 | 右键编辑</p>
            {btn.trigger?.type !== 'manual' && (
              <p className="text-xs text-muted-foreground">
                触发: {btn.trigger?.type === 'auto' ? '自动' : btn.trigger?.event}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
      
      {onAdd && (
        <Button
          size={compact ? 'sm' : 'default'}
          variant="ghost"
          className={cn(
            compact ? 'h-7 w-7 p-0' : 'h-8 w-8 p-0'
          )}
          onClick={onAdd}
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

// ============ QR 管理对话框 ============

interface QRManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  buttonSets?: QRButtonSet[]
  onUpdateSets?: (sets: QRButtonSet[]) => void
  cardId?: number
  chatId?: number
  onRefresh?: () => void
}

export function QRManagerDialog({
  open,
  onOpenChange,
  buttonSets = [],
  onUpdateSets,
  cardId,
  chatId,
  onRefresh,
}: QRManagerDialogProps) {
  const [selectedSet, setSelectedSet] = useState<string | null>(
    buttonSets[0]?.id || null
  )
  const [editingButton, setEditingButton] = useState<QRButton | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  
  const currentSet = buttonSets.find(s => s.id === selectedSet)
  
  const handleAddSet = () => {
    if (!onUpdateSets) return
    const newSet: QRButtonSet = {
      id: `set-${Date.now()}`,
      name: `按钮组 ${buttonSets.length + 1}`,
      buttons: [],
      enabled: true,
    }
    onUpdateSets([...buttonSets, newSet])
    setSelectedSet(newSet.id)
  }
  
  const handleDeleteSet = (setId: string) => {
    if (!onUpdateSets) return
    onUpdateSets(buttonSets.filter(s => s.id !== setId))
    if (selectedSet === setId) {
      setSelectedSet(buttonSets[0]?.id || null)
    }
  }
  
  const handleAddButton = () => {
    setEditingButton(null)
    setShowEditor(true)
  }
  
  const handleEditButton = (button: QRButton) => {
    setEditingButton(button)
    setShowEditor(true)
  }
  
  const handleSaveButton = (button: QRButton) => {
    if (!currentSet || !onUpdateSets) return
    
    const updatedButtons = editingButton
      ? currentSet.buttons.map(b => b.id === button.id ? button : b)
      : [...currentSet.buttons, button]
    
    onUpdateSets(buttonSets.map(s =>
      s.id === currentSet.id
        ? { ...s, buttons: updatedButtons }
        : s
    ))
    setShowEditor(false)
    onRefresh?.()
  }
  
  const handleDeleteButton = () => {
    if (!currentSet || !editingButton || !onUpdateSets) return
    
    onUpdateSets(buttonSets.map(s =>
      s.id === currentSet.id
        ? { ...s, buttons: s.buttons.filter(b => b.id !== editingButton.id) }
        : s
    ))
    setShowEditor(false)
    onRefresh?.()
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {showEditor ? (
        <QRScriptEditor
          button={editingButton || undefined}
          onSave={handleSaveButton}
          onDelete={editingButton ? handleDeleteButton : undefined}
          onClose={() => setShowEditor(false)}
          chatId={chatId}
        />
      ) : (
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>QR 按钮管理</DialogTitle>
            <DialogDescription>
              管理快速回复按钮和自动化脚本
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-4 gap-4 h-[400px]">
            {/* 按钮组列表 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">按钮组</Label>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleAddSet}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <ScrollArea className="h-[360px]">
                <div className="space-y-1">
                  {buttonSets.map(set => (
                    <div
                      key={set.id}
                      className={cn(
                        'flex items-center justify-between p-2 rounded cursor-pointer',
                        selectedSet === set.id ? 'bg-primary/10' : 'hover:bg-muted'
                      )}
                      onClick={() => setSelectedSet(set.id)}
                    >
                      <span className="text-sm truncate">{set.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {set.buttons.length}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
            
            {/* 按钮列表 */}
            <div className="col-span-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  {currentSet?.name || '选择按钮组'}
                </Label>
                {currentSet && (
                  <Button size="sm" variant="outline" onClick={handleAddButton}>
                    <Plus className="h-3 w-3 mr-1" />
                    添加按钮
                  </Button>
                )}
              </div>
              <ScrollArea className="h-[360px]">
                {currentSet ? (
                  <div className="space-y-2">
                    {currentSet.buttons.map(btn => (
                      <div
                        key={btn.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{btn.label}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {btn.script.split('\n')[0]}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          {btn.trigger?.type !== 'manual' && (
                            <Badge variant="secondary" className="text-xs">
                              {btn.trigger?.type === 'auto' ? '自动' : '事件'}
                            </Badge>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleEditButton(btn)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {currentSet.buttons.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <p>暂无按钮</p>
                        <p className="text-xs">点击“添加按钮”创建</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>请选择或创建按钮组</p>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

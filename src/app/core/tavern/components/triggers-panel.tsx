'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Zap,
  Plus,
  Trash2,
  Edit,
  Play,
  Pause,
  Copy,
  Save,
  Download,
  Upload,
  Settings,
  AlertCircle,
  CheckCircle,
  Clock,
  Code,
  Variable,
  MessageSquare,
  Bell,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  Trigger,
  TriggerEventType,
  TriggerAction,
  TriggerCondition,
  ConditionGroup,
  ConditionOperator,
  TriggerExecutionResult,
} from '@/lib/tavern/triggers/types'
import {
  getTriggerManager,
  createTrigger,
  emitEvent,
} from '@/lib/tavern/triggers/manager'

// ============ 常量 ============

const EVENT_TYPE_OPTIONS: { value: TriggerEventType; label: string; description: string }[] = [
  { value: TriggerEventType.MESSAGE_RECEIVED, label: '收到消息', description: '当收到角色或系统消息时触发' },
  { value: TriggerEventType.MESSAGE_SENT, label: '发送消息', description: '当用户发送消息时触发' },
  { value: TriggerEventType.MESSAGE_EDITED, label: '编辑消息', description: '当消息被编辑时触发' },
  { value: TriggerEventType.MESSAGE_DELETED, label: '删除消息', description: '当消息被删除时触发' },
  { value: TriggerEventType.GENERATION_STARTED, label: '开始生成', description: '当 AI 开始生成回复时触发' },
  { value: TriggerEventType.GENERATION_COMPLETE, label: '生成完成', description: '当 AI 生成回复完成时触发' },
  { value: TriggerEventType.GENERATION_ABORTED, label: '生成中止', description: '当生成被中止时触发' },
  { value: TriggerEventType.CHAT_STARTED, label: '开始聊天', description: '当新聊天开始时触发' },
  { value: TriggerEventType.CHAT_LOADED, label: '加载聊天', description: '当聊天记录加载时触发' },
  { value: TriggerEventType.CHAT_SAVED, label: '保存聊天', description: '当聊天保存时触发' },
  { value: TriggerEventType.CHARACTER_SELECTED, label: '选择角色', description: '当选择角色时触发' },
  { value: TriggerEventType.CHARACTER_LOADED, label: '加载角色', description: '当角色数据加载时触发' },
  { value: TriggerEventType.VARIABLE_CHANGED, label: '变量改变', description: '当变量值改变时触发' },
  { value: TriggerEventType.USER_INPUT, label: '用户输入', description: '当用户输入时触发' },
  { value: TriggerEventType.BUTTON_CLICKED, label: '按钮点击', description: '当点击特定按钮时触发' },
  { value: TriggerEventType.TIMER, label: '定时器', description: '在指定时间后触发' },
  { value: TriggerEventType.INTERVAL, label: '定时间隔', description: '按固定间隔重复触发' },
]

const ACTION_TYPE_OPTIONS: { value: TriggerAction['type']; label: string; icon: React.ReactNode }[] = [
  { value: 'script', label: '执行脚本', icon: <Code className="h-4 w-4" /> },
  { value: 'command', label: '执行命令', icon: <Code className="h-4 w-4" /> },
  { value: 'set_variable', label: '设置变量', icon: <Variable className="h-4 w-4" /> },
  { value: 'send_message', label: '发送消息', icon: <MessageSquare className="h-4 w-4" /> },
  { value: 'notify', label: '显示通知', icon: <Bell className="h-4 w-4" /> },
]

const CONDITION_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: '==', label: '等于 (==)' },
  { value: '===', label: '严格等于 (===)' },
  { value: '!=', label: '不等于 (!=)' },
  { value: '!==', label: '严格不等于 (!==)' },
  { value: '<', label: '小于 (<)' },
  { value: '>', label: '大于 (>)' },
  { value: '<=', label: '小于等于 (<=)' },
  { value: '>=', label: '大于等于 (>=)' },
  { value: 'contains', label: '包含' },
  { value: 'startsWith', label: '开头为' },
  { value: 'endsWith', label: '结尾为' },
  { value: 'matches', label: '正则匹配' },
  { value: 'exists', label: '存在' },
  { value: 'empty', label: '为空' },
]

// ============ 类型 ============

interface TriggersState {
  triggers: Trigger[]
  selectedId: string | null
}

// ============ 主组件 ============

interface TriggersPanelProps {
  chatId?: number
  cardId?: number
  onClose?: () => void
}

export function TriggersPanel({ chatId, cardId, onClose }: TriggersPanelProps) {
  const [state, setState] = useState<TriggersState>({
    triggers: [],
    selectedId: null,
  })
  const [showEditor, setShowEditor] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null)
  const [testResults, setTestResults] = useState<TriggerExecutionResult[]>([])

  // 加载触发器
  useEffect(() => {
    const manager = getTriggerManager()
    setState(prev => ({
      ...prev,
      triggers: manager.getAll(),
    }))
  }, [])

  // 添加触发器
  const handleAddTrigger = useCallback(() => {
    setEditingTrigger(null)
    setShowEditor(true)
  }, [])

  // 编辑触发器
  const handleEditTrigger = useCallback((trigger: Trigger) => {
    setEditingTrigger(trigger)
    setShowEditor(true)
  }, [])

  // 保存触发器
  const handleSaveTrigger = useCallback((trigger: Trigger) => {
    const manager = getTriggerManager()
    
    if (editingTrigger) {
      manager.update(trigger.id, trigger)
    } else {
      manager.register(trigger)
    }
    
    setState(prev => ({
      ...prev,
      triggers: manager.getAll(),
    }))
    setShowEditor(false)
    toast({ title: editingTrigger ? '触发器已更新' : '触发器已创建' })
  }, [editingTrigger])

  // 删除触发器
  const handleDeleteTrigger = useCallback((triggerId: string) => {
    const manager = getTriggerManager()
    manager.unregister(triggerId)
    setState(prev => ({
      ...prev,
      triggers: manager.getAll(),
      selectedId: prev.selectedId === triggerId ? null : prev.selectedId,
    }))
    toast({ title: '触发器已删除' })
  }, [])

  // 切换启用状态
  const handleToggleEnabled = useCallback((triggerId: string, enabled: boolean) => {
    const manager = getTriggerManager()
    manager.setEnabled(triggerId, enabled)
    setState(prev => ({
      ...prev,
      triggers: manager.getAll(),
    }))
  }, [])

  // 测试触发器
  const handleTestTrigger = useCallback(async (trigger: Trigger) => {
    const results = await emitEvent(trigger.event, {
      chatId,
      cardId,
      data: { test: true },
    })
    setTestResults(results)
    
    if (results.length > 0) {
      const successCount = results.filter(r => r.success).length
      toast({
        title: `测试完成`,
        description: `执行了 ${results.length} 个触发器，${successCount} 个成功`,
      })
    } else {
      toast({
        title: '无触发器执行',
        description: '没有触发器匹配此事件',
        variant: 'destructive',
      })
    }
  }, [chatId, cardId])

  // 导出触发器
  const handleExport = useCallback(() => {
    const data = JSON.stringify({
      version: 1,
      type: 'tavern-triggers',
      triggers: state.triggers,
      exportedAt: Date.now(),
    }, null, 2)
    
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `triggers-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    
    toast({ title: '导出成功' })
  }, [state.triggers])

  // 导入触发器
  const handleImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        
        if (data.type !== 'tavern-triggers' || !Array.isArray(data.triggers)) {
          throw new Error('无效的触发器文件格式')
        }
        
        const manager = getTriggerManager()
        let count = 0
        
        for (const trigger of data.triggers) {
          // 生成新 ID 避免冲突
          const newTrigger = {
            ...trigger,
            id: `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
          manager.register(newTrigger)
          count++
        }
        
        setState(prev => ({
          ...prev,
          triggers: manager.getAll(),
        }))
        
        toast({ title: '导入成功', description: `导入了 ${count} 个触发器` })
      } catch (error) {
        toast({
          title: '导入失败',
          description: error instanceof Error ? error.message : '未知错误',
          variant: 'destructive',
        })
      }
    }
    input.click()
  }, [])

  // 按事件类型分组
  const groupedTriggers = useMemo(() => {
    const groups: Record<string, Trigger[]> = {}
    for (const trigger of state.triggers) {
      const event = trigger.event
      if (!groups[event]) {
        groups[event] = []
      }
      groups[event].push(trigger)
    }
    return groups
  }, [state.triggers])

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          <h2 className="text-lg font-semibold">触发器管理</h2>
          <Badge variant="secondary">{state.triggers.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" onClick={handleImport}>
                <Upload className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>导入</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" onClick={handleExport}>
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>导出</TooltipContent>
          </Tooltip>
          <Button size="sm" onClick={handleAddTrigger}>
            <Plus className="h-4 w-4 mr-1" />
            新建
          </Button>
        </div>
      </div>

      {/* 触发器列表 */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {state.triggers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Zap className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>暂无触发器</p>
              <p className="text-sm">点击“新建”创建你的第一个触发器</p>
            </div>
          ) : (
            Object.entries(groupedTriggers).map(([event, triggers]) => (
              <div key={event} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {EVENT_TYPE_OPTIONS.find(e => e.value === event)?.label || event}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {triggers.length} 个触发器
                  </span>
                </div>
                <div className="space-y-2">
                  {triggers.map(trigger => (
                    <TriggerCard
                      key={trigger.id}
                      trigger={trigger}
                      onEdit={() => handleEditTrigger(trigger)}
                      onDelete={() => handleDeleteTrigger(trigger.id)}
                      onToggle={(enabled) => handleToggleEnabled(trigger.id, enabled)}
                      onTest={() => handleTestTrigger(trigger)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* 编辑对话框 */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <TriggerEditorDialog
          trigger={editingTrigger}
          onSave={handleSaveTrigger}
          onClose={() => setShowEditor(false)}
          chatId={chatId}
          cardId={cardId}
        />
      </Dialog>
    </div>
  )
}

// ============ 触发器卡片 ============

interface TriggerCardProps {
  trigger: Trigger
  onEdit: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
  onTest: () => void
}

function TriggerCard({ trigger, onEdit, onDelete, onToggle, onTest }: TriggerCardProps) {
  return (
    <Card className={cn(
      'transition-opacity',
      !trigger.enabled && 'opacity-60'
    )}>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Switch
              checked={trigger.enabled}
              onCheckedChange={onToggle}
            />
            <CardTitle className="text-sm truncate">{trigger.name}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="text-xs">
              优先级: {trigger.priority}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onTest}>
                  <Play className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>测试</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit}>
                  <Edit className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>编辑</TooltipContent>
            </Tooltip>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除触发器</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定要删除触发器 “{trigger.name}” 吗？此操作不可撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {trigger.description && (
          <CardDescription className="text-xs mt-1">
            {trigger.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="flex flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Code className="h-3 w-3" />
            <span>{trigger.actions.length} 个动作</span>
          </div>
          {trigger.conditions && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Settings className="h-3 w-3" />
              <span>{trigger.conditions.conditions.length} 个条件</span>
            </div>
          )}
          {trigger.cooldown && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>冷却 {trigger.cooldown / 1000}s</span>
            </div>
          )}
          {trigger.maxTriggers && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>最多 {trigger.maxTriggers} 次</span>
              {trigger.triggerCount !== undefined && (
                <span>({trigger.triggerCount} 已触发)</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 编辑对话框 ============

interface TriggerEditorDialogProps {
  trigger: Trigger | null
  onSave: (trigger: Trigger) => void
  onClose: () => void
  chatId?: number
  cardId?: number
}

function TriggerEditorDialog({
  trigger,
  onSave,
  onClose,
  chatId,
  cardId,
}: TriggerEditorDialogProps) {
  const isNew = !trigger
  
  const [name, setName] = useState(trigger?.name || '')
  const [description, setDescription] = useState(trigger?.description || '')
  const [event, setEvent] = useState<TriggerEventType>(trigger?.event || TriggerEventType.MESSAGE_RECEIVED)
  const [priority, setPriority] = useState(trigger?.priority || 100)
  const [cooldown, setCooldown] = useState((trigger?.cooldown || 0) / 1000)
  const [maxTriggers, setMaxTriggers] = useState(trigger?.maxTriggers || 0)
  const [actions, setActions] = useState<TriggerAction[]>(trigger?.actions || [])
  const [conditions, setConditions] = useState<ConditionGroup | undefined>(trigger?.conditions)
  const [scopeType, setScopeType] = useState<'global' | 'chat' | 'character'>(
    trigger?.chatId !== undefined ? 'chat' : trigger?.cardId !== undefined ? 'character' : 'global'
  )

  // 添加动作
  const handleAddAction = useCallback(() => {
    setActions(prev => [...prev, {
      type: 'script',
      script: '',
    }])
  }, [])

  // 更新动作
  const handleUpdateAction = useCallback((index: number, updates: Partial<TriggerAction>) => {
    setActions(prev => prev.map((action, i) =>
      i === index ? { ...action, ...updates } : action
    ))
  }, [])

  // 删除动作
  const handleDeleteAction = useCallback((index: number) => {
    setActions(prev => prev.filter((_, i) => i !== index))
  }, [])

  // 保存
  const handleSave = useCallback(() => {
    if (!name.trim()) {
      toast({ title: '请输入触发器名称', variant: 'destructive' })
      return
    }
    
    if (actions.length === 0) {
      toast({ title: '请添加至少一个动作', variant: 'destructive' })
      return
    }
    
    const newTrigger = createTrigger(name, event, actions, {
      id: trigger?.id,
      description: description || undefined,
      priority,
      cooldown: cooldown > 0 ? cooldown * 1000 : undefined,
      maxTriggers: maxTriggers > 0 ? maxTriggers : undefined,
      conditions,
      chatId: scopeType === 'chat' ? chatId : undefined,
      cardId: scopeType === 'character' ? cardId : undefined,
      triggerCount: trigger?.triggerCount,
      createdAt: trigger?.createdAt,
    })
    
    onSave(newTrigger)
  }, [name, description, event, priority, cooldown, maxTriggers, actions, conditions, scopeType, chatId, cardId, trigger, onSave])

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          {isNew ? '创建触发器' : '编辑触发器'}
        </DialogTitle>
        <DialogDescription>
          配置触发器的条件和动作
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="basic" className="flex-1 overflow-hidden flex flex-col">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="basic">基本设置</TabsTrigger>
          <TabsTrigger value="actions">动作 ({actions.length})</TabsTrigger>
          <TabsTrigger value="conditions">条件</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 mt-4">
          {/* 基本设置 */}
          <TabsContent value="basic" className="space-y-4 m-0">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>名称 *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="我的触发器"
                />
              </div>
              <div className="space-y-2">
                <Label>优先级</Label>
                <Input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  min={0}
                  max={1000}
                />
                <p className="text-xs text-muted-foreground">数字越小越先执行</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>描述</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="触发器的描述..."
              />
            </div>

            <div className="space-y-2">
              <Label>触发事件 *</Label>
              <Select value={event} onValueChange={(v) => setEvent(v as TriggerEventType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>作用范围</Label>
              <Select value={scopeType} onValueChange={(v) => setScopeType(v as typeof scopeType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">全局</SelectItem>
                  <SelectItem value="chat">当前聊天</SelectItem>
                  <SelectItem value="character">当前角色</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>冷却时间 (秒)</Label>
                <Input
                  type="number"
                  value={cooldown}
                  onChange={(e) => setCooldown(Number(e.target.value))}
                  min={0}
                  step={0.1}
                />
              </div>
              <div className="space-y-2">
                <Label>最大触发次数</Label>
                <Input
                  type="number"
                  value={maxTriggers}
                  onChange={(e) => setMaxTriggers(Number(e.target.value))}
                  min={0}
                />
                <p className="text-xs text-muted-foreground">0 = 无限制</p>
              </div>
            </div>
          </TabsContent>

          {/* 动作编辑 */}
          <TabsContent value="actions" className="space-y-4 m-0">
            {actions.map((action, index) => (
              <ActionEditor
                key={index}
                action={action}
                index={index}
                onUpdate={(updates) => handleUpdateAction(index, updates)}
                onDelete={() => handleDeleteAction(index)}
              />
            ))}
            
            <Button variant="outline" className="w-full" onClick={handleAddAction}>
              <Plus className="h-4 w-4 mr-2" />
              添加动作
            </Button>
          </TabsContent>

          {/* 条件编辑 */}
          <TabsContent value="conditions" className="space-y-4 m-0">
            <ConditionGroupEditor
              group={conditions}
              onChange={setConditions}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={handleSave}>
          <Save className="h-4 w-4 mr-2" />
          保存
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ============ 动作编辑器 ============

interface ActionEditorProps {
  action: TriggerAction
  index: number
  onUpdate: (updates: Partial<TriggerAction>) => void
  onDelete: () => void
}

function ActionEditor({ action, index, onUpdate, onDelete }: ActionEditorProps) {
  const typeOption = ACTION_TYPE_OPTIONS.find(opt => opt.value === action.type)

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {typeOption?.icon}
            <span className="text-sm font-medium">动作 #{index + 1}</span>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        <div className="space-y-2">
          <Label className="text-xs">类型</Label>
          <Select
            value={action.type}
            onValueChange={(v) => onUpdate({ type: v as TriggerAction['type'] })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2">
                    {opt.icon}
                    <span>{opt.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 脚本 */}
        {action.type === 'script' && (
          <div className="space-y-2">
            <Label className="text-xs">脚本内容</Label>
            <Textarea
              value={action.script || ''}
              onChange={(e) => onUpdate({ script: e.target.value })}
              placeholder="/echo Hello World"
              className="font-mono text-sm h-24"
            />
          </div>
        )}

        {/* 命令 */}
        {action.type === 'command' && (
          <div className="space-y-2">
            <Label className="text-xs">命令</Label>
            <Input
              value={action.command || ''}
              onChange={(e) => onUpdate({ command: e.target.value })}
              placeholder="/echo {{message}}"
              className="font-mono text-sm"
            />
          </div>
        )}

        {/* 设置变量 */}
        {action.type === 'set_variable' && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">变量名</Label>
                <Input
                  value={action.variable?.name || ''}
                  onChange={(e) => onUpdate({
                    variable: { ...action.variable, name: e.target.value, value: action.variable?.value || '' }
                  })}
                  placeholder="myVar"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">值</Label>
                <Input
                  value={action.variable?.value || ''}
                  onChange={(e) => onUpdate({
                    variable: { ...action.variable, name: action.variable?.name || '', value: e.target.value }
                  })}
                  placeholder="value"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">作用域</Label>
                <Select
                  value={action.variable?.scope || 'chat'}
                  onValueChange={(v) => onUpdate({
                    variable: { ...action.variable, name: action.variable?.name || '', value: action.variable?.value || '', scope: v as 'global' | 'chat' | 'local' }
                  })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">全局</SelectItem>
                    <SelectItem value="chat">聊天</SelectItem>
                    <SelectItem value="local">局部</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* 发送消息 */}
        {action.type === 'send_message' && (
          <div className="space-y-2">
            <Label className="text-xs">消息内容</Label>
            <Textarea
              value={action.message || ''}
              onChange={(e) => onUpdate({ message: e.target.value })}
              placeholder="输入要发送的消息..."
              className="h-20"
            />
          </div>
        )}

        {/* 通知 */}
        {action.type === 'notify' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">标题</Label>
                <Input
                  value={action.notification?.title || ''}
                  onChange={(e) => onUpdate({
                    notification: { ...action.notification, title: e.target.value }
                  })}
                  placeholder="通知标题"
                />
              </div>
              <div>
                <Label className="text-xs">类型</Label>
                <Select
                  value={action.notification?.type || 'info'}
                  onValueChange={(v) => onUpdate({
                    notification: { ...action.notification, title: action.notification?.title || '', type: v as 'info' | 'success' | 'warning' | 'error' }
                  })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">信息</SelectItem>
                    <SelectItem value="success">成功</SelectItem>
                    <SelectItem value="warning">警告</SelectItem>
                    <SelectItem value="error">错误</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">内容</Label>
              <Input
                value={action.notification?.body || ''}
                onChange={(e) => onUpdate({
                  notification: { ...action.notification, title: action.notification?.title || '', body: e.target.value }
                })}
                placeholder="通知内容"
              />
            </div>
          </div>
        )}

        {/* 延迟 */}
        <div className="space-y-2">
          <Label className="text-xs">延迟执行 (毫秒)</Label>
          <Input
            type="number"
            value={action.delay || 0}
            onChange={(e) => onUpdate({ delay: Number(e.target.value) || undefined })}
            min={0}
            step={100}
            className="w-32"
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 条件组编辑器 ============

interface ConditionGroupEditorProps {
  group?: ConditionGroup
  onChange: (group: ConditionGroup | undefined) => void
}

function ConditionGroupEditor({ group, onChange }: ConditionGroupEditorProps) {
  const handleAddCondition = useCallback(() => {
    const newCondition: TriggerCondition = {
      type: 'variable',
      field: '',
      operator: '==',
      value: '',
    }
    
    if (group) {
      onChange({
        ...group,
        conditions: [...group.conditions, newCondition],
      })
    } else {
      onChange({
        logic: 'AND',
        conditions: [newCondition],
      })
    }
  }, [group, onChange])

  const handleUpdateCondition = useCallback((index: number, updates: Partial<TriggerCondition>) => {
    if (!group) return
    onChange({
      ...group,
      conditions: group.conditions.map((cond, i) =>
        i === index ? { ...cond, ...updates } : cond
      ) as (TriggerCondition | ConditionGroup)[],
    })
  }, [group, onChange])

  const handleDeleteCondition = useCallback((index: number) => {
    if (!group) return
    const newConditions = group.conditions.filter((_, i) => i !== index)
    if (newConditions.length === 0) {
      onChange(undefined)
    } else {
      onChange({
        ...group,
        conditions: newConditions,
      })
    }
  }, [group, onChange])

  return (
    <div className="space-y-4">
      {group && group.conditions.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <Label>逻辑关系</Label>
            <Select
              value={group.logic}
              onValueChange={(v) => onChange({ ...group, logic: v as 'AND' | 'OR' })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">全部满足 (AND)</SelectItem>
                <SelectItem value="OR">任一满足 (OR)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            {group.conditions.map((cond, index) => {
              if ('logic' in cond) {
                // 嵌套条件组 - 暂不支持编辑
                return null
              }
              return (
                <ConditionEditor
                  key={index}
                  condition={cond}
                  onUpdate={(updates) => handleUpdateCondition(index, updates)}
                  onDelete={() => handleDeleteCondition(index)}
                />
              )
            })}
          </div>
        </>
      )}
      
      <Button variant="outline" className="w-full" onClick={handleAddCondition}>
        <Plus className="h-4 w-4 mr-2" />
        添加条件
      </Button>
      
      {!group && (
        <p className="text-sm text-muted-foreground text-center">
          无条件时，触发器将在事件发生时直接执行
        </p>
      )}
    </div>
  )
}

// ============ 单个条件编辑器 ============

interface ConditionEditorProps {
  condition: TriggerCondition
  onUpdate: (updates: Partial<TriggerCondition>) => void
  onDelete: () => void
}

function ConditionEditor({ condition, onUpdate, onDelete }: ConditionEditorProps) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 grid grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">类型</Label>
              <Select
                value={condition.type}
                onValueChange={(v) => onUpdate({ type: v as TriggerCondition['type'] })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="variable">变量</SelectItem>
                  <SelectItem value="event_data">事件数据</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">字段</Label>
              <Input
                value={condition.field}
                onChange={(e) => onUpdate({ field: e.target.value })}
                placeholder={condition.type === 'variable' ? 'myVar' : 'message'}
                className="h-8 font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">操作符</Label>
              <Select
                value={condition.operator}
                onValueChange={(v) => onUpdate({ operator: v as ConditionOperator })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_OPERATORS.map(op => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">值</Label>
              <Input
                value={String(condition.value || '')}
                onChange={(e) => onUpdate({ value: e.target.value })}
                placeholder="比较值"
                className="h-8"
                disabled={condition.operator === 'exists' || condition.operator === 'empty'}
              />
            </div>
          </div>
          <div className="flex items-end gap-1 pb-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={condition.negate ? 'default' : 'ghost'}
                  className="h-8 w-8"
                  onClick={() => onUpdate({ negate: !condition.negate })}
                >
                  <span className="text-xs font-mono">!</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>取反</TooltipContent>
            </Tooltip>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 导出 ============

export default TriggersPanel
